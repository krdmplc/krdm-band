import { Hono } from 'hono'
import { z } from 'zod'
import type { Owner, Tier } from '../../shared/types'
import type { ShippingSettings } from '../../shared/shipping'
import { requireUser } from '../lib/auth'
import { all, first, marks, stmt } from '../lib/db'
import { type AppEnv, body, fail, nowIso, user } from '../lib/http'
import { defaultSubscriptions } from '../lib/notify'
import { requireLabelAdmin } from '../lib/perms'

// Owners (bands and the label), price tiers and settings: small lists everyone reads
// and label admins change.
export const owners = new Hono<AppEnv>()
owners.use('*', requireUser)

owners.get('/owners', async (c) => {
  const rows = await all<{ id: string, name: string, kind: 'band' | 'label', archived_at: string | null }>(c.env.DB,
    "SELECT id, name, kind, archived_at FROM owners ORDER BY kind = 'band', name")
  const admins = await all<{ owner_id: string, id: string, name: string }>(c.env.DB,
    'SELECT a.owner_id, u.id, u.name FROM owner_admins a JOIN users u ON u.id = a.user_id ORDER BY u.name')
  return c.json(rows.map((r): Owner => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    archived: r.archived_at !== null,
    admins: admins.filter((a) => a.owner_id === r.id).map((a) => ({ id: a.id, name: a.name }))
  })))
})

const ownerInput = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['band', 'label']),
  adminIds: z.array(z.string()).default([])
})

owners.post('/owners', async (c) => {
  requireLabelAdmin(user(c))
  const p = await body(c, ownerInput)
  if (await first(c.env.DB, 'SELECT 1 FROM owners WHERE id = ?', p.id)) fail(409, 'id_taken')
  await c.env.DB.batch([
    stmt(c.env.DB, 'INSERT INTO owners (id, name, kind) VALUES (?, ?, ?)', p.id, p.name, p.kind),
    ...p.adminIds.flatMap((userId) => [
      stmt(c.env.DB, 'INSERT INTO owner_admins (owner_id, user_id) VALUES (?, ?)', p.id, userId),
      ...defaultSubscriptions(c.env.DB, userId, p.id)
    ])
  ])
  return c.json({ ok: true })
})

owners.patch('/owners/:id', async (c) => {
  requireLabelAdmin(user(c))
  const id = c.req.param('id')
  const p = await body(c, z.object({
    name: z.string().trim().min(1).max(80).optional(),
    archived: z.boolean().optional(),
    adminIds: z.array(z.string()).optional()
  }))
  const statements = [
    stmt(c.env.DB,
      'UPDATE owners SET name = COALESCE(?, name), archived_at = CASE WHEN ? IS NULL THEN archived_at WHEN ? = 1 THEN ? ELSE NULL END WHERE id = ?',
      p.name, p.archived === undefined ? null : 1, p.archived ? 1 : 0, nowIso(), id)
  ]
  if (p.adminIds) {
    const before = (await all<{ user_id: string }>(c.env.DB, 'SELECT user_id FROM owner_admins WHERE owner_id = ?', id)).map((r) => r.user_id)
    statements.push(stmt(c.env.DB, 'DELETE FROM owner_admins WHERE owner_id = ?', id))
    for (const userId of p.adminIds) {
      statements.push(stmt(c.env.DB, 'INSERT INTO owner_admins (owner_id, user_id) VALUES (?, ?)', id, userId))
      if (!before.includes(userId)) statements.push(...defaultSubscriptions(c.env.DB, userId, id))
    }
  }
  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

owners.get('/tiers', async (c) => {
  const rows = await all<{ id: string, name_sl: string, name_en: string }>(c.env.DB,
    'SELECT id, name_sl, name_en FROM price_tiers ORDER BY sort')
  return c.json(rows.map((r): Tier => ({ id: r.id, nameSl: r.name_sl, nameEn: r.name_en })))
})

// The whole list at once, in order. "full" stays; a removed tier takes its prices with it.
owners.put('/tiers', async (c) => {
  requireLabelAdmin(user(c))
  const { tiers } = await body(c, z.object({
    tiers: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      nameSl: z.string().trim().min(1).max(40),
      nameEn: z.string().trim().min(1).max(40)
    })).min(1)
  }))
  if (!tiers.some((t) => t.id === 'full')) fail(400, 'full_tier_required')
  const ids = tiers.map((t) => t.id)
  await c.env.DB.batch([
    stmt(c.env.DB, `DELETE FROM product_prices WHERE tier_id NOT IN (${marks(ids.length)})`, ...ids),
    stmt(c.env.DB, `DELETE FROM stand_prices WHERE tier_id NOT IN (${marks(ids.length)})`, ...ids),
    stmt(c.env.DB, `DELETE FROM price_tiers WHERE id NOT IN (${marks(ids.length)})`, ...ids),
    ...tiers.map((t, i) => stmt(c.env.DB,
      `INSERT INTO price_tiers (id, name_sl, name_en, sort) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name_sl = excluded.name_sl, name_en = excluded.name_en, sort = excluded.sort`,
      t.id, t.nameSl, t.nameEn, i))
  ])
  return c.json({ ok: true })
})

export async function shippingSettings (db: D1Database): Promise<ShippingSettings> {
  const row = await first<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'shipping'")
  return JSON.parse(row?.value ?? '{"packagingGrams":0,"packagingCents":0,"roundToCents":1,"brackets":[]}')
}

owners.get('/settings/shipping', async (c) => c.json(await shippingSettings(c.env.DB)))

owners.put('/settings/shipping', async (c) => {
  requireLabelAdmin(user(c))
  const p = await body(c, z.object({
    packagingGrams: z.number().int().min(0).max(5000),
    packagingCents: z.number().int().min(0).max(10000),
    roundToCents: z.number().int().min(1).max(1000),
    brackets: z.array(z.object({
      maxGrams: z.number().int().positive(),
      cents: z.number().int().min(0),
      service: z.string().trim().min(1).max(60)
    })).min(1)
  }))
  await stmt(c.env.DB, "INSERT OR REPLACE INTO settings (key, value) VALUES ('shipping', ?)", JSON.stringify(p)).run()
  return c.json({ ok: true })
})
