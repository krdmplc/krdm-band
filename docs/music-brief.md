# Brief: KRDM band, the Music section

Status: brief written 2026-11-23. Nothing built yet. The whole app:
[band-app.md](band-app.md).

## Goal

Help KRDM's bands put music out and look after it afterwards, without paying a
distributor for features that should be basic:

- know every release, its tracks and codes, and **where it is live since when**;
- get each band's **artist profiles** opened and claimed on every platform;
- **better stats** than the distributor gives, in one place with merch and gigs;
- a **release guide** and **reminders** so the promotion work actually happens;
- **suggestions** for what to do next;
- keep track of **SAZAS and IPF**, which pay for radio and public play.

The app does not distribute music. Stores only accept music from distributors
they have contracts with, so KRDM keeps using one (see "Distributor").

## What the DistroKid data says

From the DistroKid earnings export (`results.csv`, every payment from 2019-04 to
2026-09, downloaded 2026-11-23):

- **14 releases by 5 artists**: Armaroth, Douchean, Ofnana pesa, p€dri, GMB. No
  royalty splits are set (team percentage 100 everywhere). No music videos.
- **All of it earned $44.68 in seven and a half years.** The last 12 months
  (2025-10 to 2026-09) earned **$4.36**. The best year was 2024 with $8.11.
- By store: Spotify $15.38, Apple Music $11.96, Google Play $4.97 (two album
  downloads in 2019), Tidal $3.77, YouTube $4.16, Deezer $1.77, everything else
  under $1.20.
- **Spotify has paid nothing since March 2024.** Since April 2024 Spotify only
  pays for tracks with at least 1,000 streams in 12 months. No KRDM track came
  close: the most in one year was 400 (Douchean, "Dreamer", 2024). This also
  means the export no longer shows Spotify streams at all, so stats must come
  from Spotify for Artists instead.
- **Reach and money are different things.** Ofnana pesa's "Dread" was used about
  132,000 times in Facebook and Instagram videos (mostly in 2022, two thirds of
  it in Indonesia) and earned 13 cents. That is worth showing as reach, not as
  income.
- **Slovenia is the biggest market** ($21.26 of $44.68), then the US, UK,
  Australia and Germany.
- The paid **Social Media Pack** earned $0.014 in its first year (2025-10 to
  2026-08).
- Some tracks already have Slovenian ISRCs (`SIAA2…`, `SIAJS…`); the rest have
  DistroKid's (`QZ…`). Both can be kept when moving.

## Distributor

Decided direction, pending the actual DistroKid invoice:

- **A yearly fee can't pay for itself**: any fixed fee is many times what the
  music earns. Choose a distributor **with no fixed fee**, which takes a share
  of revenue instead (for example RouteNote's free tier at 15%: about $0.65 a
  year on today's income). Faster payouts or better dashboards don't matter at
  this income.
- Must have: several artists under one label account, existing ISRCs (and UPCs
  where possible) kept, releases that stay live without a subscription, CSV
  earnings exports. Check each of these in writing before moving; the market
  scan of 2026-11-23 is a starting point, not a verified offer.
- **Moving**: upload each release to the new distributor with the same ISRCs,
  wait until the app shows it live everywhere, then take it down at DistroKid
  and let the plan lapse. Keep DistroKid's "Leave a Legacy" (a paid add-on that
  keeps releases up after you stop paying) out of it.
- **Videos**: upload to the bands' YouTube channels directly, for free (turned
  into Official Artist Channels; see Artist profiles). Paid video distribution
  (Apple Music, Vevo, TIDAL) isn't worth it at this audience. If one video ever
  needs it, buy it per video (Amuse, Horus Music) instead of a yearly plan.

DistroKid costs $89.99 a year and renews on 6 April 2027. The comparison,
suggestions and the moving plan are in [distribution.md](distribution.md);
decide in March 2027.

## Concepts

- **Release**: owner, title, type (single, EP, album), release date, UPC, cover,
  label line, distributor, the website's release file name (the merch app
  already links products to it), status (planned, delivered, live, taken down).
- **Track**: release, position, title, ISRC, duration, explicit flag, lyrics,
  and the people on it:
  - **authors** (music, lyrics, arrangement) with shares: needed for SAZAS;
  - **performers** (band members, guests such as "feat. Petra Ambroz"): needed
    for IPF.
- **Video**: a track's music video, where it is (YouTube URL) and when.
- **Platform**: Spotify, Apple Music, YouTube Music, Deezer, Tidal, Amazon
  Music, Bandcamp, SoundCloud, and so on. An editable list.
- **Listing**: release × platform. The link or id, first seen live, last seen
  live, last check. Filled in by the checks (below) or by hand.
- **Artist profile**: owner × platform. The profile URL, whether it is claimed
  for artists (Spotify for Artists and the like), since when, and who in the
  band has access. **The app never stores passwords or platform logins.**
- **Task**: something someone should do, with a due date, an owner (band), a
  person or "anyone in the band", and a link to the guide. Comes from a release
  plan, a reminder or a suggestion.
- **Stats import**: one uploaded file (source, period, who imported it) and its
  rows, normalised to date, platform, country, release, track, quantity and
  money. Imports can be undone by deleting the file's rows.

## Features

### 1. Catalogue

- One page per band and per release: tracks, codes, credits, where it is live,
  its merch, its stats.
- First import from two places: the website's `content/releases/*.md` (titles,
  dates, covers, links) and the DistroKid export (UPC and ISRC per track).
- The website stays the source of the public release pages for now. Later it
  can read "listen on" links from this app's API at build time, the same way the
  merch switch-over works. That gives KRDM its own smart links on krdm.si
  instead of a paid service.

