import { Hono } from 'hono'
import { z } from 'zod'
import type { Notification } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, stmt } from '../lib/db'
import { type AppEnv, body, nowIso, user } from '../lib/http'
import { SUBSCRIBABLE } from '../lib/notify'

export const notifications = new Hono<AppEnv>()
notifications.use('*', requireUser)

notifications.get('/', async (c) => {
  const me = user(c)
  const rows = await all<{ id: number, topic: string, params: string, link: string | null, read_at: string | null, created_at: string }>(c.env.DB,
    'SELECT id, topic, params, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', me.id)
  return c.json(rows.map((r): Notification => ({
    id: r.id, topic: r.topic, params: JSON.parse(r.params), link: r.link, read: r.read_at !== null, createdAt: r.created_at
  })))
})

notifications.post('/read', async (c) => {
  const me = user(c)
  const { ids } = await body(c, z.object({ ids: z.array(z.number().int()).optional() }))
  if (ids?.length) {
    await c.env.DB.batch(ids.map((id) => stmt(c.env.DB, 'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), id, me.id)))
  } else {
    await stmt(c.env.DB, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), me.id).run()
  }
  return c.json({ ok: true })
})

notifications.get('/subscriptions', async (c) => {
  const me = user(c)
  return c.json(await all<{ topic: string, ownerId: string }>(c.env.DB,
    'SELECT topic, owner_id AS ownerId FROM subscriptions WHERE user_id = ?', me.id))
})

notifications.put('/subscriptions', async (c) => {
  const me = user(c)
  const { items } = await body(c, z.object({
    items: z.array(z.object({ topic: z.enum(SUBSCRIBABLE), ownerId: z.string() })).max(500)
  }))
  await c.env.DB.batch([
    stmt(c.env.DB, 'DELETE FROM subscriptions WHERE user_id = ?', me.id),
    ...items.map((i) => stmt(c.env.DB, 'INSERT OR IGNORE INTO subscriptions (user_id, topic, owner_id) VALUES (?, ?, ?)', me.id, i.topic, i.ownerId))
  ])
  return c.json({ ok: true })
})
