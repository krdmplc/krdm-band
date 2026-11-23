# AGENTS.md

Guidance for AI coding agents (and humans) working on **KRDM merch**, the back
office for selling the merch of KRDM's bands and label: at gigs (often without
signal), from home stock, and through orders from the website (krdm.si). What
it is for and why it is shaped this way: [docs/merch-app-brief.md](docs/merch-app-brief.md).
The physical gig box the stands follow: [docs/merch-gig-box.md](docs/merch-gig-box.md).

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
- **Migrations**: never edit one that has been applied anywhere remote; add the
  next number. `0001_init.sql` has not been deployed yet (2026-11-22), so it may
  still change until the first deploy — then this line goes.

## Deploying (not done yet)

```bash
npx wrangler d1 create krdm-merch            # put the id into wrangler.jsonc
npx wrangler r2 bucket create krdm-merch-images
npx wrangler secret put IP_SALT              # any long random string
npm run db:migrate:remote
npm run deploy
node scripts/create-admin.mjs --name "…" --email … --remote --url https://merch.krdm.si
```

Then attach `merch.krdm.si` (see the brief, "Hosting and domain"). Don't commit
secrets; `.dev.vars` is ignored.

## Not built yet

See the end of the brief ("Next"): box templates, deployment, the website
switch-over (in krdm-www), email, data retention for orders.

## Housekeeping

- Don't commit `node_modules/`, `dist/`, `.wrangler/`, `build/` or `.dev.vars`.
- Don't commit or push unless asked.
