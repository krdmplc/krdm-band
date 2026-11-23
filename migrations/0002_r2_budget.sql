-- Keep R2 inside its free tier (10 GB stored, 1M writes and 10M reads a month):
-- the app must never cost money. Photo sizes are recorded so the total stored
-- is known without listing the bucket (listing costs an operation), and writes
-- are counted per month. Limits are in src/worker/lib/budget.ts.
ALTER TABLE product_images ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE r2_usage (
  month TEXT PRIMARY KEY, -- YYYY-MM (UTC)
  writes INTEGER NOT NULL DEFAULT 0
);
