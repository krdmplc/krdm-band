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
the IndexedDB `krdm-merch`, the `merch.*` localStorage keys and the
`merch_session` cookie. (The D1 database and R2 bucket were renamed when the app
moved to the KRDM Cloudflare account; see Deploying.)

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
npx wrangler d1 execute krdm-band --local --file build/import.sql
sh build/import-images.sh --local
```

There are unit tests for the shared logic (`test/`); the API is checked end to
end against the dev server. **Try what you change in a browser at phone width
(390 px) and offline** (DevTools → Network → Offline) when it touches selling.

## Git workflow (required)

Several people and their agents work on this repo, and what is on `main` is what
gets deployed. Nobody pushes to `main` directly; every change goes through a
pull request. GitHub enforces this with a ruleset on `main`.

1. Start each change from an up-to-date `main`: `git switch main && git pull`,
   then `git switch -c <type>/<topic>` (`fix/stock-sync`, `feat/discounts`).
   One branch per change.
2. Never commit on `main`, push to `main`, force-push, or rewrite a branch
   someone else pushed. Never merge your own PR. If you find you've made changes
   on `main`, `git switch -c <branch>` before committing; the changes come with you.
3. Before pushing, run `npm run check`. Don't push a branch that fails it.
4. Push the branch and open a PR: `gh pr create --base main`. Title says what
   changes; the body says why and how you checked it (including phone width and
   offline, if it touches selling), and whether it adds a migration. Every push
   deploys the branch's Preview and the PR gets a comment with its link (see
   Previews); check your change there too.
5. Keep PRs small and on one topic. Don't reformat or "tidy" files you didn't
   need to touch.
6. Never run `npm run deploy`, `npm run db:migrate:remote`, `wrangler secret …`,
   `wrangler preview …`, `wrangler d1 execute --remote`, or anything else that
   touches the Cloudflare account. CI deploys (see Deploying); merging is the
   deploy.
7. If something seems to need a change on `main`, the Cloudflare setup, or
   secrets, stop and ask in the PR. Don't work around it.

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
  since 2026-11-23); add the next number. CI applies it to the preview database
  when the branch is pushed and to production when it reaches `main`, before the
  code that needs it. Write it so old code still works after it runs (add
  columns and tables; drop them in a later PR), because the deploy follows it
  by a minute and phones may run the old app for longer.

## Deploying

The Worker (`krdm-band`), D1 database (`krdm-band`, Western Europe) and R2
bucket (`krdm-media`, Western Europe) live in the "KRDM" Cloudflare account
(`account_id` in `wrangler.jsonc`), which the people running KRDM share with
their own logins. It runs at https://krdm-band.krdm.workers.dev until
`band.krdm.si` is needed; krdm.si's DNS moves to Cloudflare then (see the merch
brief, "Hosting and domain").

`krdm-media` is **KRDM's shared media bucket**: the website's CMS (Decap Turbo,
through R2's S3 API) will upload there too. This app writes only under
`products/` and `imported/` and must never delete outside them; the website
references merch photos by their keys.

History: it first ran in the "Martin Jagodic Personal" account as the Worker
`krdm-merch` (renamed `krdm-band` the same day) with the D1 database `krdm-merch`
and the bucket `krdm-merch-images`. On 2026-11-23 it moved to the KRDM account:
the database was exported and imported whole (accounts, products, stock), the
photos copied with their keys, and the old Worker, database and bucket deleted.
Gotcha learned doing it: inside this folder Wrangler takes the account from
`wrangler.jsonc` and ignores `CLOUDFLARE_ACCOUNT_ID`, so run commands aimed at
another account from a folder without a Wrangler config.
No stand had been opened, so no phone held unsynced sales. Moving to another
address later (`band.krdm.si`) needs more care: IndexedDB and sign-ins are per
address, so phones must sync before the old address goes away.

**CI deploys** (`.github/workflows/deploy.yml`, GitHub Actions). A push to
`main` runs `npm run check`, applies new migrations to the production database
and runs `wrangler deploy`; then it updates the `main` Preview (below). Every
other branch gets its own Preview. Deleting a branch deletes its Preview (the
Free plan allows 100 per Worker). The workflow needs the repository secret
`CLOUDFLARE_API_TOKEN`: an account-owned token on the KRDM account with
Workers Scripts: Edit and D1: Edit. By hand, only if CI can't
(`npm run db:migrate:remote`, then `npm run deploy`).

### Previews

[Workers Previews](https://developers.cloudflare.com/workers/previews/) of the
same Worker, at `https://<branch>-krdm-band.krdm.workers.dev` (lowercase, other
characters become `-`, at most 40; `scripts/preview-name.sh`).
**https://main-krdm-band.krdm.workers.dev** is the permanent one: what is on
`main`, on preview data. Use it to try things, train people, or test with
real phones without touching real stock, orders or money.

- Previews take their bindings from `previews` in `wrangler.jsonc`, never from
  the top level: the D1 database `krdm-band-preview` and the R2 bucket
  `krdm-band-preview` (both Western Europe). **All Previews share them**, `main`
  included, so a branch's migration lands there for everyone. If a branch's
  migration breaks the others, reset the database (below). The deploy fails if
  a Preview would bind the production database.
- A new binding needs its pair in `previews` too; Previews inherit none.
- Secrets: `IP_SALT` is in the Previews base config
  (`wrangler preview base-config secret put IP_SALT`); new Previews copy it.
- Logins are separate from production. Make one with
  `node scripts/create-admin.mjs --name "…" --email … --preview`, then invite
  others in the app. The app shows no banner on a Preview yet; check the
  address before selling at a gig.
- The preview database was filled on 2026-11-23 with the website's merch (the
  import below, photos copied into `krdm-band-preview`), no customer data.
  Don't copy production data into it. To start over: delete and recreate
  `krdm-band-preview` (`wrangler d1 …`), put the new id in `wrangler.jsonc` and
  `wrangler.preview-migrations.jsonc`, apply the migrations with
  `npx wrangler d1 migrations apply DB --remote -c wrangler.preview-migrations.jsonc`,
  and import again (`--remote -c wrangler.preview-migrations.jsonc` on the D1
  command; point `build/import-images.sh` at `krdm-band-preview/`).
- The preview bucket's uploads have their own budget in the preview
  database (4 GB), on top of production's: the account's budget alert is the
  backstop for both.

One-time setup, done on 2026-11-23: `wrangler d1 create krdm-band --location weur`,
`wrangler r2 bucket create krdm-media --location weur` (R2 commands need
`CLOUDFLARE_ACCOUNT_ID` set), `wrangler secret put IP_SALT` (a long random
string), and the data imported as described above. A new admin account:
`node scripts/create-admin.mjs --name "…" --email … --remote --url
https://krdm-band.krdm.workers.dev`. Don't commit secrets; `.dev.vars`
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
on any spend (Billing → Billable Usage). The budget counts only this app's
uploads; the website's CMS writes to the same bucket outside it, so the alert is
the backstop for both.

## Not built yet

Merch: see the end of its brief ("Next"): box templates, the website
switch-over (in krdm-www), email, data retention for orders. Music and the
later sections: [docs/band-app.md](docs/band-app.md) and
[docs/music-brief.md](docs/music-brief.md).

## Housekeeping

- Don't commit `node_modules/`, `dist/`, `.wrangler/`, `build/` or `.dev.vars`.
- Commit and push only to your own branch; the PR is the hand-off.
