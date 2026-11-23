import { Hono } from 'hono'
import { z } from 'zod'
import type { UserAdmin, UserSummary } from '../../shared/types'
import { randomToken, requireUser, sha256 } from '../lib/auth'
import { all, first, stmt } from '../lib/db'
import { type AppEnv, type Ctx, body, fail, nowIso, uid, user } from '../lib/http'
import { defaultSubscriptions } from '../lib/notify'
import { requireLabelAdmin } from '../lib/perms'

export const users = new Hono<AppEnv>()
users.use('*', requireUser)

const INVITE_DAYS = 14

async function createInvite (c: Ctx, userId: string): Promise<string> {
  const token = randomToken()
  await stmt(c.env.DB, 'INSERT INTO invites (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)',
    await sha256(token), userId, new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString(), user(c).id).run()
  return `${new URL(c.req.url).origin}/invite/${token}`
}

// Everyone gets names (for picking sellers and receivers); label admins get the rest.
users.get('/', async (c) => {
  const me = user(c)
  if (!me.isLabelAdmin) {
    return c.json(await all<UserSummary>(c.env.DB, 'SELECT id, name FROM users WHERE disabled_at IS NULL ORDER BY name'))
  }
  const rows = await all<{ id: string, name: string, email: string, is_label_admin: number, disabled_at: string | null, has_password: number, admin_of: string | null }>(c.env.DB,
    `SELECT u.id, u.name, u.email, u.is_label_admin, u.disabled_at, u.password_hash IS NOT NULL AS has_password,
       (SELECT group_concat(owner_id) FROM owner_admins WHERE user_id = u.id) AS admin_of
     FROM users u ORDER BY u.disabled_at IS NOT NULL, u.name`)
  return c.json(rows.map((r): UserAdmin => ({
    id: r.id,
    name: r.name,
    email: r.email,
    isLabelAdmin: r.is_label_admin === 1,
    adminOf: r.admin_of ? r.admin_of.split(',') : [],
    disabled: r.disabled_at !== null,
    hasPassword: r.has_password === 1
  })))
})

users.post('/', async (c) => {
  requireLabelAdmin(user(c))
  const p = await body(c, z.object({
    name: z.string().trim().min(1).max(80),
    email: z.email().trim(),
    isLabelAdmin: z.boolean().default(false)
  }))
  if (await first(c.env.DB, 'SELECT 1 FROM users WHERE email = ?', p.email)) fail(409, 'email_taken')
  const id = uid()
  await c.env.DB.batch([
    stmt(c.env.DB, 'INSERT INTO users (id, name, email, is_label_admin) VALUES (?, ?, ?, ?)', id, p.name, p.email, p.isLabelAdmin ? 1 : 0),
    ...(p.isLabelAdmin ? defaultSubscriptions(c.env.DB, id, '*') : [])
  ])
  return c.json({ id, inviteUrl: await createInvite(c, id) })
})

users.patch('/:id', async (c) => {
  const me = user(c)
  requireLabelAdmin(me)
  const id = c.req.param('id')
  const p = await body(c, z.object({
    name: z.string().trim().min(1).max(80).optional(),
    email: z.email().trim().optional(),
    isLabelAdmin: z.boolean().optional(),
    disabled: z.boolean().optional()
  }))
  if (id === me.id && (p.isLabelAdmin === false || p.disabled)) fail(400, 'cannot_demote_self')
  if (p.email && await first(c.env.DB, 'SELECT 1 FROM users WHERE email = ? AND id != ?', p.email, id)) fail(409, 'email_taken')
  const statements = [
    stmt(c.env.DB,
      `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email),
         is_label_admin = COALESCE(?, is_label_admin),
         disabled_at = CASE WHEN ? IS NULL THEN disabled_at WHEN ? = 1 THEN ? ELSE NULL END
       WHERE id = ?`,
      p.name, p.email, p.isLabelAdmin === undefined ? null : (p.isLabelAdmin ? 1 : 0),
      p.disabled === undefined ? null : 1, p.disabled ? 1 : 0, nowIso(), id)
  ]
  if (p.disabled) statements.push(stmt(c.env.DB, 'DELETE FROM sessions WHERE user_id = ?', id))
  if (p.isLabelAdmin) statements.push(...defaultSubscriptions(c.env.DB, id, '*'))
  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

// A new link to set the password: for someone who lost the first one or forgot it.
users.post('/:id/invite', async (c) => {
  requireLabelAdmin(user(c))
  const id = c.req.param('id')
  if (!await first(c.env.DB, 'SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL', id)) fail(404, 'not_found')
  return c.json({ inviteUrl: await createInvite(c, id) })
})
