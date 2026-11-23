# KRDM merch

The back office for selling the merch of KRDM's bands and label: stands at gigs
(works offline), stock across locations, web orders from krdm.si, and who holds
which band's money. An installable web app on Cloudflare Workers, D1 and R2.

- What and why: [docs/merch-app-brief.md](docs/merch-app-brief.md)
- The gig box: [docs/merch-gig-box.md](docs/merch-gig-box.md)
- Working on it: [AGENTS.md](AGENTS.md)

```bash
npm ci
npm run db:migrate:local
node scripts/create-admin.mjs --name "Your Name" --email you@example.com
npm run dev
```
