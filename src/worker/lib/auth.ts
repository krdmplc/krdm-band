// Accounts live in this app until KRDM has a shared accounts service (see
// docs/band-app.md, Login). Passwords are set through one-time invite links that an
// admin passes on by hand, because the app sends no email yet.

import type { MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Me } from '../../shared/types'
import { all, first, run } from './db'
import { type AppEnv, type Ctx, fail } from './http'

const COOKIE = 'merch_session'
const SESSION_DAYS = 30
// Workers cap PBKDF2 at 100 000 iterations.
const ITERATIONS = 100_000
const enc = new TextEncoder()

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))

export function randomToken (): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function sha256 (text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function pbkdf2 (password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword (password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`
}

export async function verifyPassword (password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const actual = await pbkdf2(password, fromB64url(salt), Number(iter))
  const expected = fromB64url(hash)
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected)
}

interface UserRow {
  id: string
  name: string
  email: string
  locale: 'sl' | 'en'
  is_label_admin: number
  iban: string | null
  street: string | null
  city: string | null
  flik_phone: string | null
}

export async function loadMe (db: D1Database, userId: string): Promise<Me | null> {
  const u = await first<UserRow>(db,
    'SELECT id, name, email, locale, is_label_admin, iban, street, city, flik_phone FROM users WHERE id = ? AND disabled_at IS NULL',
    userId)
  if (!u) return null
  const isLabelAdmin = u.is_label_admin === 1
  const owners = isLabelAdmin
    ? await all<{ id: string }>(db, 'SELECT id FROM owners')
    : await all<{ id: string }>(db, 'SELECT owner_id AS id FROM owner_admins WHERE user_id = ?', userId)
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    locale: u.locale,
    isLabelAdmin,
    adminOf: owners.map((o) => o.id),
    iban: u.iban,
    street: u.street,
    city: u.city,
    flikPhone: u.flik_phone
  }
}

export async function startSession (c: Ctx, userId: string): Promise<void> {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
  await run(c.env.DB, 'INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)',
    await sha256(token), userId, expires.toISOString(), c.req.header('user-agent')?.slice(0, 200))
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    expires
  })
}

export async function endSession (c: Ctx): Promise<void> {
  const token = getCookie(c, COOKIE)
  if (token) await run(c.env.DB, 'DELETE FROM sessions WHERE token_hash = ?', await sha256(token))
  deleteCookie(c, COOKIE, { path: '/' })
}

// Reads the session cookie into c.var.user (or null). Sessions slide: every day
// of use pushes the expiry 30 days out, so a phone in use never gets signed out
// in the middle of a gig.
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null)
  const token = getCookie(c, COOKIE)
  if (token) {
    const hash = await sha256(token)
    const s = await first<{ user_id: string, expires_at: string }>(c.env.DB,
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?', hash, new Date().toISOString())
    if (s) {
      c.set('user', await loadMe(c.env.DB, s.user_id))
      const remaining = new Date(s.expires_at).getTime() - Date.now()
      if (remaining < (SESSION_DAYS - 1) * 86400_000) {
        const expires = new Date(Date.now() + SESSION_DAYS * 86400_000)
        await run(c.env.DB, 'UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expires.toISOString(), hash)
        setCookie(c, COOKIE, token, {
          httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', expires
        })
      }
    }
  }
  await next()
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) fail(401, 'signed_out')
  await next()
}

// Requests that change something must come from the app's own pages.
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('origin')
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && origin !== new URL(c.req.url).origin) {
    fail(403, 'cross_origin')
  }
  await next()
}
