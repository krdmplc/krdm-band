import { Hono } from 'hono'
import { z } from 'zod'
import { isValidUpnIban, normaliseIban } from '../../shared/upnqr'
import { endSession, hashPassword, loadMe, requireUser, sha256, startSession, verifyPassword } from '../lib/auth'
import { first, run } from '../lib/db'
import { type AppEnv, body, fail, nowIso, user } from '../lib/http'

export const auth = new Hono<AppEnv>()

auth.post('/login', async (c) => {
  const { email, password } = await body(c, z.object({ email: z.string().trim(), password: z.string() }))
  const u = await first<{ id: string, password_hash: string | null }>(c.env.DB,
    'SELECT id, password_hash FROM users WHERE email = ? AND disabled_at IS NULL', email)
  // Same answer and roughly the same time whether or not the account exists.
  const ok = await verifyPassword(password, u?.password_hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  if (!u || !u.password_hash || !ok) fail(401, 'bad_login')
  await startSession(c, u.id)
  return c.json(await loadMe(c.env.DB, u.id))
})

auth.post('/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

auth.get('/me', requireUser, (c) => c.json(user(c)))

async function findInvite (db: D1Database, token: string) {
  return await first<{ token_hash: string, user_id: string, name: string, email: string }>(db,
    `SELECT i.token_hash, i.user_id, u.name, u.email FROM invites i JOIN users u ON u.id = i.user_id
     WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ? AND u.disabled_at IS NULL`,
    await sha256(token), nowIso())
}

auth.get('/invite/:token', async (c) => {
  const invite = await findInvite(c.env.DB, c.req.param('token'))
  if (!invite) fail(404, 'invite_invalid')
  return c.json({ name: invite.name, email: invite.email })
})

auth.post('/invite/:token', async (c) => {
  const { password } = await body(c, z.object({ password: z.string().min(8).max(200) }))
  const invite = await findInvite(c.env.DB, c.req.param('token'))
  if (!invite) fail(404, 'invite_invalid')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), invite.user_id),
    c.env.DB.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').bind(nowIso(), invite.token_hash),
    // A reset signs out every other device.
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(invite.user_id)
  ])
  await startSession(c, invite.user_id)
  return c.json(await loadMe(c.env.DB, invite.user_id))
})

const profile = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(['sl', 'en']).optional(),
  iban: z.string().trim().max(40).nullable().optional(),
  street: z.string().trim().max(33).nullable().optional(),
  city: z.string().trim().max(33).nullable().optional(),
  flikPhone: z.string().trim().max(30).nullable().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(200).optional()
})

auth.patch('/me', requireUser, async (c) => {
  const me = user(c)
  const p = await body(c, profile)
  if (p.iban && !isValidUpnIban(p.iban)) fail(400, 'invalid_iban')
  if (p.newPassword) {
    const row = await first<{ password_hash: string | null }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', me.id)
    if (!row?.password_hash || !(await verifyPassword(p.currentPassword ?? '', row.password_hash))) fail(400, 'bad_password')
    await run(c.env.DB, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(p.newPassword), me.id)
  }
  await run(c.env.DB,
    `UPDATE users SET name = COALESCE(?, name), locale = COALESCE(?, locale),
       iban = CASE WHEN ? THEN ? ELSE iban END, street = CASE WHEN ? THEN ? ELSE street END,
       city = CASE WHEN ? THEN ? ELSE city END, flik_phone = CASE WHEN ? THEN ? ELSE flik_phone END
     WHERE id = ?`,
    p.name, p.locale,
    p.iban !== undefined ? 1 : 0, p.iban ? normaliseIban(p.iban) : null,
    p.street !== undefined ? 1 : 0, p.street || null,
    p.city !== undefined ? 1 : 0, p.city || null,
    p.flikPhone !== undefined ? 1 : 0, p.flikPhone || null,
    me.id)
  return c.json(await loadMe(c.env.DB, me.id))
})
