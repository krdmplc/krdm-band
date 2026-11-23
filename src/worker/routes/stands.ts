import { Hono } from 'hono'
import { z } from 'zod'
import type { Me, PayMethod, StandDetail, StandSnapshot, StandSummary, Tier } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, first, stmt } from '../lib/db'
import { type AppEnv, body, fail, nowIso, uid, user } from '../lib/http'
import { isAnyAdmin, requireAnyAdmin } from '../lib/perms'

export const stands = new Hono<AppEnv>()
stands.use('*', requireUser)

interface StandRow {
  id: string
  name: string
  date: string
  place: string | null
  location_id: string
  location_name: string
  status: 'open' | 'closed'
  created_by: string | null
  seller_ids: string | null
}

const STAND_SELECT = `SELECT s.id, s.name, s.date, s.place, s.location_id, l.name AS location_name, s.status, s.created_by,
  (SELECT group_concat(user_id) FROM stand_sellers WHERE stand_id = s.id) AS seller_ids
  FROM stands s JOIN locations l ON l.id = s.location_id`

const canManage = (me: Me, s: StandRow) => me.isLabelAdmin || s.created_by === me.id

function summary (me: Me, s: StandRow): StandSummary {
  return {
    id: s.id,
    name: s.name,
    date: s.date,
    place: s.place,
    locationId: s.location_id,
    locationName: s.location_name,
    status: s.status,
    sellerIds: s.seller_ids ? s.seller_ids.split(',') : [],
    canManage: canManage(me, s)
  }
}

export async function loadStand (db: D1Database, id: string): Promise<StandRow | null> {
  return await first<StandRow>(db, `${STAND_SELECT} WHERE s.id = ?`, id)
}

// Admins see every stand (band admins too: they're often at a gig with another band's
// items); sellers see the stands they sell at.
export async function standForUser (db: D1Database, me: Me, id: string): Promise<StandRow> {
  const s = await loadStand(db, id)
  if (!s) fail(404, 'not_found')
  const isSeller = (s.seller_ids ?? '').split(',').includes(me.id)
  if (!isSeller && !isAnyAdmin(me)) fail(403, 'forbidden')
  return s
}

stands.get('/', async (c) => {
  const me = user(c)
  const rows = await all<StandRow>(c.env.DB, `${STAND_SELECT} ORDER BY s.status = 'closed', s.date DESC, s.created_at DESC LIMIT 200`)
  return c.json(rows
    .filter((s) => isAnyAdmin(me) || (s.seller_ids ?? '').split(',').includes(me.id))
    .map((s) => summary(me, s)))
})

const sellerInput = z.object({
  userId: z.string(),
  floatCents: z.number().int().min(0).default(0),
  tiers: z.array(z.string()).default(['full'])
})

const standInput = z.object({
  name: z.string().trim().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  place: z.string().trim().max(100).nullable(),
  locationId: z.string(),
  sellers: z.array(sellerInput).min(1),
  prices: z.array(z.object({ productId: z.string(), tierId: z.string(), priceCents: z.number().int().min(0) })).default([]),
  status: z.enum(['open', 'closed']).optional()
})

function standStatements (db: D1Database, id: string, p: z.infer<typeof standInput>): D1PreparedStatement[] {
  return [
    stmt(db, 'DELETE FROM stand_prices WHERE stand_id = ?', id),
    ...p.prices.map((x) => stmt(db, 'INSERT INTO stand_prices (stand_id, product_id, tier_id, price_cents) VALUES (?, ?, ?, ?)', id, x.productId, x.tierId, x.priceCents)),
    // Keep counted cash of sellers who stay.
    stmt(db, `DELETE FROM stand_sellers WHERE stand_id = ? AND user_id NOT IN (SELECT value FROM json_each(?))`, id, JSON.stringify(p.sellers.map((s) => s.userId))),
    ...p.sellers.map((s) => stmt(db,
      `INSERT INTO stand_sellers (stand_id, user_id, float_cents, tiers) VALUES (?, ?, ?, ?)
       ON CONFLICT (stand_id, user_id) DO UPDATE SET float_cents = excluded.float_cents, tiers = excluded.tiers`,
      id, s.userId, s.floatCents, JSON.stringify([...new Set(['full', ...s.tiers])])))
  ]
}

