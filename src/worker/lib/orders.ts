// Creating orders (from the website or entered by hand) and pricing a cart.
// An order reserves its pieces right away, from locations whose stock is sold
// online, so the website stops offering what is already promised.

import type { Locale } from '../../shared/money'
import { postQuote } from '../../shared/shipping'
import type { CartLineInput, QuoteResult, ShippingMethod } from '../../shared/types'
import { shippingSettings } from '../routes/owners'
import { all, first, marks, stmt } from './db'
import { fail, uid } from './http'
import { notifySubscribers } from './notify'

interface ProductForCart {
  id: string
  owner_id: string
  title_sl: string
  title_en: string
  weight_g: number
  published: number
  full: number | null
}

const NUMBER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// KRDM-YYMM-XXXX: short enough to quote in an email (same format the website used).
function orderNumber (): string {
  const d = new Date()
  const month = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => NUMBER_CHARS[b % NUMBER_CHARS.length]).join('')
  return `KRDM-${month}-${random}`
}

function mergeLines (lines: CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, CartLineInput>()
  for (const l of lines) {
    const key = `${l.productId}|${l.size}`
    const prev = merged.get(key)
    merged.set(key, { ...l, qty: (prev?.qty ?? 0) + l.qty })
  }
  return [...merged.values()]
}

async function cartProducts (db: D1Database, ids: string[]) {
  if (ids.length === 0) return { products: new Map<string, ProductForCart>(), sizes: new Map<string, string[]>() }
  const rows = await all<ProductForCart>(db,
    `SELECT p.id, p.owner_id, p.title_sl, p.title_en, p.weight_g, p.published,
       (SELECT price_cents FROM product_prices WHERE product_id = p.id AND tier_id = 'full') AS full
     FROM products p WHERE p.archived_at IS NULL AND p.id IN (${marks(ids.length)})`, ...ids)
  const sizeRows = await all<{ product_id: string, size: string }>(db,
    `SELECT product_id, size FROM product_sizes WHERE product_id IN (${marks(ids.length)})`, ...ids)
  const sizes = new Map<string, string[]>()
  for (const s of sizeRows) sizes.set(s.product_id, [...(sizes.get(s.product_id) ?? []), s.size])
  return { products: new Map(rows.map((r) => [r.id, r])), sizes }
}

async function onlineStock (db: D1Database, productId: string, size: string) {
  return await all<{ location_id: string, qty: number }>(db,
    `SELECT e.location_id, SUM(e.qty) AS qty FROM stock_entries e JOIN locations l ON l.id = e.location_id
     WHERE l.online = 1 AND l.archived_at IS NULL AND e.product_id = ? AND e.size = ?
     GROUP BY e.location_id HAVING SUM(e.qty) > 0 ORDER BY qty DESC`, productId, size)
}

const title = (p: ProductForCart, locale: Locale) => (locale === 'en' && p.title_en) || p.title_sl

export async function quote (db: D1Database, input: CartLineInput[], method: ShippingMethod, locale: Locale, publishedOnly = true): Promise<QuoteResult> {
  const lines = mergeLines(input)
  const { products, sizes } = await cartProducts(db, lines.map((l) => l.productId))
  const out: QuoteResult['lines'] = []
  let itemsCents = 0
  let grams = 0
  for (const l of lines) {
    const p = products.get(l.productId)
    if (!p || p.full === null || (publishedOnly && p.published !== 1) || !(sizes.get(p.id) ?? []).includes(l.size)) {
      out.push({ ...l, title: '', unitPriceCents: 0, available: false })
      continue
    }
    const inStock = (await onlineStock(db, l.productId, l.size)).reduce((sum, r) => sum + r.qty, 0)
    out.push({ ...l, title: title(p, locale), unitPriceCents: p.full, available: inStock >= l.qty })
    itemsCents += l.qty * p.full
    grams += l.qty * p.weight_g
  }
  let shippingCents: number | null = null
  let postService: string | null = null
  if (method === 'pickup') shippingCents = 0
  if (method === 'post') {
    const q = postQuote(await shippingSettings(db), grams)
    if (q) { shippingCents = q.cents; postService = q.service }
  }
  return { lines: out, itemsCents, shippingCents, totalCents: shippingCents === null ? null : itemsCents + shippingCents, postService }
}

export interface NewOrder {
  source: 'web' | 'manual'
  locale: Locale
  customer: {
    name: string
    email: string | null
    phone: string | null
    street: string | null
    postcode: string | null
    city: string | null
    country: string | null
    note: string | null
  }
  shippingMethod: ShippingMethod
  // Manual orders may set the shipping and the prices themselves.
  shippingCents?: number | null
  items: (CartLineInput & { unitPriceCents?: number })[]
  createdBy: string | null
  ipHash: string | null
}

export async function createOrder (db: D1Database, o: NewOrder) {
  const web = o.source === 'web'
  const q = await quote(db, o.items, o.shippingMethod, o.locale, web)
  const unavailable = q.lines.filter((l) => !l.available).map(({ productId, size }) => ({ productId, size }))
  if (q.lines.length === 0) fail(400, 'empty_order')
  if (unavailable.length) fail(409, 'out_of_stock', unavailable)

  const { products } = await cartProducts(db, q.lines.map((l) => l.productId))
  const id = uid()
  let number = orderNumber()
  while (await first(db, 'SELECT 1 FROM orders WHERE number = ?', number)) number = orderNumber()

  const manualPrices = new Map(o.items.filter((i) => i.unitPriceCents !== undefined).map((i) => [`${i.productId}|${i.size}`, i.unitPriceCents!]))
  const statements: D1PreparedStatement[] = []
  let itemsCents = 0
  const ownerIds = new Set<string>()
  for (const line of q.lines) {
    const p = products.get(line.productId)!
    const price = web ? line.unitPriceCents : (manualPrices.get(`${line.productId}|${line.size}`) ?? line.unitPriceCents)
    itemsCents += price * line.qty
    ownerIds.add(p.owner_id)
    statements.push(stmt(db,
      'INSERT INTO order_items (order_id, product_id, size, owner_id, qty, unit_price_cents, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, line.productId, line.size, p.owner_id, line.qty, price, line.title))
    // Take from the fullest online locations first.
    let left = line.qty
    for (const loc of await onlineStock(db, line.productId, line.size)) {
      if (left === 0) break
      const take = Math.min(left, loc.qty)
      left -= take
      statements.push(stmt(db,
        "INSERT INTO stock_entries (id, product_id, size, location_id, qty, type, order_id, created_by) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)",
        uid(), line.productId, line.size, loc.location_id, -take, id, o.createdBy))
    }
  }
  const shippingCents = !web && o.shippingCents !== undefined ? o.shippingCents : q.shippingCents
  const c = o.customer
  statements.unshift(stmt(db,
    `INSERT INTO orders (id, number, source, locale, customer_name, email, phone, street, postcode, city, country, note,
       shipping_method, items_cents, shipping_cents, ip_hash, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, number, o.source, o.locale, c.name, c.email, c.phone, c.street, c.postcode, c.city, c.country, c.note,
    o.shippingMethod, itemsCents, shippingCents, o.ipHash, o.createdBy))
  statements.push(stmt(db, "INSERT INTO order_log (order_id, user_id, event) VALUES (?, ?, 'created')", id, o.createdBy))
  await db.batch(statements)
  await notifySubscribers(db, 'order.new', [...ownerIds], { number, customer: c.name, cents: itemsCents }, `/orders/${id}`, o.createdBy ?? undefined)
  return { id, number, itemsCents, shippingCents, totalCents: shippingCents === null ? null : itemsCents + shippingCents }
}
