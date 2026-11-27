import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../lib/auth'
import { checkR2Upload, countR2Write } from '../lib/budget'
import { loadProducts } from '../lib/catalog'
import { all, first, stmt } from '../lib/db'
import { type AppEnv, body, fail, nowIso, uid, user } from '../lib/http'
import { canAdmin, requireOwnerAdmin } from '../lib/perms'

export const products = new Hono<AppEnv>()
products.use('*', requireUser)

products.get('/', async (c) => {
  const me = user(c)
  return c.json(await loadProducts(c.env.DB, {
    includeArchived: c.req.query('archived') === '1',
    costsFor: (ownerId) => canAdmin(me, ownerId)
  }))
})

products.get('/:id', async (c) => {
  const me = user(c)
  const [product] = await loadProducts(c.env.DB, { ids: [c.req.param('id')], includeArchived: true, costsFor: (o) => canAdmin(me, o) })
  if (!product) fail(404, 'not_found')
  return c.json(product)
})

const productInput = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(80),
  ownerId: z.string(),
  titleSl: z.string().trim().min(1).max(120),
  titleEn: z.string().trim().max(120),
  descriptionSl: z.string().max(5000),
  descriptionEn: z.string().max(5000),
  category: z.enum(['apparel', 'music', 'other']),
  link: z.url().nullable(),
  release: z.string().trim().max(80).nullable(),
  weightG: z.number().int().min(0).max(30000),
  sort: z.number().int().min(0).max(100000).default(0),
  artists: z.array(z.string().trim().regex(/^[a-z0-9-]+$/).max(80)).max(30).default([]),
  published: z.boolean(),
  archived: z.boolean().optional(),
  // [''] for one-size products.
  sizes: z.array(z.string().trim().max(20)).min(1),
  prices: z.record(z.string(), z.number().int().min(0))
})

function sizeAndPriceStatements (db: D1Database, id: string, sizes: string[], prices: Record<string, number>) {
  return [
    stmt(db, 'DELETE FROM product_sizes WHERE product_id = ?', id),
    ...sizes.map((size, i) => stmt(db, 'INSERT INTO product_sizes (product_id, size, sort) VALUES (?, ?, ?)', id, size, i)),
    stmt(db, 'DELETE FROM product_prices WHERE product_id = ?', id),
    ...Object.entries(prices).map(([tier, cents]) =>
      stmt(db, 'INSERT INTO product_prices (product_id, tier_id, price_cents) SELECT ?, id, ? FROM price_tiers WHERE id = ?', id, cents, tier))
  ]
}

function checkSizes (sizes: string[]): string[] {
  const clean = sizes.length === 1 && sizes[0] === '' ? [''] : sizes.filter((s) => s !== '')
  if (clean.length === 0 || new Set(clean).size !== clean.length) fail(400, 'invalid_sizes')
  return clean
}

