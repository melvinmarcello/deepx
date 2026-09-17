-- NOTE on TimescaleDB: we intentionally do NOT `CREATE EXTENSION
-- timescaledb` in a tracked migration. Installing the extension binary
-- itself requires an admin-elevated installer step outside of SQL
-- (see scripts/enable-timescaledb.ts and its comments for the Windows
-- install steps). All tables here work as plain Postgres tables with or
-- without the extension; run `npm run db:enable-timescale` any time
-- after installing it to convert daily_price_agg into a hypertable.

-- Tracked coins. Not in the original spec's table list, but referenced
-- by it ("add/remove from the watchlist table") and required as the
-- input contract for the Market Data Agent.
CREATE TABLE IF NOT EXISTS watchlist (
  coin_id TEXT PRIMARY KEY, -- CoinGecko id, e.g. 'bitcoin'
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  eth_contract_address TEXT,
  bsc_contract_address TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
