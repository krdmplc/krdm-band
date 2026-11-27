// In-app notifications. Web orders and contact messages are also emailed to the
// people notified (lib/email.ts, only to verified addresses).
//
// Topics people subscribe to, per owner or for all ('*'):
//   order.new       a web or manual order with that owner's items
//   stock.negative  more sold than recorded (fix with a count)
//   sale.flagged    an uploaded sale broke a rule (discount without the right)
//   contact.new     a message from the website's contact form (only '*')
// Sent to one person directly, no subscription:
//   transfer.pending  money handed to you, waiting for your confirmation
//   transfer.decided  your handover was confirmed or rejected

import { all, marks, stmt } from './db'

export const SUBSCRIBABLE = ['order.new', 'stock.negative', 'sale.flagged', 'contact.new'] as const

export async function notifySubscribers (
  db: D1Database,
  topic: (typeof SUBSCRIBABLE)[number],
  ownerIds: string[],
  params: Record<string, string | number>,
  link: string | null,
  exceptUserId?: string
): Promise<string[]> {
  const owners = [...new Set([...ownerIds, '*'])]
  const users = await all<{ user_id: string }>(db,
    `SELECT DISTINCT s.user_id FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.topic = ? AND s.owner_id IN (${marks(owners.length)}) AND u.disabled_at IS NULL`,
    topic, ...owners)
  const targets = users.map((u) => u.user_id).filter((id) => id !== exceptUserId)
  if (targets.length === 0) return []
  await db.batch(targets.map((userId) => notifyStmt(db, userId, topic, params, link)))
  return targets
}

export function notifyStmt (
  db: D1Database,
  userId: string,
  topic: string,
  params: Record<string, string | number>,
  link: string | null
): D1PreparedStatement {
  return stmt(db, 'INSERT INTO notifications (user_id, topic, params, link) VALUES (?, ?, ?, ?)',
    userId, topic, JSON.stringify(params), link)
}

// New admins get the notifications they will want; they can change them later.
// Contact messages aren't a band's, so they are only for label admins ('*').
export function defaultSubscriptions (db: D1Database, userId: string, ownerId: string): D1PreparedStatement[] {
  return SUBSCRIBABLE.filter((topic) => topic !== 'contact.new' || ownerId === '*').map((topic) =>
    stmt(db, 'INSERT OR IGNORE INTO subscriptions (user_id, topic, owner_id) VALUES (?, ?, ?)', userId, topic, ownerId))
}
