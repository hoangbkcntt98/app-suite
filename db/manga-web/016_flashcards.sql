CREATE TABLE IF NOT EXISTS app_flashcards (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES app_users(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back JSONB NOT NULL,
  source_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_flashcards_user_id_idx
ON app_flashcards (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS app_flashcards_user_front_idx
ON app_flashcards (user_id, front);
