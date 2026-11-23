# AGENTS.md

Guidance for AI coding agents (and humans) working on **KRDM band**
(band.krdm.si), the back office of KRDM's bands and label. It is one app with
sections that share people, bands (`owners`) and logins:

- **Merch** (built): selling at gigs (often without signal), from home stock,
  and through orders from the website (krdm.si).
  [docs/merch-app-brief.md](docs/merch-app-brief.md); the physical gig box the
  stands follow: [docs/merch-gig-box.md](docs/merch-gig-box.md).
- **Music** (next): releases, platforms, stats, rights.
  [docs/music-brief.md](docs/music-brief.md).
- The whole app, its later sections and its login:
  [docs/band-app.md](docs/band-app.md).

The practice space, gear and rehearsal dates are the Plc app's (plc.krdm.si);
don't build them here.

The app was called "KRDM merch" until 2026-11-23. Some internal names keep
"merch" on purpose, because changing them would lose data or sign people out:
the D1 database `krdm-merch`, the R2 bucket `krdm-merch-images`, the IndexedDB
`krdm-merch`, the `merch.*` localStorage keys and the `merch_session` cookie.

Stack: **Cloudflare Workers** (one Worker: the API with Hono, the photos, and the
PWA as static assets) + **D1** (SQLite) + **R2** (photos). The PWA is **React +
Mantine** (back-office components), React Router, TanStack Query, and **Dexie**
(IndexedDB) for selling offline. Built with Vite and `@cloudflare/vite-plugin`.

## Commands

```bash
npm ci
npm run db:migrate:local                      # create/upgrade the local D1 database
node scripts/create-admin.mjs --name "…" --email you@example.com   # first account; prints a link to set the password
npm run dev                                   # app + API on http://localhost:5173 (Worker runs in workerd)
npm run check                                 # tsc -b, vitest, vite build: the verification story
```

Local data lives in `.wrangler/state` (delete it to start over). `.dev.vars` holds
local secrets (`IP_SALT`).

Importing the website's merch (once, into an empty database):

```bash
node scripts/import-hugo.mjs ../krdm-www      # writes build/import.sql and build/import-images.sh
npx wrangler d1 execute krdm-merch --local --file build/import.sql
sh build/import-images.sh --local
```

There are unit tests for the shared logic (`test/`); the API is checked end to
end against the dev server. **Try what you change in a browser at phone width
(390 px) and offline** (DevTools → Network → Offline) when it touches selling.

## How it fits together

- `src/worker/`: the API. `index.ts` mounts the routes; `lib/` holds auth,
  database helpers, permissions, notifications, catalog loading and order
  creation. `/api/public/*` is the website's API (no sign-in, CORS `*`).
- `src/app/`: the PWA. `offline.ts` is the offline model, `session.tsx` the
  signed-in person (cached for offline), `ui.tsx` shared hooks and components,
  `pages/` one file per area.
- `src/shared/`: types of the JSON both sides exchange, money, shipping and the
  UPN QR payload.
- `migrations/`: D1 migrations, applied in order. `0001_init.sql` explains the
  data model in comments.
- `public/sw.js`: the service worker (app shell and photos cached, the API never).

## Rules of the data model

- **Money is integer cents** everywhere, as `*_cents` / `*Cents`.
- **Stock and money are never stored as totals.** Stock is the sum of
  `stock_entries`; a pot's balance is the sum of `transfers`. Only add rows:
  a correction is a new entry (`counted`, `correction`, `refund`, `returned`),
  never an UPDATE of an old one. That is what makes offline phones conflict-free.
- **Sales are made on phones** with ids made there, and uploaded by
  `/api/sales/sync`, which must stay idempotent (a sale it already has is a
  `duplicate`). A sale that broke a rule is stored with `flags`, not refused:
  it happened.
- Every item has **one owner** (a band or the label); the money for it belongs
  to that owner, whoever sold it. Person pots have the id `p:<owner>:<user>`.