products.post('/', async (c) => {
  const me = user(c)
  const p = await body(c, productInput)
  requireOwnerAdmin(me, p.ownerId)
  if (p.prices.full === undefined) fail(400, 'full_price_required')
  if (await first(c.env.DB, 'SELECT 1 FROM products WHERE id = ?', p.id)) fail(409, 'id_taken')
  const sizes = checkSizes(p.sizes)
  await c.env.DB.batch([
    stmt(c.env.DB,
      `INSERT INTO products (id, owner_id, title_sl, title_en, description_sl, description_en, category, link, release, weight_g, sort, artists, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, p.ownerId, p.titleSl, p.titleEn, p.descriptionSl, p.descriptionEn, p.category, p.link, p.release || null, p.weightG, p.sort,
      JSON.stringify(p.artists), p.published ? 1 : 0),
    ...sizeAndPriceStatements(c.env.DB, p.id, sizes, p.prices)
  ])
  return c.json({ id: p.id })
})

products.put('/:id', async (c) => {
  const me = user(c)
  const id = c.req.param('id')
  const existing = await first<{ owner_id: string }>(c.env.DB, 'SELECT owner_id FROM products WHERE id = ?', id)
  if (!existing) fail(404, 'not_found')
  requireOwnerAdmin(me, existing.owner_id)
  const p = await body(c, productInput.omit({ id: true }))
  requireOwnerAdmin(me, p.ownerId)
  if (p.prices.full === undefined) fail(400, 'full_price_required')
  const sizes = checkSizes(p.sizes)
  // A size can't disappear while pieces of it are recorded somewhere.
  const stocked = await all<{ size: string }>(c.env.DB,
    'SELECT size FROM stock_entries WHERE product_id = ? GROUP BY size HAVING SUM(qty) != 0', id)
  const dropped = stocked.map((s) => s.size).filter((s) => !sizes.includes(s))
  if (dropped.length) fail(409, 'size_has_stock', dropped)
  await c.env.DB.batch([
    stmt(c.env.DB,
      `UPDATE products SET owner_id = ?, title_sl = ?, title_en = ?, description_sl = ?, description_en = ?, category = ?,
         link = ?, release = ?, weight_g = ?, sort = ?, artists = ?, published = ?,
         archived_at = CASE WHEN ? = 1 THEN COALESCE(archived_at, ?) ELSE NULL END, updated_at = ?
       WHERE id = ?`,
      p.ownerId, p.titleSl, p.titleEn, p.descriptionSl, p.descriptionEn, p.category, p.link, p.release || null,
      p.weightG, p.sort, JSON.stringify(p.artists), p.published ? 1 : 0, p.archived ? 1 : 0, nowIso(), nowIso(), id),
    ...sizeAndPriceStatements(c.env.DB, id, sizes, p.prices)
  ])
  return c.json({ id })
})

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }

// The app shrinks photos before uploading (longest side 2000 px) and sends their size.
// Uploads are capped to keep R2 free (lib/budget.ts).
products.post('/:id/images', async (c) => {
  const me = user(c)
  const id = c.req.param('id')
  const product = await first<{ owner_id: string }>(c.env.DB, 'SELECT owner_id FROM products WHERE id = ?', id)
  if (!product) fail(404, 'not_found')
  requireOwnerAdmin(me, product.owner_id)
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File) || !IMAGE_TYPES[file.type]) fail(400, 'invalid_image')
  await checkR2Upload(c.env.DB, file.size)
  const imageId = uid()
  const key = `products/${id}/${imageId}.${IMAGE_TYPES[file.type]}`
  await countR2Write(c.env.DB).run()
  await c.env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })
  const width = Number(form.get('width')) || null
  const height = Number(form.get('height')) || null
  await c.env.DB.batch([
    stmt(c.env.DB,
      'INSERT INTO product_images (id, product_id, key, width, height, bytes, sort) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM product_images WHERE product_id = ?))',
      imageId, id, key, width, height, file.size, id),
    stmt(c.env.DB, 'UPDATE products SET updated_at = ? WHERE id = ?', nowIso(), id)
  ])
  return c.json({ id: imageId, key, width, height })
})

products.put('/:id/images', async (c) => {
  const me = user(c)
  const id = c.req.param('id')
  const product = await first<{ owner_id: string }>(c.env.DB, 'SELECT owner_id FROM products WHERE id = ?', id)
  if (!product) fail(404, 'not_found')
  requireOwnerAdmin(me, product.owner_id)
  const { order } = await body(c, z.object({ order: z.array(z.string()) }))
  const current = await all<{ id: string, key: string }>(c.env.DB, 'SELECT id, key FROM product_images WHERE product_id = ?', id)
  const removed = current.filter((img) => !order.includes(img.id))
  await c.env.DB.batch([
    ...removed.map((img) => stmt(c.env.DB, 'DELETE FROM product_images WHERE id = ?', img.id)),
    ...order.map((imageId, i) => stmt(c.env.DB, 'UPDATE product_images SET sort = ? WHERE id = ? AND product_id = ?', i, imageId, id)),
    stmt(c.env.DB, 'UPDATE products SET updated_at = ? WHERE id = ?', nowIso(), id)
  ])
  if (removed.length) await c.env.IMAGES.delete(removed.map((img) => img.key))
  return c.json({ ok: true })
})
