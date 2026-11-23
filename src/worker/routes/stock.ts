import { Hono } from 'hono'
import { z } from 'zod'
import type { Location, Me, StockEntry, StockRow } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, first, marks, stmt } from '../lib/db'
import { type AppEnv, body, fail, nowIso, uid, user } from '../lib/http'
import { canAdmin, isAnyAdmin, requireAnyAdmin, requireOwnerAdmin } from '../lib/perms'
import { canSpendFrom, potInfo, transferStatement } from './money'

// Locations and stock. Stock is never stored as a number: every change is an
// entry, and the stock of a size at a location is the sum of its entries.
export const stock = new Hono<AppEnv>()
stock.use('*', requireUser)

stock.get('/locations', async (c) => {
  const rows = await all<{ id: string, name: string, keeper_id: string | null, keeper_name: string | null, online: number, archived_at: string | null, pieces: number | null }>(c.env.DB,
    `SELECT l.id, l.name, l.keeper_id, u.name AS keeper_name, l.online, l.archived_at,
       (SELECT SUM(qty) FROM stock_entries WHERE location_id = l.id) AS pieces
     FROM locations l LEFT JOIN users u ON u.id = l.keeper_id ORDER BY l.archived_at IS NOT NULL, l.name`)
  return c.json(rows.map((r): Location => ({
    id: r.id, name: r.name, keeperId: r.keeper_id, keeperName: r.keeper_name, online: r.online === 1, archived: r.archived_at !== null, pieces: r.pieces ?? 0
  })))
})

const locationInput = z.object({
  name: z.string().trim().min(1).max(80),
  keeperId: z.string().nullable(),
  online: z.boolean(),
  archived: z.boolean().optional()
})

stock.post('/locations', async (c) => {
  requireAnyAdmin(user(c))
  const p = await body(c, locationInput)
  const id = uid()
  await stmt(c.env.DB, 'INSERT INTO locations (id, name, keeper_id, online) VALUES (?, ?, ?, ?)', id, p.name, p.keeperId, p.online ? 1 : 0).run()
  return c.json({ id })
})

stock.put('/locations/:id', async (c) => {
  const me = user(c)
  const id = c.req.param('id')
  const loc = await first<{ keeper_id: string | null }>(c.env.DB, 'SELECT keeper_id FROM locations WHERE id = ?', id)
  if (!loc) fail(404, 'not_found')
  if (!me.isLabelAdmin && loc.keeper_id !== me.id) fail(403, 'forbidden')
  const p = await body(c, locationInput)
  await stmt(c.env.DB,
    'UPDATE locations SET name = ?, keeper_id = ?, online = ?, archived_at = CASE WHEN ? = 1 THEN COALESCE(archived_at, ?) ELSE NULL END WHERE id = ?',
    p.name, p.keeperId, p.online ? 1 : 0, p.archived ? 1 : 0, nowIso(), id).run()
  return c.json({ ok: true })
})

stock.get('/stock', async (c) => {
  const where: string[] = []
  const params: string[] = []
  const location = c.req.query('locationId')
  const product = c.req.query('productId')
  if (location) { where.push('location_id = ?'); params.push(location) }
  if (product) { where.push('product_id = ?'); params.push(product) }
  const rows = await all<{ product_id: string, size: string, location_id: string, qty: number }>(c.env.DB,
    `SELECT product_id, size, location_id, SUM(qty) AS qty FROM stock_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY product_id, size, location_id HAVING SUM(qty) != 0`, ...params)
  return c.json(rows.map((r): StockRow => ({ productId: r.product_id, size: r.size, locationId: r.location_id, qty: r.qty })))
})

stock.get('/stock/entries', async (c) => {
  const where: string[] = []
  const params: string[] = []
  const location = c.req.query('locationId')
  const product = c.req.query('productId')
  if (location) { where.push('e.location_id = ?'); params.push(location) }
  if (product) { where.push('e.product_id = ?'); params.push(product) }
  const me = user(c)
  const rows = await all<{ id: string, product_id: string, owner_id: string, size: string, location_id: string, qty: number, type: string, unit_cost_cents: number | null, note: string | null, created_by_name: string | null, created_at: string }>(c.env.DB,
    `SELECT e.id, e.product_id, p.owner_id, e.size, e.location_id, e.qty, e.type, e.unit_cost_cents, e.note, u.name AS created_by_name, e.created_at
     FROM stock_entries e JOIN products p ON p.id = e.product_id LEFT JOIN users u ON u.id = e.created_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.created_at DESC LIMIT 300`, ...params)
  return c.json(rows.map((r): StockEntry => ({
    id: r.id,
    productId: r.product_id,
    size: r.size,
    locationId: r.location_id,
    qty: r.qty,
    type: r.type,
    // Purchase costs are for the owner's admins only.
    unitCostCents: canAdmin(me, r.owner_id) ? r.unit_cost_cents : null,
    note: r.note,
    createdByName: r.created_by_name,
    createdAt: r.created_at
  })))
})

async function productOwners (db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const rows = await all<{ id: string, owner_id: string }>(db, `SELECT id, owner_id FROM products WHERE id IN (${marks(ids.length)})`, ...ids)
  return new Map(rows.map((r) => [r.id, r.owner_id]))
}

