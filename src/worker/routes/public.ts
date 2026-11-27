import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { eur } from '../../shared/money'
import type { CatalogItem } from '../../shared/types'
import { sha256 } from '../lib/auth'
import { catalog } from '../lib/catalog'
import { all, first, stmt } from '../lib/db'
import { emailUsers, isPreview, type Mail } from '../lib/email'
import { type AppEnv, body, fail, uid } from '../lib/http'
import { notifySubscribers } from '../lib/notify'
import { createOrder, freePostage, quote, webOrderRules } from '../lib/orders'

// What the website (krdm.si) reads and sends. No sign-in, open to any origin
// (CORS is set in index.ts), because the site runs at www.krdm.si, on Netlify and
// Workers previews and on localhost. Stock counts never leave the app: only
// "available" per size.
export const publicApi = new Hono<AppEnv>()

const lang = (v: string | undefined) => (v === 'en' ? 'en' : 'sl')

publicApi.get('/catalog', async (c) => {
  const items: CatalogItem[] = await catalog(c.env.DB, lang(c.req.query('lang')), new URL(c.req.url).origin)
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
  // Without a full price nothing can be ordered (see lib/catalog.ts).
  const priced = new Set((await all<{ product_id: string }>(c.env.DB,
    "SELECT product_id FROM product_prices WHERE tier_id = 'full'")).map((r) => r.product_id))
  const out: Record<string, { available: boolean, sizes: Record<string, boolean> }> = {}
  for (const r of rows) {
    const entry = out[r.product_id] ??= { available: false, sizes: {} }
    entry.sizes[r.size] = priced.has(r.product_id) && (r.qty ?? 0) > 0
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

// Prices a cart with the website's rules: free postage from the threshold on.
publicApi.post('/quote', async (c) => {
  const p = await body(c, z.object({ items: lines, shipping: z.enum(['pickup', 'post', 'abroad']), lang: z.enum(['sl', 'en']).default('sl') }))
  const [q, rules] = await Promise.all([quote(c.env.DB, p.items, p.shipping, p.lang), webOrderRules(c.env.DB)])
  if (freePostage(rules, p.shipping, q.itemsCents)) Object.assign(q, { shippingCents: 0, totalCents: q.itemsCents })
  return c.json({ ...q, minOrderCents: rules.minOrderCents, freePostageFromCents: rules.freePostageFromCents })
})

const ORDERS_PER_IP_PER_HOUR = 5
const MESSAGES_PER_IP_PER_HOUR = 5

const ipHash = async (c: Context<AppEnv>) => await sha256(`${c.env.IP_SALT}|${c.req.header('cf-connecting-ip') ?? 'unknown'}`)
const hourAgo = () => new Date(Date.now() - 3600_000).toISOString()

// Emails go out after the response, so a slow or failed send never holds up
// the customer (lib/email.ts).
function sendLater (c: Context<AppEnv>, userIds: string[], mail: Mail) {
  c.executionCtx.waitUntil(emailUsers(c.env, userIds, mail, isPreview(c.req.url)))
}

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
  if (p.website) return c.json({ number: 'KRDM-0000-0000', itemsCents: 0, shippingCents: 0, totalCents: 0, freePostage: false })
  const cu = p.customer
  if (p.shipping !== 'pickup' && !(cu.street && cu.postcode && cu.city)) fail(400, 'address_required')
  if (p.shipping === 'abroad' && !cu.country) fail(400, 'address_required')

  const hash = await ipHash(c)
  const recent = await first<{ n: number }>(c.env.DB,
    'SELECT COUNT(*) AS n FROM orders WHERE ip_hash = ? AND created_at > ?', hash, hourAgo())
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
    ipHash: hash
  })
  sendLater(c, result.notified, await orderMail(c.env.DB, result.id, new URL(c.req.url).origin))
  return c.json({
    number: result.number,
    itemsCents: result.itemsCents,
    shippingCents: result.shippingCents,
    totalCents: result.totalCents,
    freePostage: result.freePostage
  })
})

const DELIVERY: Record<string, string> = { pickup: 'Osebni prevzem', post: 'Po pošti', abroad: 'Po pošti v tujino' }

// The order as Netlify used to email it to us: readable, the items first, in
// Slovenian whatever the customer's language (the email is for us). Replying
// writes to the customer.
async function orderMail (db: D1Database, orderId: string, origin: string): Promise<Mail> {
  const o = (await first<{
    number: string, customer_name: string, email: string, phone: string | null, street: string | null, postcode: string | null,
    city: string | null, country: string | null, note: string | null, shipping_method: string, items_cents: number,
    shipping_cents: number | null, locale: string
  }>(db, 'SELECT * FROM orders WHERE id = ?', orderId))!
  const items = await all<{ qty: number, title: string, size: string, unit_price_cents: number, owner: string }>(db,
    `SELECT i.qty, i.title, i.size, i.unit_price_cents, w.name AS owner FROM order_items i JOIN owners w ON w.id = i.owner_id
     WHERE i.order_id = ? ORDER BY i.id`, orderId)
  const lines = items.map((i) => [
    `${i.qty} × ${i.title}`, i.owner, i.size && `velikost ${i.size}`, eur(i.qty * i.unit_price_cents)
  ].filter(Boolean).join(' — '))
  const postage = o.shipping_method === 'pickup'
    ? ''
    : o.shipping_cents === 0
      ? ' (brezplačna poštnina)'
      : o.shipping_cents === null
        ? ' + poštnina (v tujino, izračunaj jo)'
        : ` + poštnina (po teži približno ${eur(o.shipping_cents)})`
  const address = [o.street, [o.postcode, o.city].filter(Boolean).join(' '), o.country].filter(Boolean).join(', ')
  const text = [
    `Naročilo ${o.number}`,
    '',
    ...lines,
    '',
    `Skupaj: ${eur(o.items_cents)}${postage}`,
    '',
    `Ime: ${o.customer_name}`,
    `E-pošta: ${o.email}`,
    o.phone ? `Telefon: ${o.phone}` : null,
    `Dostava: ${DELIVERY[o.shipping_method] ?? o.shipping_method}`,
    address ? `Naslov: ${address}` : null,
    o.note ? `Opomba: ${o.note}` : null,
    `Jezik: ${o.locale}`,
    '',
    `V aplikaciji: ${origin}/orders/${orderId}`,
    'Odgovor na to sporočilo gre kupcu.'
  ].filter((l) => l !== null).join('\n')
  return {
    subject: `Naročilo ${o.number}: ${o.customer_name}, ${eur(o.items_cents)}`,
    text,
    replyTo: { email: o.email, name: o.customer_name }
  }
}

