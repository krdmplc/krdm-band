# Brief: KRDM band, the Merch section

This is the Merch section of KRDM band (called "KRDM merch" until
2026-11-23); the whole app is described in [band-app.md](band-app.md).

Status: brief written 2026-11-22 in krdm-www and moved here. The first phase is
being built in this repo; see "Built so far" and "Next" at the end. Items under
"Open: with Aleš" need his agreement before they are built.

## Goal

A phone-first back office for selling KRDM's merch: at gigs (often with no
signal), from home stock, and through web orders. It holds the products, the
stock, and who holds whose money. The website stops keeping merch in
Markdown and reads everything from this app's API, the way a Snipcart shop
would.

## Who uses it

| Case | What happens in the app |
|---|---|
| A person selling at a concert | One stand, items from one owner |
| A band admin fulfilling web orders | Sees their band's orders, reserves, ships, records postage |
| The label manager | Sees all owners; manages products, stock, prices, money |
| A band selling label items at its gig | One stand, two owners: the money for label items belongs to the label |
| One seller for many bands (Plc fest) | One stand, many owners, up to 5 phones (mostly 2 at once) |

About 50 accounts in total.

Roles:

- **Label admin**: everything.
- **Band admin** (for one or more bands): that band's products, prices, stock,
  orders and money. Gives discounts, opens stands.
- **Seller**: sells at the stands they are assigned to, sees their own
  balances. Never sees purchase costs or other people's balances.

Both admin roles are kept in this app, not in the login provider (see Login).

## Decisions

- **Products live only in this app.** The website is a client of its API
  (catalog at build time, availability at runtime). The Decap `merch`
  collection goes away after a one-time import of the current
  `content/merch/*.md`.
- **Every item has exactly one owner**: a band or the label (KRDM). KRDM is
  the only label, and we don't sell other bands' merch.
- **There is no legal entity for now; the selling is personal.** The money
  belongs to the item's owner, whoever sells it. There are no commissions.
  Every sale records date, owner, seller and payment method, and everything
  can be exported, so switching to a legal entity later is a data export.
- **Variants are sizes only.** A colour is a separate product.
- **The phone app is a PWA** (installable, works offline), in Slovenian and
  English.
- **Hosting must cost $0.** Going over a free tier means something is wrong, so
  the app fails rather than pays (R2 uploads are capped in the code; see
  AGENTS.md, "It must cost nothing").
- **Hosting must be free at this scale.** Cloudflare Workers + D1 (SQLite)
  + R2 (photos). **Cloudflare is the confirmed platform** (agreed with Aleš on
  2026-11-22; the Plc app may move there too). Keep the schema plain SQLite and
  the server code a thin HTTP API all the same, so it isn't tied to one host.
  The stack is chosen here, not by whoever builds it: Hono on the Worker, React
  with Mantine (a component library made for back offices) in the PWA.
- **Email waits for Cloudflare's email sending**, which needs krdm.si's DNS on
  Cloudflare. Until then notifications are in the app only.
- **The app takes web orders; the Netlify `order` form is retired.** The
  cart submits to the app's API, and the app's notifications send the
  emails (see "Web orders" and "Notifications"). The contact form stays on
  Netlify Forms for now.
- **Repo `krdm-band` (was `krdm-merch`), address `band.krdm.si`.** The website repo keeps only
  the client side: catalog fetch, availability and checkout.
- **First phase**: selling at gigs, inventory (with locations), web orders and
  products. Reports stay simple: per event, per product, per date range.

## Concepts

### Products and prices

- Product: owner, title, description, photos, category (`apparel`, `music`,
  `other`), optional link (Bandcamp), optional release (the website's release
  file name), sizes (or none), active/archived.
- **Price tiers**: an editable list with defaults `full` (the advertised price,
  used for most sales), `friends` (a bit lower) and `band` (about the
  purchase cost). Each product has a price per tier. A stand can override
  prices for that event. The website shows `full` only.
- **Discounts**: only band and label admins can sell below `full`, by picking
  another tier or entering a manual discount with a reason. A seller's phone
  sells at `full` unless an admin has allowed a tier for that seller at that
  stand.
- **Giveaways** are sales at 0 € with a reason: stock goes down, and the cost
  shows in reports.

### Stock and locations

- **Location**: a place stock sits, held by a person. Examples: "Armaroth
  home stock" (Klemen), "label storage", "Plc", "gig box A". A location can
  hold several owners' items. A flag sets whether it counts as **available
  online** (home stock: yes; a gig box: no).
- **Stock is a sum of entries, never a stored number.** Each entry: product,
  size, quantity (+/−), location, type, and an optional unit cost. Types:
  - `received`: a (re)print run, with its unit cost, which often differs
    between runs;
  - `moved`: from one location to another (packing and unpacking a box);
  - `sold` (a giveaway is a sale at 0 €), and `returned` when a sale is undone;
  - `reserved` / `released`: web orders. A reservation stays the stock change
    when the order ships;
  - `counted`: the correction after a stock count.
