// Rules for what the website (krdm.si) sends: used by the public API
// (src/worker/routes/public.ts, lib/orders.ts) and tested in test/website.test.ts.

import type { ShippingMethod } from './types'

// The website's rules for its orders (setting `web_orders`, migration 0003): a
// minimum order, and free postage within Slovenia from a threshold on. The
// website states both in words (krdm-www hugo.toml [params.merch]); keep them equal.
export interface WebOrderRules {
  minOrderCents: number
  freePostageFromCents: number
}

export const freePostage = (rules: WebOrderRules, method: ShippingMethod, itemsCents: number) =>
  method === 'post' && rules.freePostageFromCents > 0 && itemsCents >= rules.freePostageFromCents

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

