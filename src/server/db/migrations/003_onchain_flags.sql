CREATE TABLE IF NOT EXISTS onchain_flags (
  id SERIAL PRIMARY KEY,
  coin_id TEXT NOT NULL,
  chain TEXT NOT NULL, -- 'ethereum' | 'bsc'
  wallet_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  usd_value NUMERIC,
  direction TEXT, -- 'to_exchange' | 'from_exchange' | 'wallet_to_wallet'
  flagged_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onchain_flags_tx_chain ON onchain_flags (tx_hash, chain);
CREATE INDEX IF NOT EXISTS idx_onchain_flags_coin_id ON onchain_flags (coin_id);
CREATE INDEX IF NOT EXISTS idx_onchain_flags_flagged_at ON onchain_flags (flagged_at DESC);
