CREATE TABLE IF NOT EXISTS daily_digest (
  id SERIAL PRIMARY KEY,
  coin_id TEXT NOT NULL,
  rank INT,
  rationale TEXT, -- LLM-generated explanation (orchestrator combo)
  risk_score NUMERIC,
  composite_signal_score NUMERIC,
  digest_date DATE DEFAULT CURRENT_DATE
);

CREATE INDEX IF NOT EXISTS idx_daily_digest_date ON daily_digest (digest_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_digest_coin_id ON daily_digest (coin_id);
-- One rank per coin per digest run/date
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_digest_date_coin ON daily_digest (digest_date, coin_id);
