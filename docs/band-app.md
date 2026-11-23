# KRDM band: the whole app

Status: written 2026-11-23, when the merch app was renamed. Merch is built; Music
is next (its brief: [music-brief.md](music-brief.md)); the rest is a direction,
not yet a brief.

## Goal

One back office for everything KRDM's bands and label do outside the practice
space: selling merch, putting out music, playing gigs, handling the money. It
runs on Cloudflare's free tier at **band.krdm.si**. Everyone signs in once and
sees what their bands need.

## Two apps, and the line between them

| App | Owns | Who runs it |
|---|---|---|
| **plc.krdm.si** (Plc) | The practice space: gear, rehearsal dates, keys, members of the space and their fees | Aleš |
| **band.krdm.si** (this app) | The bands and the label: merch, releases, gigs, payouts, the association's books | Martin |

If a feature is about the room or the equipment in it, it belongs to Plc. If it
is about a band or the label, it belongs here. The two apps share sign-in (see
Login), nothing else.

## Sections

| Section | Status | What it does |
|---|---|---|
| **Merch** | Built, see [merch-app-brief.md](merch-app-brief.md) | Stands at gigs (offline), stock, web orders, who holds whose money |
| **Music** | Next, see [music-brief.md](music-brief.md) | Releases and where they are live, artist profiles, stats, release guide, reminders, SAZAS and IPF |
| **Gigs** | Later | Offers and confirmed gigs, fees, riders, who drives. A merch stand is opened from a gig. The website's events could later come from here, like the merch catalog |
| **Money** | Partly built (merch pots) | Payouts to bands and members across merch, gigs and royalties, from the same ledger of transfers |
| **Društvo** | Later | The association's books: income and costs by category, membership fees, the annual report to AJPES, grant calls and the reports they need |
| **Contacts** | Later | Venues, promoters, radio, press, printers, studios. Shared by gigs, music promotion and merch reprints |

## What all sections share

- **Owners**: a band or the label. Their ids are the website's artist refs. A
  release, a product, a gig and a payout all belong to one owner.
- **People and roles**, checked on the server for every request:
  - **Label admin**: everything.
  - **Band admin**: everything of their bands.
  - **Band member** (new with Music): sees their bands' releases, stats and
    reminders, ticks off tasks. No money, no settings.
  - **Seller** (merch): the stands they are on and their own pots.

  One person can be a band admin of one band and a member of another.
- **Notifications**: in-app now, email when krdm.si's DNS is on Cloudflare.
  People subscribe to topics per band; each section adds its own topics.
- **Scheduled jobs**: Music needs a daily Cron Trigger (platform checks,
  reminders). Workers Free includes Cron Triggers; one daily job runs all of
  them.
- **It costs nothing.** The rules in AGENTS.md ("It must cost nothing") apply to
  every section. Outside APIs are only the free, keyless or free-tier ones.

## Login

Today the app has its own accounts: an admin invites someone with a one-time
link, they set a password, sessions last 30 days per device and work offline.

The plan is **"Login with Plc"**, so the people who already have a plc.krdm.si
account don't need a second password. Where those accounts will live is still
open with Aleš: the Plc app itself, or one small shared accounts service on
Cloudflare that Plc, this app and the CMS (Turbo SSO) all use. This app is built
so that either works:

- **Keep sign-in methods separate from people.** A person (`users`) can have a
  password and/or linked identities from an outside provider: a
  `user_identities` table (provider, the provider's stable subject id, user).
  `users.external_id` from the first migration becomes the first such link.
- **Link explicitly, never by email.** A signed-in person connects their Plc
  account from their profile, or an admin links it. Never merge accounts just
  because the emails match: that was the risk that shaped the CMS plan (see
  krdm-www `docs/cms-plc-sso-plan.md`).
- **Use OpenID Connect** if the provider can speak it (it is the simplest to
  run from a Worker). SAML only if the provider can do nothing else.
- **Who you are comes from the provider; what you may do stays here.** Bands,
  roles and stands are never read from Plc.
- **Not everyone is a Plc member.** Sellers and band members without a Plc
  account keep the invite-link accounts, and a band-only account must never
  count as a Plc member.
- Sessions stay this app's own (cookie, 30 days, sliding), so phones keep
  working offline and when the provider is down.

## Order of work

1. Music, first phase (see its brief): releases, where they are live, artist
   profiles, stats imports.
2. Merch "Next" items that wait for DNS and email, in step with the website
   switch-over.
3. Login with Plc, once Aleš has decided where accounts live.
4. Gigs, then Money (payouts across sections), then Društvo and Contacts.
