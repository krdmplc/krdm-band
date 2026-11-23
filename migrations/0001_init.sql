-- KRDM merch: the whole schema. See docs/brief.md for the concepts.
-- Money is in integer cents. Timestamps are ISO 8601 UTC strings.
-- Stock and money are never stored as totals: they are sums of stock_entries and
-- transfers, which are only ever added to (corrections are new entries).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  is_label_admin INTEGER NOT NULL DEFAULT 0,
  locale TEXT NOT NULL DEFAULT 'sl' CHECK (locale IN ('sl', 'en')),
  -- Shown at checkout for bank transfer (UPN QR) and Flik.
  iban TEXT,
  street TEXT,
  city TEXT,
  flik_phone TEXT,
  -- The id in the shared KRDM accounts service, once there is one.
  external_id TEXT UNIQUE,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One-time links to set a password: for new accounts and for resets.
CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Who gets the money: a band, or the label. Band ids are the website's artist refs.
CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('band', 'label')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE owner_admins (
  owner_id TEXT NOT NULL REFERENCES owners (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  PRIMARY KEY (owner_id, user_id)
);

-- Editable list of prices a product can have. "full" is the advertised one.
CREATE TABLE price_tiers (
  id TEXT PRIMARY KEY,
  name_sl TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
INSERT INTO price_tiers (id, name_sl, name_en, sort) VALUES
  ('full', 'Polna cena', 'Full price', 0),
  ('friends', 'Cena za prijatelje', 'Friends price', 1),
  ('band', 'Cena za bend', 'Band price', 2);

-- The id is the slug: it is the website's URL (/merch/<id>/).
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners (id),
  title_sl TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  description_sl TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('apparel', 'music', 'other')),
  link TEXT,
  -- The website's release file name; the release page lists the item.
  release TEXT,
  -- With its usual packaging excluded; the shipping setting adds packaging.
  weight_g INTEGER NOT NULL DEFAULT 0,
  -- Shown on the website. Unpublished products can still be sold at stands.
  published INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX products_owner ON products (owner_id);

-- Every product has at least one size; one-size products have the size ''.
CREATE TABLE product_sizes (
  product_id TEXT NOT NULL REFERENCES products (id),
  size TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, size)
);

-- A missing row means the product isn't sold at that tier.
CREATE TABLE product_prices (
  product_id TEXT NOT NULL REFERENCES products (id),
  tier_id TEXT NOT NULL REFERENCES price_tiers (id),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (product_id, tier_id)
);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Where stock sits: home stock, the label's storage, a gig box.
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keeper_id TEXT REFERENCES users (id),
  -- Stock here can be sold on the website.
  online INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE stock_entries (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  size TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations (id),
  qty INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('received', 'moved', 'sold', 'reserved', 'released', 'counted', 'returned')),
  -- Received entries only: what one piece of this print run cost.
  unit_cost_cents INTEGER,
  -- Ties the two halves of a move, or all sizes of one print run.
  group_id TEXT,
  sale_id TEXT,
  order_id TEXT,
  note TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX stock_variant ON stock_entries (product_id, size, location_id);
CREATE INDEX stock_location ON stock_entries (location_id);

-- One selling session at an event, selling from one location (the box).
CREATE TABLE stands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  place TEXT,
  location_id TEXT NOT NULL REFERENCES locations (id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT
);

