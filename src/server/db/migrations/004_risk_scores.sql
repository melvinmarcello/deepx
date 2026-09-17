CREATE TABLE IF NOT EXISTS risk_scores (
  id SERIAL PRIMARY KEY,
  coin_id TEXT NOT NULL,
  volatility_score NUMERIC,
  liquidity_score NUMERIC,
  concentration_score NUMERIC,
  composite_score NUMERIC, -- 0-100
  computed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_coin_id ON risk_scores (coin_id);
CREATE INDEX IF NOT EXISTS idx_risk_scores_computed_at ON risk_scores (computed_at DESC);
