import { Hono } from 'hono'
import { z } from 'zod'
import type { Me, Order } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, ensurePersonPot, first, personPotId, stmt } from '../lib/db'
import { type AppEnv, body, fail, nowIso, uid, user } from '../lib/http'
import { createOrder } from '../lib/orders'
import { canAdmin, requireAnyAdmin } from '../lib/perms'
import { transferStatement } from './money'

export const orders = new Hono<AppEnv>()
orders.use('*', requireUser)

interface OrderRow {
  id: string
  number: string
  status: Order['status']
  source: Order['source']
  locale: Order['locale']
  customer_name: string
  email: string | null
  phone: string | null
  street: string | null
  postcode: string | null
  city: string | null
  country: string | null
  note: string | null
  shipping_method: Order['shippingMethod']
  items_cents: number
  shipping_cents: number | null
  postage_cents: number | null
  postage_paid_by: string | null
  handler_id: string | null
  payment_method: Order['paymentMethod']
  payment_receiver_id: string | null
  paid_at: string | null
  shipped_at: string | null
  created_at: string
}

type ItemRow = { order_id: string, product_id: string, size: string, owner_id: string, qty: number, unit_price_cents: number, title: string }

function toOrder (r: OrderRow, items: ItemRow[]): Order {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    source: r.source,
    locale: r.locale,
    customerName: r.customer_name,
    email: r.email,
    phone: r.phone,
    street: r.street,
    postcode: r.postcode,
    city: r.city,
    country: r.country,
    note: r.note,
    shippingMethod: r.shipping_method,
    itemsCents: r.items_cents,
    shippingCents: r.shipping_cents,
    postageCents: r.postage_cents,
    postagePaidBy: r.postage_paid_by,
    handlerId: r.handler_id,
    paymentMethod: r.payment_method,
    paymentReceiverId: r.payment_receiver_id,
    paidAt: r.paid_at,
    shippedAt: r.shipped_at,
    createdAt: r.created_at,
    items: items.filter((i) => i.order_id === r.id).map((i) => ({
      productId: i.product_id, size: i.size, ownerId: i.owner_id, qty: i.qty, unitPriceCents: i.unit_price_cents, title: i.title
    }))
  }
}

// An order is yours to handle if you manage any of the owners in it.
const canHandle = (me: Me, items: ItemRow[]) => me.isLabelAdmin || items.some((i) => canAdmin(me, i.owner_id))

async function loadOrder (db: D1Database, me: Me, id: string) {
  const row = await first<OrderRow>(db, 'SELECT * FROM orders WHERE id = ?', id)
  if (!row) fail(404, 'not_found')
  const items = await all<ItemRow>(db, 'SELECT * FROM order_items WHERE order_id = ?', id)
  if (!canHandle(me, items)) fail(403, 'forbidden')
  return { row, items }
}

orders.get('/', async (c) => {
  const me = user(c)
  const status = c.req.query('status')
  const rows = await all<OrderRow>(c.env.DB,
    `SELECT * FROM orders WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC LIMIT 300`, status ?? null, status ?? null)
  const items = await all<ItemRow>(c.env.DB,
    `SELECT * FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC LIMIT 300)`,
    status ?? null, status ?? null)
  return c.json(rows
    .filter((r) => canHandle(me, items.filter((i) => i.order_id === r.id)))
    .map((r) => toOrder(r, items)))
})

orders.get('/:id', async (c) => {
  const me = user(c)
  const { row, items } = await loadOrder(c.env.DB, me, c.req.param('id'))
  const log = await all<{ event: string, detail: string | null, user_name: string | null, created_at: string }>(c.env.DB,
    'SELECT l.event, l.detail, u.name AS user_name, l.created_at FROM order_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.order_id = ? ORDER BY l.id', row.id)
  return c.json({ ...toOrder(row, items), log: log.map((l) => ({ event: l.event, detail: l.detail, userName: l.user_name, createdAt: l.created_at })) })
})

const customer = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().nullable(),
  phone: z.string().trim().max(40).nullable(),
  street: z.string().trim().max(100).nullable(),
  postcode: z.string().trim().max(20).nullable(),
  city: z.string().trim().max(60).nullable(),
  country: z.string().trim().max(60).nullable(),
  note: z.string().trim().max(1000).nullable()
})

// Orders that came by DM or phone.
orders.post('/', async (c) => {
  const me = user(c)
  requireAnyAdmin(me)
  const p = await body(c, z.object({
    customer,
    locale: z.enum(['sl', 'en']).default('sl'),
    shippingMethod: z.enum(['pickup', 'post', 'abroad']),
    shippingCents: z.number().int().min(0).nullable().optional(),
    items: z.array(z.object({ productId: z.string(), size: z.string(), qty: z.number().int().positive(), unitPriceCents: z.number().int().min(0).optional() })).min(1)
  }))
  const result = await createOrder(c.env.DB, { source: 'manual', locale: p.locale, customer: p.customer, shippingMethod: p.shippingMethod, shippingCents: p.shippingCents, items: p.items, createdBy: me.id, ipHash: null })
  await stmt(c.env.DB, 'UPDATE orders SET handler_id = ? WHERE id = ?', me.id, result.id).run()
  return c.json(result)
})

function log (db: D1Database, orderId: string, userId: string, event: string, detail?: string | null) {
  return stmt(db, 'INSERT INTO order_log (order_id, user_id, event, detail) VALUES (?, ?, ?, ?)', orderId, userId, event, detail ?? null)
}

