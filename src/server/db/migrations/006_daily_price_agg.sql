-- Downsampled daily price aggregate for charting (not full-resolution
-- history). Plain Postgres table for now; convert to a TimescaleDB
-- hypertable any time by running `npm run db:enable-timescale` once the
-- timescaledb extension is installed (see scripts/enable-timescaledb.ts).
CREATE TABLE IF NOT EXISTS daily_price_agg (
  coin_id TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume NUMERIC,
  PRIMARY KEY (coin_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_price_agg_coin_id ON daily_price_agg (coin_id, date DESC);
