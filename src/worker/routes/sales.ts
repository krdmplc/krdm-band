import { Hono } from 'hono'
import { z } from 'zod'
import type { Sale, SyncResult } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, ensurePersonPot, first, marks, personPotId, stmt } from '../lib/db'
import { type AppEnv, body, fail, nowIso, uid, user } from '../lib/http'
import { notifySubscribers } from '../lib/notify'
import { canAdmin } from '../lib/perms'
import { transferStatement } from './money'
import { loadStand, standForUser } from './stands'

// Sales are made on phones, often offline, and uploaded later in batches. A sale
// happened, so it is always stored if it can be; breaking a rule (a discount
// without the right to give one) flags it for an admin instead of losing it.
export const sales = new Hono<AppEnv>()
sales.use('*', requireUser)

const saleInput = z.object({
  id: z.uuid(),
  standId: z.string(),
  method: z.enum(['cash', 'bank', 'flik']),
  receiverId: z.string(),
  soldAt: z.iso.datetime(),
  deviceId: z.string().max(64),
  guardianName: z.string().trim().max(60).nullable().optional(),
  items: z.array(z.object({
    productId: z.string(),
    size: z.string(),
    qty: z.number().int().positive().max(100),
    tierId: z.string(),
    unitPriceCents: z.number().int().min(0),
    discountCents: z.number().int().min(0),
    reason: z.string().trim().max(200).nullable().optional()
  })).min(1).max(50)
})

