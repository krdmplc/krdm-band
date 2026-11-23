// This app must stay on Cloudflare's free tiers: going over means something is
// wrong (a bug, abuse), so it fails instead of paying.
//
// - Workers (Free plan): 100 000 requests a day, then requests fail. Not billed.
// - D1 (Free plan): daily read/write limits, then queries fail. Not billed.
// - R2 is billed past its free tier (10 GB-month stored, 1M Class A writes and
//   10M Class B reads a month), and Cloudflare has no hard cap for it. Reads only
//   happen through the Worker (/images/*), so the Workers limit keeps them under
//   3.1M a month. Writes and storage only come from photo uploads, capped here.

import { first, stmt } from './db'
import { fail } from './http'

export const R2_LIMITS = {
  // Under half the free storage, so a mistake has room before it costs.
  storedBytes: 4 * 1024 ** 3,
  // 2 % of the free Class A operations.
  writesPerMonth: 20_000,
  // The app shrinks photos to ~2000 px before uploading; this is the ceiling.
  imageBytes: 3_000_000
}

const month = () => new Date().toISOString().slice(0, 7)

// Throws before an upload that would leave the free tier.
export async function checkR2Upload (db: D1Database, bytes: number): Promise<void> {
  if (bytes > R2_LIMITS.imageBytes) fail(400, 'image_too_large')
  const usage = await first<{ stored: number, writes: number }>(db,
    `SELECT (SELECT COALESCE(SUM(bytes), 0) FROM product_images) AS stored,
       COALESCE((SELECT writes FROM r2_usage WHERE month = ?), 0) AS writes`, month())
  if ((usage?.stored ?? 0) + bytes > R2_LIMITS.storedBytes) fail(409, 'storage_full')
  if ((usage?.writes ?? 0) >= R2_LIMITS.writesPerMonth) fail(429, 'too_many_uploads')
}

export function countR2Write (db: D1Database): D1PreparedStatement {
  return stmt(db, 'INSERT INTO r2_usage (month, writes) VALUES (?, 1) ON CONFLICT (month) DO UPDATE SET writes = writes + 1', month())
}