orders.put('/:id', async (c) => {
  const me = user(c)
  const { row } = await loadOrder(c.env.DB, me, c.req.param('id'))
  const p = await body(c, z.object({
    customer,
    shippingCents: z.number().int().min(0).nullable(),
    handlerId: z.string().nullable()
  }))
  const cu = p.customer
  await c.env.DB.batch([
    stmt(c.env.DB,
      `UPDATE orders SET customer_name = ?, email = ?, phone = ?, street = ?, postcode = ?, city = ?, country = ?, note = ?,
         shipping_cents = ?, handler_id = ?, updated_at = ? WHERE id = ?`,
      cu.name, cu.email, cu.phone, cu.street, cu.postcode, cu.city, cu.country, cu.note, p.shippingCents, p.handlerId, nowIso(), row.id),
    log(c.env.DB, row.id, me.id, 'edited')
  ])
  return c.json({ ok: true })
})

// The customer has been told the total and how to pay.
orders.post('/:id/confirm', async (c) => {
  const me = user(c)
  const { row } = await loadOrder(c.env.DB, me, c.req.param('id'))
  if (row.status !== 'new') fail(409, 'wrong_status')
  if (row.shipping_cents === null) fail(409, 'shipping_unknown')
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE orders SET status = 'awaiting_payment', handler_id = COALESCE(handler_id, ?), updated_at = ? WHERE id = ?", me.id, nowIso(), row.id),
    log(c.env.DB, row.id, me.id, 'confirmed')
  ])
  return c.json({ ok: true })
})

// The money arrived: each owner's share goes into the receiver's pot.
orders.post('/:id/pay', async (c) => {
  const me = user(c)
  const { row, items } = await loadOrder(c.env.DB, me, c.req.param('id'))
  if (row.status !== 'new' && row.status !== 'awaiting_payment') fail(409, 'wrong_status')
  if (row.shipping_cents === null) fail(409, 'shipping_unknown')
  const p = await body(c, z.object({ method: z.enum(['cash', 'bank', 'flik']), receiverId: z.string() }))
  if (!await first(c.env.DB, 'SELECT 1 FROM users WHERE id = ?', p.receiverId)) fail(404, 'unknown_receiver')
  const perOwner = new Map<string, number>()
  for (const i of items) perOwner.set(i.owner_id, (perOwner.get(i.owner_id) ?? 0) + i.qty * i.unit_price_cents)
  await c.env.DB.batch([
    stmt(c.env.DB,
      "UPDATE orders SET status = 'paid', payment_method = ?, payment_receiver_id = ?, paid_at = ?, handler_id = COALESCE(handler_id, ?), updated_at = ? WHERE id = ?",
      p.method, p.receiverId, nowIso(), me.id, nowIso(), row.id),
    ...[...perOwner].filter(([, cents]) => cents > 0).flatMap(([ownerId, cents]) => [
      ensurePersonPot(c.env.DB, ownerId, p.receiverId),
      transferStatement(c.env.DB, { ownerId, fromPot: 'customers', toPot: personPotId(ownerId, p.receiverId), amountCents: cents, kind: 'order', status: 'done', orderId: row.id, createdBy: me.id })
    ]),
    log(c.env.DB, row.id, me.id, 'paid', p.method)
  ])
  return c.json({ ok: true })
})

orders.post('/:id/ship', async (c) => {
  const me = user(c)
  const { row } = await loadOrder(c.env.DB, me, c.req.param('id'))
  if (row.status !== 'paid') fail(409, 'wrong_status')
  const p = await body(c, z.object({ postageCents: z.number().int().min(0).nullable(), postagePaidBy: z.string().nullable() }))
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE orders SET status = 'shipped', shipped_at = ?, postage_cents = ?, postage_paid_by = ?, updated_at = ? WHERE id = ?",
      nowIso(), p.postageCents, p.postagePaidBy, nowIso(), row.id),
    log(c.env.DB, row.id, me.id, 'shipped')
  ])
  return c.json({ ok: true })
})

// Puts the reserved pieces back; a paid order is refunded from the same pots.
orders.post('/:id/cancel', async (c) => {
  const me = user(c)
  const { row } = await loadOrder(c.env.DB, me, c.req.param('id'))
  if (row.status === 'cancelled' || row.status === 'shipped') fail(409, 'wrong_status')
  const reserved = await all<{ product_id: string, size: string, location_id: string, qty: number }>(c.env.DB,
    "SELECT product_id, size, location_id, qty FROM stock_entries WHERE order_id = ? AND type = 'reserved'", row.id)
  const paid = await all<{ owner_id: string, to_pot: string, amount_cents: number }>(c.env.DB,
    "SELECT owner_id, to_pot, amount_cents FROM transfers WHERE order_id = ? AND kind = 'order' AND status = 'done'", row.id)
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE orders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), row.id),
    ...reserved.map((r) => stmt(c.env.DB,
      "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, order_id, created_by) VALUES (?, ?, ?, ?, ?, 'released', ?, ?)",
      uid(), r.product_id, r.size, r.location_id, -r.qty, row.id, me.id)),
    ...paid.map((t) => transferStatement(c.env.DB, {
      ownerId: t.owner_id, fromPot: t.to_pot, toPot: 'customers', amountCents: t.amount_cents, kind: 'refund', status: 'done', orderId: row.id, createdBy: me.id
    })),
    log(c.env.DB, row.id, me.id, 'cancelled')
  ])
  return c.json({ ok: true })
})
