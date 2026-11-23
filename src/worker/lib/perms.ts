import type { Me } from '../../shared/types'
import { fail } from './http'

export const canAdmin = (u: Me, ownerId: string) => u.isLabelAdmin || u.adminOf.includes(ownerId)
export const isAnyAdmin = (u: Me) => u.isLabelAdmin || u.adminOf.length > 0

export function requireLabelAdmin (u: Me): void {
  if (!u.isLabelAdmin) fail(403, 'forbidden')
}

export function requireAnyAdmin (u: Me): void {
  if (!isAnyAdmin(u)) fail(403, 'forbidden')
}

export function requireOwnerAdmin (u: Me, ownerId: string): void {
  if (!canAdmin(u, ownerId)) fail(403, 'forbidden')
}
