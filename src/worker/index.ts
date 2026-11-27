import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { loadUser, sameOrigin } from './lib/auth'
import type { AppEnv } from './lib/http'
import { rebuildSiteIfChanged } from './lib/site'
import { auth } from './routes/auth'
import { messages } from './routes/messages'
import { money } from './routes/money'
import { notifications } from './routes/notifications'
import { orders } from './routes/orders'
import { owners } from './routes/owners'
import { products } from './routes/products'
import { publicApi } from './routes/public'
import { reports } from './routes/reports'
import { sales } from './routes/sales'
import { stands } from './routes/stands'
import { stock } from './routes/stock'
import { users } from './routes/users'

// The Worker serves the API (/api/*) and the product photos (/images/*). The
// PWA itself is static assets (see wrangler.jsonc).
const app = new Hono<AppEnv>()

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.json({ error: 'server_error' }, 500)
})

app.use('/api/public/*', cors({ origin: '*', allowMethods: ['GET', 'POST'], allowHeaders: ['Content-Type'], maxAge: 86400 }))
app.route('/api/public', publicApi)

app.get('/images/:key{.+}', async (c) => {
  const object = await c.env.IMAGES.get(c.req.param('key'))
  if (!object) return c.notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.has('content-type')) {
    const ext = c.req.param('key').split('.').pop()?.toLowerCase()
    headers.set('content-type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg')
  }
  headers.set('etag', object.httpEtag)
  // Keys are never reused, so a photo never changes.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(object.body, { headers })
})

app.use('/api/*', sameOrigin, loadUser)
app.route('/api/auth', auth)
app.route('/api/users', users)
app.route('/api', owners)
app.route('/api/products', products)
app.route('/api', stock)
app.route('/api/stands', stands)
app.route('/api/sales', sales)
app.route('/api/orders', orders)
app.route('/api/money', money)
app.route('/api/notifications', notifications)
app.route('/api/messages', messages)
app.route('/api/reports', reports)
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

export default {
  fetch: app.fetch,
  // Cron (wrangler.jsonc): rebuild the website when its merch changed (lib/site.ts).
  async scheduled (_controller, env, ctx) {
    ctx.waitUntil(rebuildSiteIfChanged(env))
  }
} satisfies ExportedHandler<Env>
