// Loading products with their sizes, prices, photos and stock, shared by the
// app's product pages, stand snapshots and the website's public API.

import type { Locale } from '../../shared/money'
import type { CatalogItem, Category, Product } from '../../shared/types'
import { all, marks } from './db'

interface ProductRow {
  id: string
  owner_id: string
  title_sl: string
  title_en: string
  description_sl: string
  description_en: string
  category: Category
  link: string | null
  release: string | null
  weight_g: number
  published: number
  archived_at: string | null
  sort: number
  artists: string
  created_at: string
  updated_at: string
}

export async function loadProducts (
  db: D1Database,
  opts: { ids?: string[], includeArchived?: boolean, publishedOnly?: boolean, costsFor?: (ownerId: string) => boolean } = {}
): Promise<Product[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.ids) {
    if (opts.ids.length === 0) return []
    where.push(`p.id IN (${marks(opts.ids.length)})`)
    params.push(...opts.ids)
  }
  if (!opts.includeArchived) where.push('p.archived_at IS NULL')
  if (opts.publishedOnly) where.push('p.published = 1')
  const rows = await all<ProductRow>(db,
    `SELECT p.* FROM products p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.archived_at IS NOT NULL, p.sort, p.created_at DESC`, ...params)
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const inIds = `(${marks(ids.length)})`
  const [sizes, prices, images, stock, costs] = await Promise.all([
    all<{ product_id: string, size: string }>(db, `SELECT product_id, size FROM product_sizes WHERE product_id IN ${inIds} ORDER BY sort`, ...ids),
    all<{ product_id: string, tier_id: string, price_cents: number }>(db, `SELECT * FROM product_prices WHERE product_id IN ${inIds}`, ...ids),
    all<{ id: string, product_id: string, key: string, width: number | null, height: number | null }>(db,
      `SELECT id, product_id, key, width, height FROM product_images WHERE product_id IN ${inIds} ORDER BY sort, created_at`, ...ids),
    all<{ product_id: string, size: string, online: number, qty: number }>(db,
      `SELECT e.product_id, e.size, l.online, SUM(e.qty) AS qty FROM stock_entries e JOIN locations l ON l.id = e.location_id
       WHERE e.product_id IN ${inIds} GROUP BY e.product_id, e.size, l.online`, ...ids),
    opts.costsFor ? averageCosts(db, ids) : Promise.resolve(new Map<string, number>())
  ])
  return rows.map((r): Product => {
    const stockAll: Record<string, number> = {}
    const stockOnline: Record<string, number> = {}
    const productSizes = sizes.filter((s) => s.product_id === r.id).map((s) => s.size)
    for (const size of productSizes) { stockAll[size] = 0; stockOnline[size] = 0 }
    for (const s of stock.filter((s) => s.product_id === r.id)) {
      stockAll[s.size] = (stockAll[s.size] ?? 0) + s.qty
      if (s.online === 1) stockOnline[s.size] = (stockOnline[s.size] ?? 0) + s.qty
    }
    const product: Product = {
      id: r.id,
      ownerId: r.owner_id,
      titleSl: r.title_sl,
      titleEn: r.title_en,
      descriptionSl: r.description_sl,
      descriptionEn: r.description_en,
      category: r.category,
      link: r.link,
      release: r.release,
      weightG: r.weight_g,
      published: r.published === 1,
      archived: r.archived_at !== null,
      sizes: productSizes,
      prices: Object.fromEntries(prices.filter((p) => p.product_id === r.id).map((p) => [p.tier_id, p.price_cents])),
      images: images.filter((i) => i.product_id === r.id).map(({ id, key, width, height }) => ({ id, key, width, height })),
      stock: stockAll,
      onlineStock: stockOnline,
      sort: r.sort,
      artists: JSON.parse(r.artists ?? '[]') as string[],
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
    if (opts.costsFor?.(r.owner_id)) product.avgCostCents = costs.get(r.id) ?? null
    return product
  })
}

// Moving average over every print run with a known cost.
export async function averageCosts (db: D1Database, productIds?: string[]): Promise<Map<string, number>> {
  const filter = productIds ? `AND product_id IN (${marks(productIds.length)})` : ''
  const rows = await all<{ product_id: string, avg: number }>(db,
    `SELECT product_id, CAST(ROUND(SUM(qty * unit_cost_cents) * 1.0 / SUM(qty)) AS INTEGER) AS avg
     FROM stock_entries WHERE type = 'received' AND unit_cost_cents IS NOT NULL AND qty > 0 ${filter}
     GROUP BY product_id`, ...(productIds ?? []))
  return new Map(rows.map((r) => [r.product_id, r.avg]))
}

// The website's catalog (GET /api/public/catalog, and the rebuild check in
// lib/site.ts): published products, in the app's order. One without a full
// price is listed as sold out (an old release kept for its Bandcamp link).
export async function catalog (db: D1Database, locale: Locale, origin: string): Promise<CatalogItem[]> {
  const [products, owners] = await Promise.all([
    loadProducts(db, { publishedOnly: true }),
    all<{ id: string, name: string, kind: 'band' | 'label' }>(db, 'SELECT id, name, kind FROM owners')
  ])
  const ownerById = new Map(owners.map((o) => [o.id, o]))
  return products
    .map((p): CatalogItem => {
      const priced = p.prices.full !== undefined
      const sizes = p.sizes.map((size) => ({ size, available: priced && (p.onlineStock[size] ?? 0) > 0 }))
      const owner = ownerById.get(p.ownerId)
      return {
        id: p.id,
        owner: { id: p.ownerId, name: owner?.name ?? p.ownerId, kind: owner?.kind ?? 'band' },
        artists: p.artists.length ? p.artists : owner?.kind === 'label' ? [] : [p.ownerId],
        title: (locale === 'en' && p.titleEn) || p.titleSl,
        description: (locale === 'en' && p.descriptionEn) || p.descriptionSl,
        category: p.category,
        link: p.link,
        release: p.release,
        priceCents: priced ? p.prices.full : null,
        weightG: p.weightG,
        images: p.images.map((i) => ({ url: `${origin}/images/${i.key}`, width: i.width, height: i.height })),
        sizes,
        available: sizes.some((s) => s.available),
        sort: p.sort,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }
    })
}
