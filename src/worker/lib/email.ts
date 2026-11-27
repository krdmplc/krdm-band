// Notification emails through Cloudflare Email Sending (the EMAIL binding).
//
// It must cost nothing: on Workers Free, Email Sending delivers only to the
// account's *verified destination addresses* (Email Service → Email Routing →
// Destination addresses), and those sends are free. So email goes only to us
// (people with an app account whose address has been verified there), never to
// customers; a send to an unverified address fails, is logged and skipped, and the
// in-app notification is still there. Sending to customers would need Workers
// Paid, which this app must not use.
//
// Sent from band.krdm.si, a subdomain onboarded for sending (its SPF, DKIM and
// DMARC live under cf-bounce.band.krdm.si and _dmarc.band.krdm.si), so krdm.si's
// own mail (MX and SPF at Neoserv) is untouched.

import { all, marks } from './db'

export const EMAIL_FROM = { email: 'obvestila@band.krdm.si', name: 'KRDM band' }

export interface Mail {
  subject: string
  text: string
  // Replies go to the customer or the sender of the message.
  replyTo?: { email: string, name: string }
}

// One email per person, so one unverified address doesn't stop the others.
// Never throws: email is a convenience on top of the in-app notification.
export async function emailUsers (env: Env, userIds: string[], mail: Mail, preview: boolean): Promise<void> {
  if (userIds.length === 0) return
  const people = await all<{ email: string, name: string }>(env.DB,
    `SELECT email, name FROM users WHERE id IN (${marks(userIds.length)}) AND disabled_at IS NULL`, ...userIds)
  const subject = preview ? `[predogled] ${mail.subject}` : mail.subject
  await Promise.all(people.map(async (p) => {
    try {
      await env.EMAIL.send({
        from: EMAIL_FROM,
        to: { email: p.email, name: p.name },
        replyTo: mail.replyTo,
        subject,
        text: mail.text
      })
    } catch (err) {
      const e = err as { code?: string, message?: string }
      console.error('email not sent', p.email, e.code ?? '', e.message ?? String(err))
    }
  }))
}

// Previews run on preview data; their emails say so in the subject.
export const isPreview = (url: string) => {
  const host = new URL(url).hostname
  return host.endsWith('.workers.dev') && !host.startsWith('krdm-band.')
}
