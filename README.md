# KRDM band

The back office for KRDM's bands and label (band.krdm.si). It is one app with
sections that share the same people, bands and logins:

- **Merch** (built): stands at gigs (works offline), stock across locations,
  web orders from krdm.si, and who holds which band's money.
- **Music** (next): releases and where they are live, artist profiles on the
  platforms, stats, release guide, reminders, SAZAS and IPF.
- Later: concert bookings, payouts, the association's books.

The practice space, gear and rehearsal dates belong to the Plc app
(plc.krdm.si), not here. An installable web app on Cloudflare Workers, D1 and R2.

- The whole app and its plan: [docs/band-app.md](docs/band-app.md)
- Merch: [docs/merch-app-brief.md](docs/merch-app-brief.md), and the gig box: [docs/merch-gig-box.md](docs/merch-gig-box.md)
- Music: [docs/music-brief.md](docs/music-brief.md), and leaving DistroKid: [docs/distribution.md](docs/distribution.md)
- Working on it: [AGENTS.md](AGENTS.md)

```bash
npm ci
npm run db:migrate:local
node scripts/create-admin.mjs --name "Your Name" --email you@example.com
npm run dev
```