sales.post('/sync', async (c) => {
  const me = user(c)
  const { sales: batch } = await body(c, z.object({ sales: z.array(saleInput).max(100) }))
  const results: SyncResult[] = []
  const sold = new Map<string, { locationId: string, productId: string, size: string, qty: number, ownerId: string }>()

  for (const s of batch) {
    if (await first(c.env.DB, 'SELECT 1 FROM sales WHERE id = ?', s.id)) {
      results.push({ id: s.id, status: 'duplicate' })
      continue
    }
    const stand = await loadStand(c.env.DB, s.standId)
    if (!stand) { results.push({ id: s.id, status: 'rejected', error: 'stand_not_found' }); continue }
    const seller = await first<{ tiers: string }>(c.env.DB, 'SELECT tiers FROM stand_sellers WHERE stand_id = ? AND user_id = ?', stand.id, me.id)
    const manages = me.isLabelAdmin || stand.created_by === me.id
    if (!seller && !manages) { results.push({ id: s.id, status: 'rejected', error: 'not_a_seller' }); continue }
    if (!await first(c.env.DB, 'SELECT 1 FROM users WHERE id = ?', s.receiverId)) { results.push({ id: s.id, status: 'rejected', error: 'unknown_receiver' }); continue }
    const productIds = [...new Set(s.items.map((i) => i.productId))]
    const owners = new Map((await all<{ id: string, owner_id: string }>(c.env.DB,
      `SELECT id, owner_id FROM products WHERE id IN (${marks(productIds.length)})`, ...productIds)).map((p) => [p.id, p.owner_id]))
    if (productIds.some((id) => !owners.has(id))) { results.push({ id: s.id, status: 'rejected', error: 'unknown_product' }); continue }

    const allowedTiers: string[] = seller ? JSON.parse(seller.tiers) : []
    const flags = new Set<string>()
    for (const item of s.items) {
      const ownerId = owners.get(item.productId)!
      if (canAdmin(me, ownerId) || manages) continue
      if (!allowedTiers.includes(item.tierId)) flags.add('tier_not_allowed')
      if (item.discountCents > 0) flags.add('discount_not_allowed')
    }
    if (s.method === 'cash' && s.receiverId !== me.id) flags.add('cash_to_someone_else')
    if (stand.status === 'closed') flags.add('stand_closed')
    if (s.items.some((i) => i.discountCents > i.qty * i.unitPriceCents)) {
      results.push({ id: s.id, status: 'rejected', error: 'discount_too_large' })
      continue
    }

    const total = s.items.reduce((sum, i) => sum + i.qty * i.unitPriceCents - i.discountCents, 0)
    const perOwner = new Map<string, number>()
    const statements: D1PreparedStatement[] = [
      stmt(c.env.DB,
        'INSERT INTO sales (id, stand_id, seller_id, receiver_id, method, total_cents, sold_at, guardian_name, device_id, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        s.id, stand.id, me.id, s.receiverId, s.method, total, s.soldAt, s.guardianName || null, s.deviceId, flags.size ? JSON.stringify([...flags]) : null)
    ]
    for (const item of s.items) {
      const ownerId = owners.get(item.productId)!
      perOwner.set(ownerId, (perOwner.get(ownerId) ?? 0) + item.qty * item.unitPriceCents - item.discountCents)
      statements.push(
        stmt(c.env.DB,
          `INSERT INTO sale_items (sale_id, product_id, size, owner_id, qty, tier_id, unit_price_cents, discount_cents, reason, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s.id, item.productId, item.size, ownerId, item.qty, item.tierId, item.unitPriceCents, item.discountCents, item.reason, stand.location_id),
        stmt(c.env.DB,
          "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, sale_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'sold', ?, ?, ?)",
          uid(), item.productId, item.size, stand.location_id, -item.qty, s.id, me.id, s.soldAt))
      const key = `${stand.location_id}|${item.productId}|${item.size}`
      const prev = sold.get(key)
      sold.set(key, { locationId: stand.location_id, productId: item.productId, size: item.size, ownerId, qty: (prev?.qty ?? 0) + item.qty })
    }
    for (const [ownerId, cents] of perOwner) {
      if (cents <= 0) continue
      statements.push(
        ensurePersonPot(c.env.DB, ownerId, s.receiverId),
        transferStatement(c.env.DB, {
          ownerId, fromPot: 'customers', toPot: personPotId(ownerId, s.receiverId), amountCents: cents, kind: 'sale', status: 'done', saleId: s.id, createdBy: me.id
        }))
    }
    await c.env.DB.batch(statements)
    results.push({ id: s.id, status: 'saved', flags: [...flags] })
    if (flags.size) {
      await notifySubscribers(c.env.DB, 'sale.flagged', [...perOwner.keys()],
        { stand: stand.name, seller: me.name, flags: [...flags].join(', ') }, `/stands/${stand.id}`, me.id)
    }
  }

  await warnNegativeStock(c.env.DB, [...sold.values()])
  return c.json({ results })
})

// Tell the owners when a sale took a size below zero (two phones sold the last
// shirt, or the box was packed wrong). Only on the sale that crossed zero.
async function warnNegativeStock (db: D1Database, sold: { locationId: string, productId: string, size: string, qty: number, ownerId: string }[]) {
  for (const v of sold) {
    const row = await first<{ qty: number, title: string, location: string }>(db,
      `SELECT SUM(e.qty) AS qty, p.title_sl AS title, l.name AS location FROM stock_entries e
       JOIN products p ON p.id = e.product_id JOIN locations l ON l.id = e.location_id
       WHERE e.location_id = ? AND e.product_id = ? AND e.size = ?`, v.locationId, v.productId, v.size)
    if (row && row.qty < 0 && row.qty + v.qty >= 0) {
      await notifySubscribers(db, 'stock.negative', [v.ownerId],
        { product: row.title, size: v.size, location: row.location, qty: row.qty }, `/stock?location=${v.locationId}`)
    }
  }
}

sales.get('/', async (c) => {
  const me = user(c)
  const standId = c.req.query('standId')
  if (!standId) fail(400, 'stand_required')
  await standForUser(c.env.DB, me, standId)
  const rows = await all<{ id: string, stand_id: string | null, seller_id: string, seller_name: string, receiver_id: string, receiver_name: string, method: Sale['method'], total_cents: number, sold_at: string, guardian_name: string | null, flags: string | null, voided_at: string | null }>(c.env.DB,
    `SELECT s.id, s.stand_id, s.seller_id, su.name AS seller_name, s.receiver_id, ru.name AS receiver_name, s.method, s.total_cents, s.sold_at, s.guardian_name, s.flags, s.voided_at
     FROM sales s JOIN users su ON su.id = s.seller_id JOIN users ru ON ru.id = s.receiver_id
     WHERE s.stand_id = ? ORDER BY s.sold_at DESC`, standId)
  const items = rows.length
    ? await all<{ sale_id: string, product_id: string, size: string, owner_id: string, qty: number, tier_id: string, unit_price_cents: number, discount_cents: number, reason: string | null, title_sl: string, title_en: string }>(c.env.DB,
      `SELECT i.sale_id, i.product_id, i.size, i.owner_id, i.qty, i.tier_id, i.unit_price_cents, i.discount_cents, i.reason, p.title_sl, p.title_en
       FROM sale_items i JOIN products p ON p.id = i.product_id JOIN sales s ON s.id = i.sale_id WHERE s.stand_id = ?`, standId)
    : []
  return c.json(rows.map((r): Sale => ({
    id: r.id,
    standId: r.stand_id,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    receiverId: r.receiver_id,
    receiverName: r.receiver_name,
    method: r.method,
    totalCents: r.total_cents,
    soldAt: r.sold_at,
    guardianName: r.guardian_name,
    flags: r.flags ? JSON.parse(r.flags) : [],
    voided: r.voided_at !== null,
    items: items.filter((i) => i.sale_id === r.id).map((i) => ({
      productId: i.product_id,
      size: i.size,
      ownerId: i.owner_id,
      qty: i.qty,
      tierId: i.tier_id,
      unitPriceCents: i.unit_price_cents,
      discountCents: i.discount_cents,
      reason: i.reason,
      title: (me.locale === 'en' && i.title_en) || i.title_sl
    }))
  })))
})

// Undo a sale: the pieces go back into the box, the money back out of the receiver's pot.
sales.post('/:id/void', async (c) => {
  const me = user(c)
  const sale = await first<{ id: string, stand_id: string, seller_id: string, receiver_id: string, voided_at: string | null }>(c.env.DB,
    'SELECT id, stand_id, seller_id, receiver_id, voided_at FROM sales WHERE id = ?', c.req.param('id'))
  if (!sale || sale.voided_at) fail(404, 'not_found')
  const stand = await loadStand(c.env.DB, sale.stand_id)
  const items = await all<{ product_id: string, size: string, owner_id: string, qty: number, unit_price_cents: number, discount_cents: number, location_id: string }>(c.env.DB,
    'SELECT product_id, size, owner_id, qty, unit_price_cents, discount_cents, location_id FROM sale_items WHERE sale_id = ?', sale.id)
  const ownSaleAtOpenStand = sale.seller_id === me.id && stand?.status === 'open'
  const allowed = me.isLabelAdmin || stand?.created_by === me.id || ownSaleAtOpenStand || items.every((i) => canAdmin(me, i.owner_id))
  if (!allowed) fail(403, 'forbidden')
  const perOwner = new Map<string, number>()
  for (const i of items) perOwner.set(i.owner_id, (perOwner.get(i.owner_id) ?? 0) + i.qty * i.unit_price_cents - i.discount_cents)
  await c.env.DB.batch([
    stmt(c.env.DB, 'UPDATE sales SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL', nowIso(), me.id, sale.id),
    ...items.map((i) => stmt(c.env.DB,
      "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, sale_id, created_by) VALUES (?, ?, ?, ?, ?, 'returned', ?, ?)",
      uid(), i.product_id, i.size, i.location_id, i.qty, sale.id, me.id)),
    ...[...perOwner].filter(([, cents]) => cents > 0).map(([ownerId, cents]) => transferStatement(c.env.DB, {
      ownerId, fromPot: personPotId(ownerId, sale.receiver_id), toPot: 'customers', amountCents: cents, kind: 'refund', status: 'done', saleId: sale.id, createdBy: me.id
    }))
  ])
  return c.json({ ok: true })
})
