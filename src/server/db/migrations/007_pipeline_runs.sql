CREATE TABLE IF NOT EXISTS pipeline_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT, -- 'success' | 'partial' | 'failed'
  errors JSONB
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs (started_at DESC);