async function requireLocation (db: D1Database, id: string) {
  const loc = await first<{ id: string, keeper_id: string | null }>(db, 'SELECT id, keeper_id FROM locations WHERE id = ? AND archived_at IS NULL', id)
  if (!loc) fail(404, 'location_not_found')
  return loc
}

// A print run arriving: one product, several sizes, one cost per piece. If it was
// paid from someone's pot, the payment is recorded too.
stock.post('/stock/receive', async (c) => {
  const me = user(c)
  const p = await body(c, z.object({
    productId: z.string(),
    locationId: z.string(),
    items: z.array(z.object({ size: z.string(), qty: z.number().int().positive() })).min(1),
    unitCostCents: z.number().int().min(0).nullable(),
    paidFromPot: z.string().nullable().optional(),
    note: z.string().trim().max(300).nullable().optional()
  }))
  const product = await first<{ owner_id: string }>(c.env.DB, 'SELECT owner_id FROM products WHERE id = ?', p.productId)
  if (!product) fail(404, 'not_found')
  requireOwnerAdmin(me, product.owner_id)
  await requireLocation(c.env.DB, p.locationId)
  const group = uid()
  const statements = p.items.map((item) => stmt(c.env.DB,
    `INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, unit_cost_cents, group_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)`,
    uid(), p.productId, item.size, p.locationId, item.qty, p.unitCostCents, group, p.note, me.id))
  const total = (p.unitCostCents ?? 0) * p.items.reduce((sum, i) => sum + i.qty, 0)
  if (p.paidFromPot && total > 0) {
    const pot = await potInfo(c.env.DB, p.paidFromPot)
    if (!pot || pot.owner_id !== product.owner_id || !canSpendFrom(me, pot)) fail(403, 'cannot_spend_from_pot')
    statements.push(transferStatement(c.env.DB, {
      ownerId: product.owner_id, fromPot: pot.id, toPot: 'suppliers', amountCents: total, kind: 'expense', status: 'done', stockGroupId: group, note: p.note ?? null, createdBy: me.id
    }))
  }
  await c.env.DB.batch(statements)
  return c.json({ group })
})

const itemsInput = z.array(z.object({ productId: z.string(), size: z.string(), qty: z.number().int() })).min(1)

// Packing a box, unpacking it, handing stock to another location.
stock.post('/stock/move', async (c) => {
  const me = user(c)
  const p = await body(c, z.object({ fromId: z.string(), toId: z.string(), items: itemsInput, note: z.string().trim().max(300).nullable().optional() }))
  if (p.fromId === p.toId) fail(400, 'same_location')
  const from = await requireLocation(c.env.DB, p.fromId)
  await requireLocation(c.env.DB, p.toId)
  const owners = await productOwners(c.env.DB, p.items.map((i) => i.productId))
  // The keeper of the source moves anything; otherwise you need to manage every owner in it.
  if (from.keeper_id !== me.id && !p.items.every((i) => owners.has(i.productId) && canAdmin(me, owners.get(i.productId)!))) fail(403, 'forbidden')
  const group = uid()
  const statements = p.items.filter((i) => i.qty > 0).flatMap((item) => [
    stmt(c.env.DB, "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, group_id, note, created_by) VALUES (?, ?, ?, ?, ?, 'moved', ?, ?, ?)",
      uid(), item.productId, item.size, p.fromId, -item.qty, group, p.note, me.id),
    stmt(c.env.DB, "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, group_id, note, created_by) VALUES (?, ?, ?, ?, ?, 'moved', ?, ?, ?)",
      uid(), item.productId, item.size, p.toId, item.qty, group, p.note, me.id)
  ])
  if (statements.length === 0) fail(400, 'nothing_to_move')
  await c.env.DB.batch(statements)
  return c.json({ group })
})

// A stock count: the counted numbers become the stock, the difference is recorded.
stock.post('/stock/count', async (c) => {
  const me: Me = user(c)
  const p = await body(c, z.object({ locationId: z.string(), items: itemsInput, note: z.string().trim().max(300).nullable().optional() }))
  const loc = await requireLocation(c.env.DB, p.locationId)
  const owners = await productOwners(c.env.DB, p.items.map((i) => i.productId))
  if (loc.keeper_id !== me.id && !(isAnyAdmin(me) && p.items.every((i) => canAdmin(me, owners.get(i.productId) ?? '')))) fail(403, 'forbidden')
  const current = await all<{ product_id: string, size: string, qty: number }>(c.env.DB,
    'SELECT product_id, size, SUM(qty) AS qty FROM stock_entries WHERE location_id = ? GROUP BY product_id, size', p.locationId)
  const group = uid()
  const statements = p.items.flatMap((item) => {
    if (item.qty < 0) fail(400, 'negative_count')
    const now = current.find((r) => r.product_id === item.productId && r.size === item.size)?.qty ?? 0
    const diff = item.qty - now
    return diff === 0
      ? []
      : [stmt(c.env.DB, "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, group_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'counted', ?, ?, ?, ?)",
          uid(), item.productId, item.size, p.locationId, diff, group, p.note, me.id, nowIso())]
  })
  if (statements.length) await c.env.DB.batch(statements)
  return c.json({ changed: statements.length })
})
