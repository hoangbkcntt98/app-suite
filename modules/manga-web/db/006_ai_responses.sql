CREATE TABLE IF NOT EXISTS manga_ai_responses (
    id BIGSERIAL PRIMARY KEY,
    image_id BIGINT NOT NULL REFERENCES chapter_images(id) ON DELETE CASCADE,
    chapter_id BIGINT NOT NULL REFERENCES manga_chapters(id) ON DELETE CASCADE,
    manga_title_id BIGINT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('translate', 'chat')),
    prompt TEXT,
    response JSONB NOT NULL,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS manga_ai_responses_translate_image_idx
ON manga_ai_responses (image_id, action)
WHERE action = 'translate';

CREATE INDEX IF NOT EXISTS manga_ai_responses_chapter_idx
ON manga_ai_responses (chapter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS manga_ai_responses_title_idx
ON manga_ai_responses (manga_title_id, created_at DESC);