- **Cost of goods uses the moving average** of `received` unit costs: simple,
  and close enough.
- **The gig box flow:**
  1. Pack: move items from home stock into a box.
  2. Sell from it.
  3. Close: count what's left, and the app records any difference as a
     correction.
  4. Move the rest back home, or keep the box packed for the next gig.
- **Box template**: a gig box (a location) can keep its standard contents,
  product × size × quantity. "Pack" fills the box up to the template, "Close"
  asks only what's missing, and the app prints the box's contents list with a
  QR code that opens the box (or its current stand) in the app. The physical
  box is described in [merch-gig-box.md](merch-gig-box.md).
- Overselling (two offline phones selling the last shirt) gives negative stock,
  which is flagged for an admin to fix. It is never a sync error.
- **Stock counts are internal.** The public API says only in stock or sold
  out, per size, the same rule the website follows today.

### Stands and sales

- **Stand**: an event (name, date, place, optionally linked to the website's
  event), its box (one location per stand for now), its sellers, the tiers and price overrides allowed
  there, and the change float each seller brings.
- **Sale**: items (product, size, quantity, tier, price, discount and reason),
  payment method (`cash`, `bank transfer`, `Flik`) and **who received the
  money**:
  - cash: the seller;
  - Flik or bank transfer: the account holder, picked at checkout, who may be
    another person at the stand.
- **Checkout for bank transfer shows a UPN QR code** with the amount, a
  reference (stand + sale) and the receiving person's IBAN, which they enter on
  their own profile. The customer scans it in their bank app. For Flik, it
  shows the receiving person's phone number.
- **Guardian sales**: while the band plays, someone without an account (often
  from another band) watches the stand and makes marks on the box's paper tally
  sheet. A seller at the stand enters those sales afterwards, marked as made by
  a guardian (a name, no account). The cash belongs to the seller who takes the
  cash pouch.
- **Size colours**: size buttons and labels use the same colour per size as
  the stickers and dividers in the gig box (see
  [merch-gig-box.md](merch-gig-box.md)), always with the letter as well.
- **Closing a stand**: each seller counts their cash. The app expects
  float + cash sales and shows the difference.

### Money (who holds whose money)

The design is double-entry underneath and two numbers on the phone screen.

- **Pot**: an amount of one owner's money held by someone.
  - A **person's pot**: "Klemen holds Armaroth money". It is created on
    first use, one per person per owner.
  - A **stash**: the owner's named common pot (cash box, or a band's bank
    account), with a **keeper**. A band can have more than one. Changing the
    keeper is logged.
  - **Outside pots**: customers, suppliers, payouts. These never show a
    balance.
- **Every money event is one transfer** (date, amount, owner, from pot, to pot,
  reason, link to the sale, order or stock entry, and who recorded it). A
  pot's balance is the sum of its transfers. The cases:
  - a sale: customers → the receiving person's pot;
  - a handover: Klemen's pot → Armaroth stash;
  - a reprint paid from the stash: stash → suppliers;
  - a reprint paid by Klemen himself: Klemen's pot → suppliers. His
    balance goes negative, meaning **the band owes him**, and a later stash →
    Klemen transfer settles it.
  - a payout to band members, or spending outside merch: stash → payouts.
- **A handover takes two steps**: the giver records it ("in transit"), and the
  stash keeper confirms it. Until then the money still counts as the giver's,
  so nobody's balance is ever quietly wrong.
- **On the phone**: "You hold 50 € of Armaroth money, 20 € of GMB money
  [Hand over]". A band admin sees who holds the band's money, including the
  stash.
- The change float is not owners' money and stays out of the ledger. It is
  only used when counting cash at closing.

### Web orders

- Order statuses:
  - `new` → `awaiting payment`: stock is reserved from an available-online
    location.
  - → `paid`: a transfer into the pot of the person who received the
    payment.
  - → `shipped` (which also covers picked up): the reservation becomes the
    shipment.
  - `cancelled` releases the reservation.
- **Shipping is recorded both ways**: what the customer was charged, and the
  postage actually paid (by whom). Shipping isn't any owner's money, so it is
  kept on the order, not in the owners' pots.