// The contact form. With JS the website sends JSON and opens its own thank-you
// page; without JS (the form's only path that works without it) the browser
// posts the form here and is sent on to `thanks`, which must be a page of the
// website. Messages are stored for the app's Messages page and go to the people
// subscribed to contact.new, by email too.
const contactFields = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().max(200),
  message: z.string().trim().min(1).max(5000),
  lang: z.enum(['sl', 'en']).default('sl'),
  // Fields people never see; bots fill them in.
  website: z.string().optional(),
  'bot-field': z.string().optional(),
  thanks: z.string().optional()
})

// Where the no-JS form may send people back to: the website and its previews.
export function allowedThanks (url: string | undefined): URL | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname
    const ok = (u.protocol === 'https:' && (
      host === 'krdm.si' || host === 'www.krdm.si' ||
      host === 'krdm-www.netlify.app' || host.endsWith('--krdm-www.netlify.app') ||
      host === 'krdm-www.krdm.workers.dev' || host.endsWith('-krdm-www.krdm.workers.dev'))) ||
      (u.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1'))
    return ok ? u : null
  } catch {
    return null
  }
}

publicApi.post('/contact', async (c) => {
  const isForm = !(c.req.header('content-type') ?? '').includes('application/json')
  let raw: unknown
  if (isForm) {
    raw = Object.fromEntries(Object.entries(await c.req.parseBody()).filter(([, v]) => typeof v === 'string'))
  } else {
    try { raw = await c.req.json() } catch { fail(400, 'bad_json') }
  }
  const parsed = contactFields.safeParse(raw)
  const thanks = allowedThanks((raw as { thanks?: string } | null)?.thanks)
  const reply = (status: 200 | 400 | 429, error?: string) => {
    if (!isForm) return error ? c.json({ error }, status) : c.json({ ok: true })
    if (!error && thanks) return c.redirect(thanks.toString(), 303)
    return c.html(formPage(status === 200 ? null : error ?? 'invalid', (raw as { lang?: string } | null)?.lang === 'en' ? 'en' : 'sl'), status)
  }
  if (!parsed.success) return reply(400, 'invalid')
  const p = parsed.data
  if (p.website || p['bot-field']) return reply(200)

  const hash = await ipHash(c)
  const recent = await first<{ n: number }>(c.env.DB,
    'SELECT COUNT(*) AS n FROM contact_messages WHERE ip_hash = ? AND created_at > ?', hash, hourAgo())
  if ((recent?.n ?? 0) >= MESSAGES_PER_IP_PER_HOUR) return reply(429, 'too_many_messages')

  const id = uid()
  await stmt(c.env.DB, 'INSERT INTO contact_messages (id, name, email, message, locale, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
    id, p.name, p.email, p.message, p.lang, hash).run()
  const notified = await notifySubscribers(c.env.DB, 'contact.new', [], { name: p.name }, `/messages#${id}`)
  sendLater(c, notified, {
    subject: `Sporočilo s spletne strani: ${p.name}`,
    text: [
      `Ime: ${p.name}`,
      `E-pošta: ${p.email}`,
      `Jezik: ${p.lang}`,
      '',
      p.message,
      '',
      `V aplikaciji: ${new URL(c.req.url).origin}/messages`,
      'Odgovor na to sporočilo gre pošiljatelju.'
    ].join('\n'),
    replyTo: { email: p.email, name: p.name }
  })
  return reply(200)
})

// Shown only to people without JS, when the form can't send them to the
// website's thank-you page: a short note in their language and a way back.
function formPage (error: string | null, locale: 'sl' | 'en'): string {
  const t = (sl: string, en: string) => (locale === 'en' ? en : sl)
  const text = error === null
    ? t('Hvala, sporočilo je poslano. Odgovorimo ti po e-pošti.', 'Thanks, your message is on its way. We will reply by email.')
    : error === 'too_many_messages'
      ? t('Iz tvojega omrežja je bilo v zadnji uri poslanih preveč sporočil. Poskusi znova čez eno uro.', 'You have sent a lot of messages. Try again in an hour.')
      : t('Sporočila ni bilo mogoče poslati: preveri, ali so ime, e-pošta in sporočilo izpolnjeni.', 'The message couldn\'t be sent: check that your name, email and message are filled in.')
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>KRDM</title></head>
<body style="font-family: 'Courier New', monospace; max-width: 36rem; margin: 3rem auto; padding: 0 1rem">
<p>${text}</p><p><a href="https://www.krdm.si${locale === 'en' ? '/en/contact/' : '/kontakt/'}">${t('Nazaj na krdm.si', 'Back to krdm.si')}</a></p>
</body></html>`
}
