CREATE TABLE IF NOT EXISTS news_events (
  id SERIAL PRIMARY KEY,
  coin_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  source TEXT, -- 'coindesk' | 'cointelegraph' | 'theblock'
  article_url TEXT UNIQUE, -- dedupe against repeated RSS entries
  event_type TEXT, -- listing, hack, regulation, partnership, etc.
  sentiment_score NUMERIC, -- -1 to 1
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_events_coin_id ON news_events (coin_id);
CREATE INDEX IF NOT EXISTS idx_news_events_published_at ON news_events (published_at DESC);
