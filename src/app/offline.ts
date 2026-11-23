// Selling without a connection. Before a gig, "prepare" stores the stand's
// snapshot (products, stock in the box, prices, sellers) in IndexedDB and warms
// the photo cache. Every sale is written here first and uploaded by the outbox
// whenever there is a connection; the server ignores a sale it already has, so
// uploading twice is harmless.

import Dexie, { type EntityTable } from 'dexie'
import type { SaleInput, StandSnapshot, SyncResult } from '../shared/types'
import { ApiError, api, imageUrl } from './api'

export interface StoredSnapshot extends StandSnapshot {
  standId: string
  // When this phone asked for it. Sales uploaded before that are already in its stock.
  requestedAt: number
}

export interface OutboxSale extends SaleInput {
  status: 'pending' | 'synced' | 'rejected'
  error?: string
  flags?: string[]
  syncedAt?: number
  voided?: boolean
}

class MerchDb extends Dexie {
  snapshots!: EntityTable<StoredSnapshot, 'standId'>
  outbox!: EntityTable<OutboxSale, 'id'>

  constructor () {
    super('krdm-merch')
    this.version(1).stores({
      snapshots: '&standId',
      outbox: '&id, standId, status, soldAt'
    })
  }
}

export const db = new MerchDb()

export function deviceId (): string {
  let id = localStorage.getItem('merch.device')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('merch.device', id)
  }
  return id
}

export async function prepareStand (standId: string): Promise<StoredSnapshot> {
  const requestedAt = Date.now()
  const snapshot = await api.get<StandSnapshot>(`/api/stands/${standId}/snapshot`)
  const stored: StoredSnapshot = { ...snapshot, standId, requestedAt }
  await db.snapshots.put(stored)
  // Fetching the photos puts them in the service worker's cache.
  const keys = snapshot.products.map((p) => p.imageKey).filter((k): k is string => k !== null)
  await Promise.allSettled(keys.map((k) => fetch(imageUrl(k))))
  return stored
}

export async function recordSale (sale: SaleInput): Promise<void> {
  await db.outbox.put({ ...sale, status: 'pending' })
  void syncOutbox()
}

let syncing: Promise<void> | null = null

// Uploads pending sales. Returns when done; overlapping calls share one run.
export function syncOutbox (): Promise<void> {
  syncing ??= (async () => {
    try {
      const pending = await db.outbox.where('status').equals('pending').sortBy('soldAt')
      for (let i = 0; i < pending.length; i += 50) {
        const batch = pending.slice(i, i + 50)
        const sales: SaleInput[] = batch.map(({ status: _s, error: _e, flags: _f, syncedAt: _t, voided: _v, ...sale }) => sale)
        const { results } = await api.post<{ results: SyncResult[] }>('/api/sales/sync', { sales })
        const now = Date.now()
        await db.transaction('rw', db.outbox, async () => {
          for (const r of results) {
            await db.outbox.update(r.id, r.status === 'rejected'
              ? { status: 'rejected', error: r.error }
              : { status: 'synced', syncedAt: now, flags: r.flags })
          }
        })
      }
    } catch (e) {
      if (!(e instanceof ApiError && (e.code === 'offline' || e.status === 401))) console.error(e)
    } finally {
      syncing = null
    }
  })()
  return syncing
}

export function startBackgroundSync (): () => void {
  const run = () => { void syncOutbox() }
  window.addEventListener('online', run)
  const timer = window.setInterval(run, 30_000)
  run()
  return () => {
    window.removeEventListener('online', run)
    window.clearInterval(timer)
  }
}

// Stock left in the box as this phone knows it: the snapshot minus this phone's
// sales that the snapshot doesn't include yet.
export function remainingStock (snapshot: StoredSnapshot, sales: OutboxSale[]): Map<string, number> {
  const left = new Map<string, number>()
  for (const p of snapshot.products) for (const s of p.sizes) left.set(`${p.id}|${s.size}`, s.stock)
  for (const sale of sales) {
    if (sale.standId !== snapshot.standId || sale.voided || sale.status === 'rejected') continue
    const counted = sale.status === 'synced' && (sale.syncedAt ?? 0) < snapshot.requestedAt
    if (counted) continue
    for (const item of sale.items) {
      const key = `${item.productId}|${item.size}`
      left.set(key, (left.get(key) ?? 0) - item.qty)
    }
  }
  return left
}