- **Stock counts are internal.** The public API says only available or not, per
  size. Purchase costs are only for the owner's admins.
- One-size products have the size `''`.

## Permissions

Checked on the server for every request (`lib/perms.ts`), never only by hiding
buttons. Label admin: everything. Band admin (`owner_admins`): that band's
products, stock, orders and money, discounts at a stand. Seller: the stands they
are on, their own pots. A location's keeper may move and count its stock.

## Conventions

- **Words**: every string a page shows is a Slovenian + English pair where it is
  used: `t('Shrani', 'Save')` (`i18n.tsx`). API errors are codes translated in
  `errorText()`. Slovenian: informal *ti*, never gendered for the reader (no
  "poslal/a"; rephrase).
- **Look**: the website's "Plc zine" (paper, ink, flyer green, square corners,
  hard rules) applied to Mantine in `theme.ts`. Use Mantine components and theme
  colours, not hand-made CSS or raw colours. Special Elite is for headings only.
- Comments say what a piece is for and why, above it.
- Keep `public/sw.js` and `index.html` working together: the worker caches what
  `index.html` links. One JS bundle on purpose.
- **Migrations**: never edit one that has been applied remotely (all of them,
  since 2026-11-23); add the next number, and apply it with
  `npm run db:migrate:remote` before deploying code that needs it.

## Deploying

The Worker (`krdm-band`), D1 database (`krdm-merch`, Western Europe) and R2
bucket (`krdm-merch-images`) live in the "Martin Jagodic Personal" Cloudflare
account (`account_id` in `wrangler.jsonc`). It runs at
https://krdm-band.martinjagodic.workers.dev until `band.krdm.si` is needed;
krdm.si's DNS moves to Cloudflare then (see the merch brief, "Hosting and
domain"). Before the rename it ran as the Worker `krdm-merch` at
https://krdm-merch.martinjagodic.workers.dev; delete that Worker once the phones
have synced and everyone uses the new address (IndexedDB and sign-ins are per
address, so unsynced sales on a phone stay at the old one).

```bash
npm run db:migrate:remote                    # first, if there is a new migration
npm run deploy                               # build + wrangler deploy
```

One-time setup, done on 2026-11-23: `wrangler d1 create krdm-merch --location weur`,
`wrangler r2 bucket create krdm-merch-images --location weur` (R2 commands need
`CLOUDFLARE_ACCOUNT_ID` set), `wrangler secret put IP_SALT` (a long random
string), and the website's merch imported with `scripts/import-hugo.mjs`. The
first account: `node scripts/create-admin.mjs --name "…" --email … --remote --url
https://krdm-band.martinjagodic.workers.dev`. Don't commit secrets; `.dev.vars`
is ignored.

## It must cost nothing

The app runs on Cloudflare's free tiers, and going over one means something is
wrong, so the app fails rather than pays. Workers and D1 on the Free plan stop
at their daily limits and are never billed. R2 is billed past its free tier and
Cloudflare offers no hard cap for it, so `src/worker/lib/budget.ts` refuses
uploads beyond 4 GB stored or 20 000 writes a month; reads only go through the
Worker, which the Workers limit keeps far below R2's free reads. Don't add a
path that reads or writes R2 without going through those limits, don't serve the
bucket publicly (an `r2.dev` URL or a custom domain on it bypasses the Worker),
and don't move the account to Workers Paid. A budget alert on the account emails
on any spend (Billing → Billable Usage).

## Not built yet

Merch: see the end of its brief ("Next"): box templates, the website
switch-over (in krdm-www), email, data retention for orders. Music and the
later sections: [docs/band-app.md](docs/band-app.md) and
[docs/music-brief.md](docs/music-brief.md).

## Housekeeping

- Don't commit `node_modules/`, `dist/`, `.wrangler/`, `build/` or `.dev.vars`.
- Don't commit or push unless asked.
