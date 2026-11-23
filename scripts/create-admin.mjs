#!/usr/bin/env node
// Creates a label admin and prints a link to set their password. Use it once, for
// the first account; after that, admins invite people in the app.
//
//   node scripts/create-admin.mjs --name "Ime Priimek" --email ime@example.com
//   node scripts/create-admin.mjs --name … --email … --remote --url https://band.krdm.si
//   node scripts/create-admin.mjs --name … --email … --preview   (the Previews' database)

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    remote: { type: 'boolean', default: false },
    // The database every Preview shares (wrangler.jsonc, `previews`); implies --remote.
    preview: { type: 'boolean', default: false },
    url: { type: 'string' }
  }
})
if (!values.name || !values.email) {
  console.error('Usage: node scripts/create-admin.mjs --name "Name" --email you@example.com [--remote --url https://band.krdm.si | --preview]')
  process.exit(1)
}

const url = values.url ?? (values.preview ? 'https://main-krdm-band.krdm.workers.dev' : 'http://localhost:5173')
const target = values.preview
  ? ['krdm-band-preview', '--remote', '-c', 'wrangler.preview-migrations.jsonc']
  : ['krdm-band', values.remote ? '--remote' : '--local']

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const id = randomUUID()
const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
const expires = new Date(Date.now() + 14 * 86400_000).toISOString()

const sql = [
  `INSERT INTO users (id, name, email, is_label_admin) VALUES (${q(id)}, ${q(values.name)}, ${q(values.email)}, 1)`,
  `INSERT INTO invites (token_hash, user_id, expires_at) VALUES (${q(tokenHash)}, ${q(id)}, ${q(expires)})`,
  ...['order.new', 'stock.negative', 'sale.flagged'].map((t) =>
    `INSERT INTO subscriptions (user_id, topic, owner_id) VALUES (${q(id)}, ${q(t)}, '*')`)
].join('; ')

execFileSync('npx', ['wrangler', 'd1', 'execute', ...target, '--command', sql], { stdio: 'inherit' })
console.log(`\nSet the password here (valid 14 days):\n${url}/invite/${token}\n`)
