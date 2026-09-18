-- Persisted market snapshots.
--
-- Previously the only copy of a snapshot lived in Redis under a ~10 minute
-- TTL, so whenever CoinMarketCap was unreachable (connection reset, rate
-- limit, expired key) the dashboard and every downstream agent lost all
-- market context and rendered empty. Storing each run's snapshot means the
-- system always has a last-known state to fall back on, with an explicit
-- captured_at so staleness can be shown rather than hidden.

CREATE TABLE IF NOT EXISTS market_snapshots (
  coin_id            TEXT        NOT NULL REFERENCES watchlist (coin_id) ON DELETE CASCADE,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_usd          NUMERIC,
  market_cap_usd     NUMERIC,
  volume_24h_usd     NUMERIC,
  pct_change_1h      NUMERIC,
  pct_change_24h     NUMERIC,
  pct_change_7d      NUMERIC,
  circulating_supply NUMERIC,
  total_supply       NUMERIC,
  source_updated_at  TIMESTAMPTZ,
  PRIMARY KEY (coin_id, captured_at)
);

CREATE INDEX IF NOT EXISTS market_snapshots_coin_captured_idx
  ON market_snapshots (coin_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS market_snapshots_captured_idx
  ON market_snapshots (captured_at DESC);
