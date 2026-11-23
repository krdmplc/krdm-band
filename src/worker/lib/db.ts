// Thin helpers over D1. D1 refuses `undefined` as a parameter, so it becomes null.

const clean = (params: unknown[]) => params.map((p) => (p === undefined ? null : p))

export function stmt (db: D1Database, sql: string, ...params: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...clean(params))
}

export async function all<T> (db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await stmt(db, sql, ...params).all<T>()).results
}

export async function first<T> (db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return await stmt(db, sql, ...params).first<T>()
}

export async function run (db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return await stmt(db, sql, ...params).run()
}

// "?, ?, ?" for an IN (...) list.
export const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')

export const bool = (v: unknown) => v === 1 || v === true

// A person's pot for one owner has a predictable id, so it can be created with
// INSERT OR IGNORE right before a transfer into it.
export const personPotId = (ownerId: string, userId: string) => `p:${ownerId}:${userId}`

export function ensurePersonPot (db: D1Database, ownerId: string, userId: string): D1PreparedStatement {
  return stmt(db, "INSERT OR IGNORE INTO pots (id, kind, owner_id, user_id) VALUES (?, 'person', ?, ?)",
    personPotId(ownerId, userId), ownerId, userId)
}