CREATE TABLE stand_sellers (
  stand_id TEXT NOT NULL REFERENCES stands (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The change this seller brought; not anyone's merch money.
  float_cents INTEGER NOT NULL DEFAULT 0,
  -- JSON array of price tier ids this seller may use here (admins may use all).
  tiers TEXT NOT NULL DEFAULT '["full"]',
  counted_cash_cents INTEGER,
  counted_at TEXT,
  PRIMARY KEY (stand_id, user_id)
);

-- Prices for this event only, overriding the product's.
CREATE TABLE stand_prices (
  stand_id TEXT NOT NULL REFERENCES stands (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  tier_id TEXT NOT NULL REFERENCES price_tiers (id),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (stand_id, product_id, tier_id)
);

-- Made on a phone (id included), possibly offline, uploaded later.
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  stand_id TEXT REFERENCES stands (id),
  seller_id TEXT NOT NULL REFERENCES users (id),
  -- Who got the money: the seller for cash, the account holder for Flik/bank.
  receiver_id TEXT NOT NULL REFERENCES users (id),
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank', 'flik')),
  total_cents INTEGER NOT NULL,
  sold_at TEXT NOT NULL,
  -- Sold by a guardian (someone without an account watching the stand, from the
  -- paper tally sheet), entered later by the seller.
  guardian_name TEXT,
  device_id TEXT,
  -- JSON array of problems found when it was uploaded (e.g. an unauthorised discount).
  flags TEXT,
  voided_at TEXT,
  voided_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sales_stand ON sales (stand_id);
CREATE INDEX sales_sold_at ON sales (sold_at);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL REFERENCES sales (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  size TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners (id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  tier_id TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  -- For the whole line. A giveaway is a discount of the full line.
  discount_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  location_id TEXT NOT NULL REFERENCES locations (id)
);
CREATE INDEX sale_items_sale ON sale_items (sale_id);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'awaiting_payment', 'paid', 'shipped', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'manual')),
  locale TEXT NOT NULL DEFAULT 'sl',
  customer_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  street TEXT,
  postcode TEXT,
  city TEXT,
  country TEXT,
  note TEXT,
  shipping_method TEXT NOT NULL CHECK (shipping_method IN ('pickup', 'post', 'abroad')),
  items_cents INTEGER NOT NULL,
  -- What the customer pays for shipping; null until set for orders abroad.
  shipping_cents INTEGER,
  -- What the postage actually cost, and who paid it.
  postage_cents INTEGER,
  postage_paid_by TEXT REFERENCES users (id),
  handler_id TEXT REFERENCES users (id),
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank', 'flik')),
  payment_receiver_id TEXT REFERENCES users (id),
  paid_at TEXT,
  shipped_at TEXT,
  cancelled_at TEXT,
  ip_hash TEXT,
  anonymised_at TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX orders_status ON orders (status);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  size TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners (id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL,
  -- The title when ordered, in the order's language.
  title TEXT NOT NULL
);
CREATE INDEX order_items_order ON order_items (order_id);

CREATE TABLE order_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (id),
  user_id TEXT REFERENCES users (id),
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- An amount of one owner's money held by someone (person), the owner's common
-- pot (stash, with a keeper), or the outside world (external: customers,
-- suppliers, payouts — no owner, never shown with a balance).
CREATE TABLE pots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'stash', 'external')),
  owner_id TEXT REFERENCES owners (id),
  user_id TEXT REFERENCES users (id),
  name TEXT,
  keeper_id TEXT REFERENCES users (id),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner_id, user_id)
);
INSERT INTO pots (id, kind, name) VALUES
  ('customers', 'external', 'customers'),
  ('suppliers', 'external', 'suppliers'),
  ('payouts', 'external', 'payouts');

-- Every money event moves an amount of one owner's money from one pot to another.
-- A pot's balance is what came in minus what went out (done transfers only).
-- A transfer into a pot someone else holds waits (pending) until they confirm it.
CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners (id),
  from_pot TEXT NOT NULL REFERENCES pots (id),
  to_pot TEXT NOT NULL REFERENCES pots (id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'order', 'handover', 'expense', 'payout', 'refund', 'correction')),
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'done', 'rejected')),
  sale_id TEXT,
  order_id TEXT,
  stock_group_id TEXT,
  note TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_by TEXT REFERENCES users (id),
  decided_at TEXT
);
CREATE INDEX transfers_from ON transfers (from_pot);
CREATE INDEX transfers_to ON transfers (to_pot);

-- owner_id '*' means every owner.
CREATE TABLE subscriptions (
  user_id TEXT NOT NULL REFERENCES users (id),
  topic TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '*',
  PRIMARY KEY (user_id, topic, owner_id)
);

-- Rendered in the reader's language by the app, from topic + params.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id),
  topic TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX notifications_user ON notifications (user_id, read_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Pošta Slovenije, price list valid from 1. 8. 2026: "Pismo s sledenjem" (tracked
-- letter, goods allowed) up to 1 kg, "Paket" above that. Weight includes packaging.
INSERT INTO settings (key, value) VALUES ('shipping', '{
  "packagingGrams": 50,
  "packagingCents": 50,
  "roundToCents": 100,
  "brackets": [
    { "maxGrams": 350, "cents": 305, "service": "Pismo s sledenjem" },
    { "maxGrams": 1000, "cents": 410, "service": "Pismo s sledenjem" },
    { "maxGrams": 2000, "cents": 594, "service": "Paket" },
    { "maxGrams": 5000, "cents": 687, "service": "Paket" },
    { "maxGrams": 10000, "cents": 834, "service": "Paket" }
  ]
}');
