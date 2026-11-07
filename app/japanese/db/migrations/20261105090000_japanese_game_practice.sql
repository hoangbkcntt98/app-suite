CREATE TABLE IF NOT EXISTS japanese_game_favorites (
  game_type TEXT NOT NULL CHECK (game_type IN ('words', 'kanji', 'grammar')),
  resource_id TEXT NOT NULL,
  question JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_type, resource_id)
);

CREATE TABLE IF NOT EXISTS japanese_game_review (
  game_type TEXT NOT NULL CHECK (game_type IN ('words', 'kanji', 'grammar')),
  resource_id TEXT NOT NULL,
  question JSONB NOT NULL,
  wrong_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_type, resource_id)
);