stands.post('/', async (c) => {
  const me = user(c)
  requireAnyAdmin(me)
  const p = await body(c, standInput)
  if (!await first(c.env.DB, 'SELECT 1 FROM locations WHERE id = ? AND archived_at IS NULL', p.locationId)) fail(404, 'location_not_found')
  const id = uid()
  await c.env.DB.batch([
    stmt(c.env.DB, 'INSERT INTO stands (id, name, date, place, location_id, created_by) VALUES (?, ?, ?, ?, ?, ?)', id, p.name, p.date, p.place, p.locationId, me.id),
    ...standStatements(c.env.DB, id, p)
  ])
  return c.json({ id })
})

stands.put('/:id', async (c) => {
  const me = user(c)
  const s = await standForUser(c.env.DB, me, c.req.param('id'))
  if (!canManage(me, s)) fail(403, 'forbidden')
  const p = await body(c, standInput)
  const closing = p.status === 'closed' && s.status === 'open'
  await c.env.DB.batch([
    stmt(c.env.DB,
      `UPDATE stands SET name = ?, date = ?, place = ?, location_id = ?, status = COALESCE(?, status),
         closed_at = CASE WHEN ? = 1 THEN ? WHEN ? = 'open' THEN NULL ELSE closed_at END WHERE id = ?`,
      p.name, p.date, p.place, p.locationId, p.status, closing ? 1 : 0, nowIso(), p.status ?? null, s.id),
    ...standStatements(c.env.DB, s.id, p)
  ])
  return c.json({ ok: true })
})

stands.get('/:id', async (c) => {
  const me = user(c)
  const s = await standForUser(c.env.DB, me, c.req.param('id'))
  const [sellers, prices, totals, byMethod] = await Promise.all([
    all<{ user_id: string, name: string, float_cents: number, tiers: string, counted_cash_cents: number | null, cash: number }>(c.env.DB,
      `SELECT ss.user_id, u.name, ss.float_cents, ss.tiers, ss.counted_cash_cents,
         COALESCE((SELECT SUM(total_cents) FROM sales WHERE stand_id = ss.stand_id AND receiver_id = ss.user_id AND method = 'cash' AND voided_at IS NULL), 0) AS cash
       FROM stand_sellers ss JOIN users u ON u.id = ss.user_id WHERE ss.stand_id = ? ORDER BY u.name`, s.id),
    all<{ product_id: string, tier_id: string, price_cents: number }>(c.env.DB, 'SELECT product_id, tier_id, price_cents FROM stand_prices WHERE stand_id = ?', s.id),
    all<{ owner_id: string, cents: number }>(c.env.DB,
      `SELECT i.owner_id, SUM(i.qty * i.unit_price_cents - i.discount_cents) AS cents FROM sale_items i JOIN sales x ON x.id = i.sale_id
       WHERE x.stand_id = ? AND x.voided_at IS NULL GROUP BY i.owner_id ORDER BY cents DESC`, s.id),
    all<{ method: PayMethod, cents: number }>(c.env.DB,
      'SELECT method, SUM(total_cents) AS cents FROM sales WHERE stand_id = ? AND voided_at IS NULL GROUP BY method', s.id)
  ])
  const detail: StandDetail = {
    ...summary(me, s),
    sellers: sellers.map((r) => ({
      userId: r.user_id,
      name: r.name,
      floatCents: r.float_cents,
      tiers: JSON.parse(r.tiers),
      countedCashCents: r.counted_cash_cents,
      expectedCashCents: r.float_cents + r.cash
    })),
    prices: prices.map((r) => ({ productId: r.product_id, tierId: r.tier_id, priceCents: r.price_cents })),
    totals: totals.map((r) => ({ ownerId: r.owner_id, cents: r.cents })),
    byMethod
  }
  return c.json(detail)
})

// Each seller counts their own cash when the stand closes.
stands.post('/:id/cash', async (c) => {
  const me = user(c)
  const s = await standForUser(c.env.DB, me, c.req.param('id'))
  const { countedCashCents } = await body(c, z.object({ countedCashCents: z.number().int().min(0) }))
  const r = await stmt(c.env.DB, 'UPDATE stand_sellers SET counted_cash_cents = ?, counted_at = ? WHERE stand_id = ? AND user_id = ?',
    countedCashCents, nowIso(), s.id, me.id).run()
  if (r.meta.changes === 0) fail(403, 'not_a_seller')
  return c.json({ ok: true })
})

