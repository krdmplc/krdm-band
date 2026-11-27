// Rebuilding the website when its merch changes. krdm.si builds its merch pages
// from /api/public/catalog, so a new product, a new price or a new photo shows
// only after a build. A cron trigger (wrangler.jsonc, every 10 minutes) hashes the
// catalog without availability (which the website fetches live) and calls the
// site's build hook when the hash changed since the last call. Edits made within
// one interval share one build.
//
// SITE_BUILD_HOOK (a secret, production only): the URL to POST to, today the
// Netlify build hook of krdm-www. Without it nothing is called.

import { sha256 } from './auth'
import { catalog } from './catalog'
import { first, run } from './db'

const SETTING = 'site_catalog_hash'

export async function catalogHash (db: D1Database): Promise<string> {
  const [sl, en] = await Promise.all([catalog(db, 'sl', ''), catalog(db, 'en', '')])
  const strip = (items: typeof sl) => items.map(({ available, sizes, updatedAt, ...rest }) => ({ ...rest, sizes: sizes.map((s) => s.size) }))
  return await sha256(JSON.stringify([strip(sl), strip(en)]))
}

export async function rebuildSiteIfChanged (env: Env): Promise<void> {
  const hook = (env as { SITE_BUILD_HOOK?: string }).SITE_BUILD_HOOK
  if (!hook) return
  const hash = await catalogHash(env.DB)
  const last = await first<{ value: string }>(env.DB, 'SELECT value FROM settings WHERE key = ?', SETTING)
  if (last?.value === hash) return
  const res = await fetch(hook, { method: 'POST' })
  if (!res.ok) {
    console.error('site build hook failed', res.status)
    return
  }
  await run(env.DB, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', SETTING, hash)
}
