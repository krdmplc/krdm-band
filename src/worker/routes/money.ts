import { Hono } from 'hono'
import { z } from 'zod'
import type { Me, Pot, Transfer, TransferKind } from '../../shared/types'
import { requireUser } from '../lib/auth'
import { all, ensurePersonPot, first, personPotId, stmt } from '../lib/db'
import { type AppEnv, type Ctx, body, fail, nowIso, uid, user } from '../lib/http'
import { notifyStmt } from '../lib/notify'
import { canAdmin, requireOwnerAdmin } from '../lib/perms'

// Who holds whose money. See migrations/0001_init.sql (pots, transfers) and
// docs/brief.md (Money).
export const money = new Hono<AppEnv>()
money.use('*', requireUser)

export interface PotRow {
  id: string
  kind: 'person' | 'stash' | 'external'
  owner_id: string | null
  user_id: string | null
  keeper_id: string | null
  name: string | null
}

export async function potInfo (db: D1Database, id: string): Promise<PotRow | null> {
  return await first<PotRow>(db, 'SELECT id, kind, owner_id, user_id, keeper_id, name FROM pots WHERE id = ?', id)
}

// The person who confirms money coming in, and who may spend it.
export const holderOf = (pot: PotRow) => (pot.kind === 'person' ? pot.user_id : pot.kind === 'stash' ? pot.keeper_id : null)

export function canSpendFrom (me: Me, pot: PotRow): boolean {
  if (pot.kind === 'external') return false
  return holderOf(pot) === me.id || (pot.owner_id !== null && canAdmin(me, pot.owner_id))
}

const canSee = (me: Me, pot: PotRow) => holderOf(pot) === me.id || (pot.owner_id !== null && canAdmin(me, pot.owner_id))

