CREATE TABLE IF NOT EXISTS manga_favorites (
    manga_title_id BIGINT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reading_history (
    manga_title_id BIGINT PRIMARY KEY,
    chapter_id BIGINT NOT NULL REFERENCES manga_chapters(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reading_history_last_read_idx
ON reading_history (last_read_at DESC);
