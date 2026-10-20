CREATE TABLE IF NOT EXISTS app_phrase_ai_cache (
  id BIGSERIAL PRIMARY KEY,
  phrase TEXT NOT NULL,
  source_context TEXT NOT NULL DEFAULT '',
  response JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_phrase_ai_cache_phrase_context_idx
ON app_phrase_ai_cache (phrase, source_context);

CREATE INDEX IF NOT EXISTS app_phrase_ai_cache_phrase_idx
ON app_phrase_ai_cache (phrase, updated_at DESC);