export function transferStatement (db: D1Database, t: {
  ownerId: string
  fromPot: string
  toPot: string
  amountCents: number
  kind: TransferKind
  status: 'pending' | 'done'
  saleId?: string | null
  orderId?: string | null
  stockGroupId?: string | null
  note?: string | null
  createdBy: string
  id?: string
}): D1PreparedStatement {
  return stmt(db,
    `INSERT INTO transfers (id, owner_id, from_pot, to_pot, amount_cents, kind, status, sale_id, order_id, stock_group_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id ?? uid(), t.ownerId, t.fromPot, t.toPot, t.amountCents, t.kind, t.status, t.saleId, t.orderId, t.stockGroupId, t.note, t.createdBy)
}

money.get('/pots', async (c) => {
  const me = user(c)
  const rows = await all<PotRow & { holder_name: string | null, balance: number, pending_in: number, pending_out: number }>(c.env.DB,
    `SELECT p.id, p.kind, p.owner_id, p.user_id, p.keeper_id, p.name, COALESCE(u.name, k.name) AS holder_name,
       COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE to_pot = p.id AND status = 'done'), 0)
         - COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE from_pot = p.id AND status = 'done'), 0) AS balance,
       COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE to_pot = p.id AND status = 'pending'), 0) AS pending_in,
       COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE from_pot = p.id AND status = 'pending'), 0) AS pending_out
     FROM pots p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN users k ON k.id = p.keeper_id
     WHERE p.kind != 'external' AND p.archived_at IS NULL
     ORDER BY p.owner_id, p.kind DESC, holder_name`)
  return c.json(rows.filter((r) => canSee(me, r)).map((r): Pot => ({
    id: r.id,
    kind: r.kind,
    ownerId: r.owner_id,
    userId: r.user_id,
    name: r.name,
    keeperId: r.keeper_id,
    holderName: r.holder_name,
    balanceCents: r.balance,
    pendingInCents: r.pending_in,
    pendingOutCents: r.pending_out
  })))
})

// Where money can be handed over to: every band's stashes, without balances.
money.get('/stashes', async (c) => {
  return c.json(await all<{ id: string, ownerId: string, name: string, keeperId: string | null, keeperName: string | null }>(c.env.DB,
    `SELECT p.id, p.owner_id AS ownerId, p.name, p.keeper_id AS keeperId, u.name AS keeperName
     FROM pots p LEFT JOIN users u ON u.id = p.keeper_id WHERE p.kind = 'stash' AND p.archived_at IS NULL ORDER BY p.name`))
})

money.get('/transfers', async (c) => {
  const me = user(c)
  const potId = c.req.query('potId')
  const status = c.req.query('status')
  const rows = await all<{
    id: string, owner_id: string, from_pot: string, to_pot: string, amount_cents: number, kind: TransferKind,
    status: 'pending' | 'done' | 'rejected', note: string | null, created_by_name: string | null, created_at: string,
    f_kind: PotRow['kind'], f_user: string | null, f_keeper: string | null, f_label: string | null,
    t_kind: PotRow['kind'], t_user: string | null, t_keeper: string | null, t_label: string | null
  }>(c.env.DB,
    `SELECT t.id, t.owner_id, t.from_pot, t.to_pot, t.amount_cents, t.kind, t.status, t.note, cu.name AS created_by_name, t.created_at,
       f.kind AS f_kind, f.user_id AS f_user, f.keeper_id AS f_keeper, COALESCE(fu.name, f.name) AS f_label,
       tp.kind AS t_kind, tp.user_id AS t_user, tp.keeper_id AS t_keeper, COALESCE(tu.name, tp.name) AS t_label
     FROM transfers t
       JOIN pots f ON f.id = t.from_pot LEFT JOIN users fu ON fu.id = f.user_id
       JOIN pots tp ON tp.id = t.to_pot LEFT JOIN users tu ON tu.id = tp.user_id
       LEFT JOIN users cu ON cu.id = t.created_by
     WHERE (? IS NULL OR t.from_pot = ? OR t.to_pot = ?) AND (? IS NULL OR t.status = ?)
     ORDER BY t.created_at DESC LIMIT 300`,
    potId ?? null, potId ?? null, potId ?? null, status ?? null, status ?? null)
  const visible = rows.filter((r) => {
    const from: PotRow = { id: r.from_pot, kind: r.f_kind, owner_id: r.owner_id, user_id: r.f_user, keeper_id: r.f_keeper, name: null }
    const to: PotRow = { id: r.to_pot, kind: r.t_kind, owner_id: r.owner_id, user_id: r.t_user, keeper_id: r.t_keeper, name: null }
    return canSee(me, from) || canSee(me, to)
  })
  return c.json(visible.map((r): Transfer => {
    const toHolder = r.t_kind === 'person' ? r.t_user : r.t_kind === 'stash' ? r.t_keeper : null
    return {
      id: r.id,
      ownerId: r.owner_id,
      fromPot: r.from_pot,
      toPot: r.to_pot,
      fromLabel: r.f_label ?? r.from_pot,
      toLabel: r.t_label ?? r.to_pot,
      amountCents: r.amount_cents,
      kind: r.kind,
      status: r.status,
      note: r.note,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      canDecide: r.status === 'pending' && (toHolder === me.id || canAdmin(me, r.owner_id))
    }
  }))
})

const stashInput = z.object({
  ownerId: z.string(),
  name: z.string().trim().min(1).max(60),
  keeperId: z.string().nullable(),
  archived: z.boolean().optional()
})

money.post('/pots', async (c) => {
  const me = user(c)
  const p = await body(c, stashInput)
  requireOwnerAdmin(me, p.ownerId)
  const id = uid()
  await stmt(c.env.DB, "INSERT INTO pots (id, kind, owner_id, name, keeper_id) VALUES (?, 'stash', ?, ?, ?)", id, p.ownerId, p.name, p.keeperId).run()
  return c.json({ id })
})

money.put('/pots/:id', async (c) => {
  const me = user(c)
  const pot = await potInfo(c.env.DB, c.req.param('id'))
  if (!pot || pot.kind !== 'stash' || !pot.owner_id) fail(404, 'not_found')
  requireOwnerAdmin(me, pot.owner_id)
  const p = await body(c, stashInput.omit({ ownerId: true }))
  if (p.archived) {
    const bal = await first<{ b: number }>(c.env.DB,
      `SELECT COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE to_pot = ?1 AND status != 'rejected'), 0)
        - COALESCE((SELECT SUM(amount_cents) FROM transfers WHERE from_pot = ?1 AND status != 'rejected'), 0) AS b`, pot.id)
    if (bal && bal.b !== 0) fail(409, 'pot_not_empty')
  }
  await stmt(c.env.DB,
    'UPDATE pots SET name = ?, keeper_id = ?, archived_at = CASE WHEN ? = 1 THEN COALESCE(archived_at, ?) ELSE NULL END WHERE id = ?',
    p.name, p.keeperId, p.archived ? 1 : 0, nowIso(), pot.id).run()
  return c.json({ ok: true })
})

// Handing money over, paying for things, paying out. Money into a pot that
// someone else holds waits for them to confirm it.
money.post('/transfers', async (c) => {
  const me = user(c)
  const p = await body(c, z.object({
    ownerId: z.string(),
    fromPot: z.string(),
    // A pot id, or "person:<userId>" for that person's pot of this owner.
    toPot: z.string(),
    amountCents: z.number().int().positive(),
    kind: z.enum(['handover', 'expense', 'payout', 'correction']),
    note: z.string().trim().max(300).nullable().optional()
  }))
  const statements: D1PreparedStatement[] = []
  let toId = p.toPot
  if (toId.startsWith('person:')) {
    const userId = toId.slice('person:'.length)
    if (!await first(c.env.DB, 'SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL', userId)) fail(404, 'not_found')
    statements.push(ensurePersonPot(c.env.DB, p.ownerId, userId))
    toId = personPotId(p.ownerId, userId)
  }
  const from = await potInfo(c.env.DB, p.fromPot)
  const to = toId.startsWith('p:') ? { id: toId, kind: 'person' as const, owner_id: p.ownerId, user_id: toId.split(':')[2], keeper_id: null, name: null } : await potInfo(c.env.DB, toId)
  if (!from || !to || from.id === to.id) fail(400, 'invalid_pots')
  for (const pot of [from, to]) if (pot.kind !== 'external' && pot.owner_id !== p.ownerId) fail(400, 'pot_of_other_owner')
  if (p.kind === 'correction') requireOwnerAdmin(me, p.ownerId)
  else {
    if (!canSpendFrom(me, from)) fail(403, 'cannot_spend_from_pot')
    if (p.kind === 'expense' && to.id !== 'suppliers') fail(400, 'invalid_pots')
    if (p.kind === 'payout' && to.id !== 'payouts') fail(400, 'invalid_pots')
    if (p.kind === 'handover' && to.kind === 'external') fail(400, 'invalid_pots')
  }
  const holder = holderOf(to)
  const pending = to.kind !== 'external' && holder !== null && holder !== me.id
  const id = uid()
  statements.push(transferStatement(c.env.DB, {
    id, ownerId: p.ownerId, fromPot: from.id, toPot: to.id, amountCents: p.amountCents, kind: p.kind, status: pending ? 'pending' : 'done', note: p.note ?? null, createdBy: me.id
  }))
  if (pending && holder) {
    statements.push(notifyStmt(c.env.DB, holder, 'transfer.pending', { from: me.name, amountCents: p.amountCents, owner: p.ownerId }, '/money'))
  }
  await c.env.DB.batch(statements)
  return c.json({ id, status: pending ? 'pending' : 'done' })
})

async function decide (c: Ctx, outcome: 'done' | 'rejected') {
  const me = user(c)
  const t = await first<{ id: string, owner_id: string, to_pot: string, status: string, created_by: string, amount_cents: number }>(c.env.DB,
    'SELECT id, owner_id, to_pot, status, created_by, amount_cents FROM transfers WHERE id = ?', c.req.param('id'))
  if (!t || t.status !== 'pending') fail(404, 'not_found')
  const to = await potInfo(c.env.DB, t.to_pot)
  if (!to || (holderOf(to) !== me.id && !canAdmin(me, t.owner_id))) fail(403, 'forbidden')
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE transfers SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'", outcome, me.id, nowIso(), t.id),
    notifyStmt(c.env.DB, t.created_by, 'transfer.decided', { by: me.name, amountCents: t.amount_cents, outcome }, '/money')
  ])
  return c.json({ ok: true })
}

money.post('/transfers/:id/confirm', (c) => decide(c, 'done'))
money.post('/transfers/:id/reject', (c) => decide(c, 'rejected'))
