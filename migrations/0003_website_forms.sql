-- The website's forms (krdm.si) post here since it left Netlify Forms: orders go
-- through /api/public/orders as before, contact messages through
-- /api/public/contact into the table below.

-- A message from the website's contact form. Read in the app (Messages) by label
-- admins; `handled_at` marks it answered. Contact details are kept only to reply.
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'sl',
  -- Salted hash of the sender's IP, only for the rate limit.
  ip_hash TEXT,
  handled_at TEXT,
  handled_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX contact_messages_created ON contact_messages (created_at);
CREATE INDEX contact_messages_ip ON contact_messages (ip_hash, created_at);

-- The website's order rules, which the cart states in words (krdm-www hugo.toml
-- [params.merch]): no web order below the minimum, and postage within Slovenia is
-- free from the threshold on.
INSERT OR IGNORE INTO settings (key, value) VALUES ('web_orders', '{
  "minOrderCents": 2000,
  "freePostageFromCents": 10000
}');

-- Label admins hear about contact messages, as they did by email from Netlify.
INSERT OR IGNORE INTO subscriptions (user_id, topic, owner_id)
  SELECT id, 'contact.new', '*' FROM users WHERE is_label_admin = 1 AND disabled_at IS NULL;

-- The website's artist refs an item is listed under, when more than its owner
-- (JSON array): the KRDM shirt names every band on its back and shows on each
-- band's page. Empty = the owner, if it's a band. The website builds its merch
-- pages from the app since this migration.
ALTER TABLE products ADD COLUMN artists TEXT NOT NULL DEFAULT '[]';
