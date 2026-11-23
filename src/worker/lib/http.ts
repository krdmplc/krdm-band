import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'
import type { Me } from '../../shared/types'

export interface AppEnv {
  Bindings: Env
  Variables: { user: Me | null }
}

export type Ctx = Context<AppEnv>

// Errors are JSON with a stable code the app translates: { error: 'out_of_stock', detail }.
export function fail (status: 400 | 401 | 403 | 404 | 409 | 429, error: string, detail?: unknown): never {
  throw new HTTPException(status, { res: Response.json({ error, detail }, { status }) })
}

export async function body<T extends z.ZodType> (c: Ctx, schema: T): Promise<z.infer<T>> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    fail(400, 'bad_json')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) fail(400, 'invalid', parsed.error.issues)
  return parsed.data
}

export function user (c: Ctx): Me {
  const u = c.get('user')
  if (!u) fail(401, 'signed_out')
  return u
}

export const uid = () => crypto.randomUUID()
export const nowIso = () => new Date().toISOString()
