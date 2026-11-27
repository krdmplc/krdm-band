import { Hono } from 'hono'
import { z } from 'zod'
import type { ContactMessage } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, run } from '../lib/db'
import { type AppEnv, body, nowIso, user } from '../lib/http'
import { requireLabelAdmin } from '../lib/perms'

// Messages from the website's contact form (stored by POST /api/public/contact).
// They aren't any band's, so only label admins read them.
export const messages = new Hono<AppEnv>()
messages.use('*', requireUser)

messages.get('/', async (c) => {
  requireLabelAdmin(user(c))
  const rows = await all<{
    id: string, name: string, email: string, message: string, locale: string,
    handled_at: string | null, handled_by_name: string | null, created_at: string
  }>(c.env.DB,
    `SELECT m.id, m.name, m.email, m.message, m.locale, m.handled_at, u.name AS handled_by_name, m.created_at
     FROM contact_messages m LEFT JOIN users u ON u.id = m.handled_by
     ORDER BY m.handled_at IS NOT NULL, m.created_at DESC LIMIT 200`)
  return c.json(rows.map((r): ContactMessage => ({
    id: r.id,
    name: r.name,
    email: r.email,
    message: r.message,
    locale: r.locale === 'en' ? 'en' : 'sl',
    handledAt: r.handled_at,
    handledBy: r.handled_by_name,
    createdAt: r.created_at
  })))
})

messages.post('/:id/handled', async (c) => {
  const me = user(c)
  requireLabelAdmin(me)
  const { handled } = await body(c, z.object({ handled: z.boolean() }))
  await run(c.env.DB, 'UPDATE contact_messages SET handled_at = ?, handled_by = ? WHERE id = ?',
    handled ? nowIso() : null, handled ? me.id : null, c.req.param('id'))
  return c.json({ ok: true })
})
