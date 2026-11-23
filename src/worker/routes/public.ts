import { Hono } from 'hono'
import { z } from 'zod'
import type { CatalogItem } from '../../shared/types'
import { sha256 } from '../lib/auth'
import { loadProducts } from '../lib/catalog'
import { all, first } from '../lib/db'
import { type AppEnv, body, fail } from '../lib/http'
import { createOrder, quote } from '../lib/orders'

// What the website reads and sends. No sign-in, open to any origin (CORS is set
// in index.ts). Stock counts never leave the app: only "available" per size.
export const publicApi = new Hono<AppEnv>()

const lang = (v: string | undefined) => (v === 'en' ? 'en' : 'sl')

publicApi.get('/catalog', async (c) => {
  const locale = lang(c.req.query('lang'))
  const origin = new URL(c.req.url).origin
  const [products, owners] = await Promise.all([
    loadProducts(c.env.DB, { publishedOnly: true }),
    all<{ id: string, name: string }>(c.env.DB, 'SELECT id, name FROM owners')
  ])
  const ownerName = new Map(owners.map((o) => [o.id, o.name]))
  const items = products
    .filter((p) => p.prices.full !== undefined)
    .map((p): CatalogItem => {
      const sizes = p.sizes.map((size) => ({ size, available: (p.onlineStock[size] ?? 0) > 0 }))
      return {
        id: p.id,
        owner: { id: p.ownerId, name: ownerName.get(p.ownerId) ?? p.ownerId },
        title: (locale === 'en' && p.titleEn) || p.titleSl,
        description: (locale === 'en' && p.descriptionEn) || p.descriptionSl,
        category: p.category,
        link: p.link,
        release: p.release,
        priceCents: p.prices.full,
        weightG: p.weightG,
        images: p.images.map((i) => ({ url: `${origin}/images/${i.key}`, width: i.width, height: i.height })),
        sizes,
        available: sizes.some((s) => s.available),
        updatedAt: p.updatedAt
      }
    })
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(items)
})

// Small and fresh: the website calls this on every merch page view.
publicApi.get('/availability', async (c) => {
  const rows = await all<{ product_id: string, size: string, qty: number | null }>(c.env.DB,
    `SELECT s.product_id, s.size,
       (SELECT SUM(e.qty) FROM stock_entries e JOIN locations l ON l.id = e.location_id
        WHERE l.online = 1 AND l.archived_at IS NULL AND e.product_id = s.product_id AND e.size = s.size) AS qty
     FROM product_sizes s JOIN products p ON p.id = s.product_id
     WHERE p.published = 1 AND p.archived_at IS NULL ORDER BY s.sort`)
  const out: Record<string, { available: boolean, sizes: Record<string, boolean> }> = {}
  for (const r of rows) {
    const entry = out[r.product_id] ??= { available: false, sizes: {} }
    entry.sizes[r.size] = (r.qty ?? 0) > 0
    entry.available ||= entry.sizes[r.size]
  }
  c.header('Cache-Control', 'public, max-age=15')
  return c.json(out)
})

const lines = z.array(z.object({
  productId: z.string().max(80),
  size: z.string().max(20),
  qty: z.number().int().positive().max(10)
})).min(1).max(20)

publicApi.post('/quote', async (c) => {
  const p = await body(c, z.object({ items: lines, shipping: z.enum(['pickup', 'post', 'abroad']), lang: z.enum(['sl', 'en']).default('sl') }))
  return c.json(await quote(c.env.DB, p.items, p.shipping, p.lang))
})

const ORDERS_PER_IP_PER_HOUR = 5

publicApi.post('/orders', async (c) => {
  const p = await body(c, z.object({
    items: lines,
    shipping: z.enum(['pickup', 'post', 'abroad']),
    lang: z.enum(['sl', 'en']).default('sl'),
    customer: z.object({
      name: z.string().trim().min(1).max(100),
      email: z.email().trim(),
      phone: z.string().trim().max(40).nullable().optional(),
      street: z.string().trim().max(100).nullable().optional(),
      postcode: z.string().trim().max(20).nullable().optional(),
      city: z.string().trim().max(60).nullable().optional(),
      country: z.string().trim().max(60).nullable().optional(),
      note: z.string().trim().max(1000).nullable().optional()
    }),
    // A field people never see; bots fill it in.
    website: z.string().optional()
  }))
  if (p.website) return c.json({ number: 'KRDM-0000-0000', itemsCents: 0, shippingCents: 0, totalCents: 0 })
  const cu = p.customer
  if (p.shipping !== 'pickup' && !(cu.street && cu.postcode && cu.city)) fail(400, 'address_required')
  if (p.shipping === 'abroad' && !cu.country) fail(400, 'address_required')

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  const ipHash = await sha256(`${c.env.IP_SALT}|${ip}`)
  const recent = await first<{ n: number }>(c.env.DB,
    'SELECT COUNT(*) AS n FROM orders WHERE ip_hash = ? AND created_at > ?', ipHash, new Date(Date.now() - 3600_000).toISOString())
  if ((recent?.n ?? 0) >= ORDERS_PER_IP_PER_HOUR) fail(429, 'too_many_orders')

  const result = await createOrder(c.env.DB, {
    source: 'web',
    locale: p.lang,
    customer: {
      name: cu.name,
      email: cu.email,
      phone: cu.phone ?? null,
      street: cu.street ?? null,
      postcode: cu.postcode ?? null,
      city: cu.city ?? null,
      country: p.shipping === 'abroad' ? (cu.country ?? null) : 'Slovenija',
      note: cu.note ?? null
    },
    shippingMethod: p.shipping,
    items: p.items,
    createdBy: null,
    ipHash
  })
  return c.json({ number: result.number, itemsCents: result.itemsCents, shippingCents: result.shippingCents, totalCents: result.totalCents })
})