### 2. Where it's live since when

- A daily job looks each release up by UPC and each track by ISRC where a
  platform offers a free lookup:
  - **Deezer**: public API, no key (`/album/upc:…`, `/track/isrc:…`);
  - **Apple Music / iTunes**: the Search API's lookup by UPC, no key;
  - **Spotify**: the Web API's search with `upc:` / `isrc:` filters (an app with
    client credentials; check its current access rules first);
  - **YouTube Music, Amazon, Tidal and the rest**: entered by hand, or later if a
    free lookup turns up.
- The first time a release is found, that is its "live since" date. If a release
  that was live disappears, the band admins get a notification. This catches
  takedowns early, which matters while the catalogue moves to a new distributor.
- Results are stored in D1 and checks are spread out, so the free tiers of the
  Worker and the APIs are never stretched.

### 3. Artist profiles

- A checklist per band: Spotify for Artists, Apple Music for Artists (includes
  Shazam), YouTube (Official Artist Channel, which is requested through the
  distributor), Amazon Music for Artists, Deezer for Creators, Tidal, Bandcamp,
  Musixmatch (lyrics, verified artist), MusicBrainz and Discogs (metadata),
  Bandsintown or Songkick (gigs).
- Each item has the steps to claim it and a link, and is ticked off with the
  date and who has access.
- A new band gets the whole checklist as tasks.

### 4. Release guide

- A plan template, counted back from the release date and editable by the label
  admin. A first version:

  | When | Task |
  |---|---|
  | −6 weeks | Masters, cover (3000×3000), credits and lyrics final; ISRCs and UPC known |
  | −4 weeks | Uploaded to the distributor |
  | −3 weeks | Pitched to Spotify editorial (at least 7 days before release, through Spotify for Artists) |
  | −2 weeks | Release page on krdm.si (CMS) with links; Bandcamp page ready; Canvas and artist pick prepared |
  | Release day | Shared by the band, the label and Plc; added to the band's and KRDM's playlists |
  | +1 week | Registered at SAZAS (works) and IPF (recordings) |
  | +4 weeks | Look at the first stats, plan the next step |

- Creating a release creates its plan as tasks; the release page shows progress.

### 5. Stats

- **Imports**, each with an adapter for its file format:
  - distributor earnings (DistroKid now, the next distributor later);
  - Spotify for Artists and Apple Music for Artists exports (streams,
    listeners), where the dashboards offer CSV;
  - YouTube Studio exports;
  - Bandcamp sales.
- **Free API snapshots**, daily or weekly: followers and popularity on Spotify,
  fans on Deezer, subscribers and views on YouTube (YouTube Data API, free
  quota).
- **Views**: per band, release, track, platform and country, over time; streams
  next to money; reach (use in videos on TikTok, Facebook and Instagram) shown
  apart from plays. Merch sales and gigs (from the website's stats) can sit on
  the same timeline.
- Band members see their bands, the label admin sees everything and the totals.
- The export of 2019–2026 is about 5,600 rows: tiny for D1.

### 6. Suggestions

Rules, not guesswork. Each one links to the guide step or task that fixes it.
First rules:

- a profile on the checklist isn't claimed;
- a release is live on some platforms but not on others;
- a release has no krdm.si page, no Bandcamp page or no lyrics on Musixmatch;
- a release isn't registered at SAZAS or IPF;
- a band hasn't released anything in 12 months;
- listeners grew in a town or country where the band hasn't played (from the
  imports and the website's gigs).

### 7. Reminders and platform marketing

- Recurring tasks per band, from templates the label admin edits: update your
  playlist every month, refresh your artist pick, share something every week,
  add every new KRDM release to the KRDM playlist, Bandcamp Fridays when
  Bandcamp announces them.
- In-app notifications now, email later. A task can be done, snoozed or
  skipped; skipped often means the template should change.

### 8. SAZAS and IPF

- **SAZAS** collects authors' royalties. Per track: the authors and their
  shares, whether each is a SAZAS member, and when the work was registered.
- **IPF** collects for performers and for the producer of the recording when
  it is played on radio, on TV or in public. Per recording: the producer (the
  band or the label), the performers, and when it was registered.
- Statements from both are imported as amounts per year and track, so the
  stats show this money next to streaming. Slovenian radio play can easily be
  worth more than streaming.
- Registration itself stays in SAZAS's and IPF's own portals; the app keeps track
  and reminds.
- Open: check with SAZAS and IPF what KRDM, as an association, can register as
  a producer, and how the existing `SI…` ISRC codes were issued (by IPF, and to
  whom).

## Who can do what

- **Label admin**: everything, including templates, platforms and imports for
  all bands.
- **Band admin**: their bands' releases, tracks, credits, profiles, tasks and
  imports.
- **Band member**: reads their bands' releases and stats, does and ticks off
  tasks.

## Build order

1. **Catalogue**: releases, tracks, credits; import from the website and from the
   DistroKid export; the release page.
2. **Where it's live**: the daily checks, listings, takedown notifications.
3. **Artist profiles** checklist.
4. **Stats**: the import framework with the DistroKid adapter first, then
   Spotify for Artists; the views.
5. **Release guide and reminders.**
6. **SAZAS and IPF.**
7. **Suggestions.**

The distributor move is human work that runs alongside; the app records it
(release by release: new distributor, live since, taken down at DistroKid).

## Open questions

- Which distributor, after checking the must-haves in writing (Martin, March
  2027; see [distribution.md](distribution.md)).
- Who is the producer of KRDM's recordings for IPF, the band or the association
  (SAZAS/IPF, Martin).
- Which bands get Music first. The five artists on DistroKid are the obvious
  start; other bands on the website may release elsewhere or not at all.