- **Shipping at checkout** (decided 2026-11-22): the customer picks
  - **pickup**: free;
  - **Pošta Slovenije**: priced by weight. The items' weights plus 50 g of
    packaging pick a class from Pošta's price list (valid from 1. 8. 2026); add
    0.50 € for the packaging and round up to whole euros:

    | Weight with packaging | Service | Pošta's price | Customer pays |
    |---|---|---|---|
    | up to 350 g | Pismo s sledenjem (tracked letter, goods allowed) | 3.05 € | 4 € |
    | up to 1 kg | Pismo s sledenjem | 4.10 € | 5 € |
    | up to 2 kg | Paket | 5.94 € | 7 € |
    | up to 5 kg | Paket | 6.87 € | 8 € |
    | up to 10 kg | Paket | 8.34 € | 9 € |

    "Navadno pismo" and "Navadni paket" are out: Pošta allows only documents in
    the first and nothing of commercial value in the second. All of these are
    settings a label admin can change;
  - **abroad**: the cost is quoted by hand on the order.
- One order can hold several owners' items. One person handles it and
  collects the payment, and the transfers split it per owner automatically.
- Orders can also be entered by hand (DMs, phone).
- A band admin sees orders that contain their band's items.
- **The customer gets emails too**, which Netlify Forms never sent:
  - right away: an order confirmation with the order number and items;
  - once an admin has set the shipping cost: the total and how to pay
    (amount, IBAN, reference, and the UPN QR code as an image);
  - when the order ships or is ready for pickup.

  Each email is sent from the order page with one tap and logged on the
  order.
- **The order form is guarded against spam and abuse**, which Netlify used to
  do for us:
  - a honeypot field;
  - a per-IP rate limit (5 orders an hour, counted in D1 on a salted hash of
    the IP, so it moves with the database);
  - prices, sizes and stock checked server-side;
  - an order-size cap.

  Add Cloudflare Turnstile only if spam gets through: it is a third-party
  script, so the privacy page would have to name it.
- **Order data is personal data** (name, email, address) kept in D1. Delete or
  anonymise the address and contact details a set time after an order is
  done (e.g. 12 months), keeping the items and amounts for the books. The
  website's privacy page must say where orders are stored.

### Notifications

- **People subscribe to topics, scoped to owners.** For example "new web
  order" (for Armaroth, or for all), "handover waiting for me",
  "negative stock" and "stand not synced 24 h after closing". Each person
  manages their own subscriptions; admins set defaults for their band.
- Every notification also appears in an in-app list. Email is the first
  delivery channel; web push to the installed PWA comes later.
- **Sending email**: Cloudflare's email sending (decided), once krdm.si's DNS
  is on Cloudflare, with SPF, DKIM and DMARC for krdm.si. The sender is a
  no-reply address. Customer emails set `Reply-To` to a monitored address of
  the order's handler, or of the label admin.

## Offline

Venues often have no signal; a stand must work for a whole night without one.

- The app shell is cached by a service worker.
- **"Prepare stand"** (online, before the gig) downloads the stand, its boxes'
  stock, products, prices, photos and the seller's permissions to the phone
  (IndexedDB).
- **Sales and stand entries are written on the phone first.** Each has an ID
  made on the phone and goes into an outbox, uploaded when there's signal.
  Uploads must be idempotent: the same sale sent twice is stored once.
- Several phones at one stand don't conflict, because stock and money are sums
  of entries. Each phone shows its own sales at once and the others' after
  they sync.
- **Editing products, prices, users and permissions needs a connection.** Only
  new entries flow from phones to the server, so there are no edit
  conflicts to resolve.
- Sessions last about 30 days per device, so a signed-in phone keeps working
  offline and through login-provider outages.
- Closing a stand (the cash count, the box count) needs a connection for now.
  Sales made offline upload whenever the phone is back online, also after
  closing.

## Website

- **Build time**: Hugo fetches the catalog from the public API
  (`resources.GetRemote`) and builds the merch pages, JSON-LD `Product`,
  `llms.txt` entries and the release pages' merch lists. Photos are fetched the
  same way, so `partials/image.html` still resizes them.
- **Rebuilds**: a change to a product (not a sale) calls the site's build hook,
  debounced. The daily rebuild stays.
- **Runtime**: item pages, the merch list and the cart fetch availability with
  async JS. They show in stock or sold out per size, never counts, and fall
  back to "ask us" if the API is unreachable.
