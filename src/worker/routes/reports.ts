import { Hono } from 'hono'
import { z } from 'zod'
import type { ReportRow } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { averageCosts } from '../lib/catalog'
import { all } from '../lib/db'
import { type AppEnv, fail, user } from '../lib/http'
import { requireAnyAdmin } from '../lib/perms'

// Sales (stands and paid web orders) per event, product, owner or month, for the
// owners you manage. Cost uses each product's average purchase cost.
export const reports = new Hono<AppEnv>()
reports.use('*', requireUser)

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  group: z.enum(['stand', 'product', 'owner', 'month'])
})

reports.get('/sales', async (c) => {
  const me = user(c)
  requireAnyAdmin(me)
  const parsed = query.safeParse(c.req.query())
  if (!parsed.success) fail(400, 'invalid')
  const { from, to, group } = parsed.data
  const end = `${to}T23:59:59.999Z`
  const rows = await all<{ product_id: string, owner_id: string, qty: number, revenue: number, stand_id: string | null, stand_name: string | null, day: string, title: string, owner_name: string }>(c.env.DB,
    `SELECT x.*, p.title_sl AS title, o.name AS owner_name FROM (
       SELECT i.product_id, i.owner_id, i.qty, i.qty * i.unit_price_cents - i.discount_cents AS revenue,
         s.stand_id, st.name || ' (' || st.date || ')' AS stand_name, s.sold_at AS day
       FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN stands st ON st.id = s.stand_id
       WHERE s.voided_at IS NULL AND s.sold_at BETWEEN ? AND ?
       UNION ALL
       SELECT i.product_id, i.owner_id, i.qty, i.qty * i.unit_price_cents, NULL, NULL, o.paid_at
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status IN ('paid', 'shipped') AND o.paid_at BETWEEN ? AND ?
     ) x JOIN products p ON p.id = x.product_id JOIN owners o ON o.id = x.owner_id`,
    from, end, from, end)
  const mine = rows.filter((r) => me.isLabelAdmin || me.adminOf.includes(r.owner_id))
  const costs = await averageCosts(c.env.DB)
  const groups = new Map<string, ReportRow>()
  for (const r of mine) {
    const [key, label] =
      group === 'stand' ? [r.stand_id ?? 'web', r.stand_name ?? 'web']
        : group === 'product' ? [r.product_id, r.title]
          : group === 'owner' ? [r.owner_id, r.owner_name]
            : [r.day.slice(0, 7), r.day.slice(0, 7)]
    const g = groups.get(key) ?? { key, label, qty: 0, revenueCents: 0, costCents: 0 }
    g.qty += r.qty
    g.revenueCents += r.revenue
    const cost = costs.get(r.product_id)
    g.costCents = g.costCents === null || cost === undefined ? null : g.costCents + cost * r.qty
    groups.set(key, g)
  }
  const out = [...groups.values()]
  out.sort((a, b) => (group === 'month' ? a.key.localeCompare(b.key) : b.revenueCents - a.revenueCents))
  return c.json(out)
})