// Everything the phone needs to sell here offline: products in the stand's box with
// their stock there, prices (with this stand's overrides) and who can receive money.
stands.get('/:id/snapshot', async (c) => {
  const me = user(c)
  const s = await standForUser(c.env.DB, me, c.req.param('id'))
  const [seller, sellers, tiers, owners, products, sizes, stock, prices, overrides, images] = await Promise.all([
    first<{ tiers: string }>(c.env.DB, 'SELECT tiers FROM stand_sellers WHERE stand_id = ? AND user_id = ?', s.id, me.id),
    all<{ id: string, name: string, iban: string | null, street: string | null, city: string | null, flik_phone: string | null }>(c.env.DB,
      `SELECT u.id, u.name, u.iban, u.street, u.city, u.flik_phone FROM stand_sellers ss JOIN users u ON u.id = ss.user_id
       WHERE ss.stand_id = ? ORDER BY u.name`, s.id),
    all<{ id: string, name_sl: string, name_en: string }>(c.env.DB, 'SELECT id, name_sl, name_en FROM price_tiers ORDER BY sort'),
    all<{ id: string, name: string }>(c.env.DB, 'SELECT id, name FROM owners'),
    all<{ id: string, owner_id: string, title_sl: string, title_en: string, category: 'apparel' | 'music' | 'other' }>(c.env.DB,
      `SELECT id, owner_id, title_sl, title_en, category FROM products
       WHERE archived_at IS NULL AND id IN (SELECT DISTINCT product_id FROM stock_entries WHERE location_id = ?)
       ORDER BY owner_id, sort, title_sl`, s.location_id),
    all<{ product_id: string, size: string }>(c.env.DB, 'SELECT product_id, size FROM product_sizes ORDER BY sort'),
    all<{ product_id: string, size: string, qty: number }>(c.env.DB,
      'SELECT product_id, size, SUM(qty) AS qty FROM stock_entries WHERE location_id = ? GROUP BY product_id, size', s.location_id),
    all<{ product_id: string, tier_id: string, price_cents: number }>(c.env.DB, 'SELECT product_id, tier_id, price_cents FROM product_prices'),
    all<{ product_id: string, tier_id: string, price_cents: number }>(c.env.DB, 'SELECT product_id, tier_id, price_cents FROM stand_prices WHERE stand_id = ?', s.id),
    all<{ product_id: string, key: string }>(c.env.DB, 'SELECT product_id, key FROM product_images ORDER BY sort DESC, created_at DESC')
  ])
  const imageOf = new Map(images.map((i) => [i.product_id, i.key]))
  const snapshot: StandSnapshot = {
    fetchedAt: nowIso(),
    stand: summary(me, s),
    me: { id: me.id, tiers: seller ? JSON.parse(seller.tiers) : ['full'], adminOf: me.adminOf },
    sellers: sellers.map((u) => ({ id: u.id, name: u.name, iban: u.iban, street: u.street, city: u.city, flikPhone: u.flik_phone })),
    tiers: tiers.map((t): Tier => ({ id: t.id, nameSl: t.name_sl, nameEn: t.name_en })),
    owners,
    products: products.map((p) => {
      const base = Object.fromEntries(prices.filter((x) => x.product_id === p.id).map((x) => [x.tier_id, x.price_cents]))
      for (const o of overrides.filter((x) => x.product_id === p.id)) base[o.tier_id] = o.price_cents
      return {
        id: p.id,
        ownerId: p.owner_id,
        titleSl: p.title_sl,
        titleEn: p.title_en,
        category: p.category,
        imageKey: imageOf.get(p.id) ?? null,
        sizes: sizes.filter((x) => x.product_id === p.id).map((x) => ({
          size: x.size,
          stock: stock.find((st) => st.product_id === p.id && st.size === x.size)?.qty ?? 0
        })),
        prices: base
      }
    })
  }
  return c.json(snapshot)
})