- **Orders**: `cart.js` posts the structured order (items as product id,
  size and quantity, plus the customer's details) to the app's API. The app
  checks prices and stock, assigns the order number and returns it, and the
  thank-you page (`{{</* order-done */>}}`) shows it.
  - If the API can't be reached, the cart is kept, an error says to try
    again, and the contact form is offered.
  - Retire the Netlify `order` form and its success page, and update
    `AGENTS.md` and `assets/scripts/netlify-form.js`, which then serves only
    the contact form.
- **Switch over all at once**: catalog fetch, availability and checkout go live
  together, once the app holds the imported products and stock.
- When the website leaves Netlify, the app's API can also take the contact
  form.

## Login

The login is shared by every section of the app; the current plan is in
[band-app.md](band-app.md), "Login". What follows is how it was decided for
merch.

The goal is a shared login with the CMS and the Plc app, including people who
have no Plc membership (merch-only sellers).

Direction (2026-11-22): Aleš agreed to move things to Cloudflare, and the Plc
app may follow. So **KRDM's accounts should live in one small service on
Cloudflare** that the merch app, the Plc app and the CMS (Turbo SSO) all sign
in through, instead of on the Pi. That also removes the Pi's part of the CMS
SSO plan, which needed php-xml the Pi doesn't have.

- **Until that service exists, the merch app has its own accounts**: a label
  admin adds a person and passes on a one-time link (the app sends no email
  yet), where they set a password. Sessions last 30 days per device and slide
  with use, so a phone keeps working offline and through outages.
- `users.external_id` is there to link each account to the shared service
  later.
- The shared service decides only who someone is. Bands, stands and admin
  rights stay in this app, so label work stays decoupled from the practice
  space.
- **A merch-only account must not count as a Plc member**: no fees, not in
  member lists, key holders or presence.

### Open: with Aleš

- The shared accounts service: where it lives, who runs it, and when the Plc
  app's accounts move into it.
- Merch-only accounts in it, and the "not a member" flag for the Plc app.

## Hosting and domain

- **Cloudflare free plan:**
  - Workers serves the API and the PWA;
  - D1 holds the data, with point-in-time restore;
  - R2 holds the photos, served through the Worker.
- **krdm.si's DNS is at Neoserv** (`ns59/ns60.neoserv.si`, mail on
  `mail.krdm.si`). Workers custom domains and R2 custom domains need the zone
  on Cloudflare. The app's address is **`band.krdm.si`** (decided 2026-11-23; it was going to
  be `merch.krdm.si`). Two ways to get it:
  1. **Move krdm.si DNS to Cloudflare** (free). Copy every record, including MX
     for `mail.krdm.si`, before switching nameservers. The site needs this
     anyway if it moves to Cloudflare. This is the preferred route.
  2. Keep DNS at Neoserv and deploy the app as a Cloudflare Pages project with
     Functions (same D1/R2 bindings). It accepts a CNAME `band` →
     `<project>.pages.dev` from Neoserv's DNS.

  During development, use a `*.workers.dev` URL. The website only needs the
  API's base URL as a setting.

## Later, not in the first phase

- Online payment on the website.
- Richer stats (charts, stock value, margins per print run).
- Web push notifications.
- Moving the contact form off Netlify Forms.
- A legal entity: invoices, and possibly fiscal receipts (davčno potrjevanje
  računov).

## Built so far

Deployed on 2026-11-23 at https://krdm-merch.martinjagodic.workers.dev, renamed
the same day to https://krdm-band.martinjagodic.workers.dev (the
"Martin Jagodic Personal" Cloudflare account, data in Western Europe), with the
website's merch imported. Moved the same day, data and all, to the shared "KRDM"
account at https://krdm-band.krdm.workers.dev:

- Sign-in with invite links and passwords; people, bands and the label, band
  admins; price tiers and shipping settings.
- Products with sizes, prices per tier, weights and photos (shrunk on the phone,
  stored in R2).
- Locations, stock as entries: receive a print run (with its cost, optionally
  paid from a pot), move (pack and unpack a box), count, history.
- Stands with sellers, floats, allowed tiers and prices for the event; selling
  offline from a prepared snapshot, with an outbox that uploads when there's
  signal; discounts and giveaways for admins; cash change, UPN QR for bank
  transfers, Flik number; guardian sales; size colours; undoing a sale; cash
  count at closing; flags for sales that broke a rule.
- Money: pots, two-step handovers, stashes, expenses, payouts, corrections.
- Web orders: the public API (catalog, availability, quote, order) with
  shipping by weight, honeypot and rate limit; orders entered by hand; confirm,
  paid, sent, cancel with stock and money following.
- In-app notifications with subscriptions per band.
- Reports per event, product, band or month for a date range.
- `scripts/import-hugo.mjs`: the one-time import of the website's merch.

## Next

- **Box template** (from [merch-gig-box.md](merch-gig-box.md)): standard
  contents per gig box, "pack to template", a closing count that asks only
  what's missing, and the printable contents list with a QR code.
- **`band.krdm.si`**: move krdm.si's DNS to Cloudflare when the address is
  needed (decided: no Pages CNAME workaround).
- **Website switch-over** (krdm-www): catalog at build time, availability with
  JS, checkout to the API, rebuild hook on product changes. It waits for email,
  so customers get their confirmation and admins hear about new orders.
- **Email**: customer emails and email notifications, once the DNS is on
  Cloudflare.
- Delete customers' contact details 12 months after an order is done (a cron
  trigger); the "stand not synced 24 h after closing" notification; a limit on
  failed sign-ins.
