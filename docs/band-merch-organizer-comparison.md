# Comparison: Band Merch Organizer and the KRDM merch app

Status: written 2026-11-23. A comparison only: nothing from Band Merch Organizer
has been ported. Use it to decide what to add to [the brief](merch-app-brief.md).

**Band Merch Organizer** is Klemen's app (repo `band-merch-organizer`, v0.5.1,
14–19 November 2026, hosted on GitHub Pages). It is an installable web app for
one band on one phone: products, quick selling at events, and sales stats, with
everything stored in the phone's browser (localStorage) and a JSON file as
backup. It has no server, no accounts and no sync.

## Summary

- **The two apps solve the same core problem in the same way**: an installable,
  offline-first phone app with a photo grid of products, sizes with stock, a
  cart, cash and Flik, events, undoing a sale, and a report per event. Klemen
  and the brief arrived at that independently.
- **The difference is scope.** His app is one band's till on one phone. Ours is
  shared between bands, phones and people, and adds where stock is, whose money
  it is, web orders and the website.
- **His app has a handful of things worth taking over** (below, ranked). Most
  of them are small: a sales history with CSV export, sizes in the event report,
  low-stock warnings and a Flik QR image are the clearest wins.
- **His existing sales could be imported** into ours if he has been using it at
  gigs; his backup file has everything needed.

## Same ideas

| Idea | Band Merch Organizer | KRDM merch |
|---|---|---|
| Installable, works offline | Service worker caches the app; data never leaves the phone | Service worker caches the app; a stand is stored on the phone and sales upload later |
| Products with sizes and stock | Sizes typed as `S:5` lines; one price for all sizes; one photo | Sizes, prices per tier, several photos, weight |
| Photos shrunk on the phone | 420 px JPEG, stored in the browser | 2000 px JPEG, uploaded to the server |
| Photo grid for selling | Two big tiles per row, filtered by category | Two to four tiles per row, filtered by band |
| Cart with several items, one sale | Yes, with + / − | Yes, with + / − |
| Cash and Flik | Yes, plus "card" | Yes, plus bank transfer with a UPN QR code |
| Events | Name, date, venue; one is "active" for selling | Stands: event, date, place, box, sellers |
| Undo a sale | "Void": stock comes back, the sale stays in history marked void | "Undo": stock and money come back, the sale stays marked void |
| Stock changes logged with a reason | `adjustments` (initial stock, correction, sale, void), recorded but not shown yet | Stock entries (received, moved, sold, counted, …), shown as history |
| Report per event | Units, revenue, payments, products sold, transactions | Totals per band and per payment method, every sale |
| A size with sales can't be deleted | Yes | Sizes with stock can't be removed; products are archived, never deleted |
| Money in cents | Yes | Yes |

## What his app has that ours doesn't

Ranked by how much it would help KRDM, with how it would fit.

| # | Feature | In his app | Fit for ours |
|---|---|---|---|
| 1 | **Sales history across all events**, grouped by day, filterable, **with CSV export** | Stats → history, one collapsible day per date, "Export sales CSV" (guards against spreadsheet formula injection) | High. Ours lists sales only inside each stand. The brief already wants exports for a future legal entity. |
| 2 | **Event report by product and size** | "Merchandise sold": each product + size with units and revenue | High and small. Ours reports by product, not size, but sizes are what decide a reprint. |
| 3 | **Low-stock warnings** with a threshold per product | Dashboard list, and a warning right after a sale | Medium. In ours it belongs to home stock (time to reprint); in a box, the box template's "what's missing" does that job. |
| 4 | **Flik QR image** | The seller uploads the static Flik QR from their bank app; checkout shows it with the amount to type in | Medium and small: an optional image on the profile, shown at checkout next to the phone number. |
| 5 | **Selling outside an event** | "No Event" sales (a friend at practice, a sale at home) | Medium. Ours needs a stand. A permanent stand per home location ("prodaja doma") would cover it without a new concept. |
| 6 | **Edit the cart's total** | Tap the total, type the final amount ("3 for 50"); the original and charged totals are both kept | Discuss. Ours has per-line discounts by admins. A whole-cart total has to be split between bands when a cart holds several, and needs the same rights as a discount. |
| 7 | Dashboard totals | Units in stock, total revenue | Low. Easy on our home page, per band. |
| 8 | Category filter at the stand | T-shirts / CDs / Hoodies / Other tabs | Low. Useful only once a box holds many items; ours filters by band. |
| 9 | Quantity field when adding | Type 3 instead of tapping + twice | Low. |
| 10 | "Card" as a payment method | A label only, no card reader | Low, until someone has a card reader (SumUp or similar). |
| 11 | JSON backup and restore, with validation and a rollback copy | The only safety net for data kept in one browser | Not needed: ours keeps data on the server (D1 restores to any point in the last days). CSV export (#1) covers taking data out. |
| 12 | Band name and logo on the dashboard | Cosmetic | Not needed now; band logos could come with owners later. |

## What ours has that his doesn't

- Several bands and the label in one app, with each item's money belonging to
  its owner; several people and phones on one stand, synced.
- Accounts and rights: label admin, band admins, sellers; discounts only for
  admins; guardian sales.
- Stock by location: home stock, gig boxes, packing and counting, history.
- Purchase cost per print run, and cost in reports.
- Price tiers (full, friends, band) and prices per event.
- Who holds whose money: pots, handovers confirmed by the receiver, band
  stashes, expenses and payouts.
- Bank transfer with a UPN QR code that carries the amount.
- Web orders, the public API for krdm.si, shipping priced from Pošta's list.
- Notifications, reports per band and month, Slovenian and English, size
  colours from the gig box.

## Different choices

| | Band Merch Organizer | KRDM merch | Why ours differs |
|---|---|---|---|
| Where data lives | The phone's browser only | Server (D1), plus a copy of the stand on the phone | Several people and phones; nothing is lost with a phone |
| Selling past zero stock | Refused | Allowed, flagged as negative stock | Two offline phones can't know about each other's sales; refusing would stop a real sale |
| Discounts | Anyone can change the total | Admins only, per line, with a reason | The money belongs to a band that may not be the seller's |
| Language | English | Slovenian and English | Sellers and guardians are Slovenian |
| Hosting | GitHub Pages, updated by copying files | Cloudflare, deployed from the repo | Needs a server and a database |

Worth knowing about his app before relying on it for real sales:

- Everything is in one browser on one phone. Clearing site data, losing the
  phone or reinstalling the browser loses it all unless a backup was exported.
- Photos are stored as text inside localStorage, which browsers cap at a few
  megabytes; the app warns "Unable to save" when it fills up.

## If Klemen has real data in it

His backup file (`band-merch-backup-YYYY-MM-DD.json`, format version 1) has
products with sizes, stock and photos, events, every sale (time, event, payment
method, items, charged and original total, void) and the stock log. A one-time
import could turn his events into closed stands, his sales into sales with
Klemen as seller and receiver, and his products into products of his band,
matched to what is already imported from the website. Worth doing only if those
sales matter for the band's records; decide with him.

## Next

Nothing here is decided. If the ranking holds, #1, #2 and #4 are small and
could go into the brief's "Next" list; #3 fits with the box template; #5 and #6
need a short decision first.
