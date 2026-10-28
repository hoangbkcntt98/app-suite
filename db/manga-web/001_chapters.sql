CREATE TABLE IF NOT EXISTS manga_details (
    manga_title_id BIGINT PRIMARY KEY,
    description TEXT,
    crawled_at TIMESTAMPTZ,
    images_crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manga_chapters (
    id BIGSERIAL PRIMARY KEY,
    manga_title_id BIGINT NOT NULL,
    source_id BIGINT UNIQUE,
    name TEXT NOT NULL,
    href TEXT NOT NULL,
    chapter_number NUMERIC,
    source_published_at TEXT,
    crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manga_chapters_title_number_idx
ON manga_chapters (manga_title_id, chapter_number DESC NULLS LAST, id DESC);

CREATE TABLE IF NOT EXISTS chapter_images (
    id BIGSERIAL PRIMARY KEY,
    chapter_id BIGINT NOT NULL REFERENCES manga_chapters(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    src TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chapter_id, position),
    UNIQUE (chapter_id, src)
);

CREATE INDEX IF NOT EXISTS chapter_images_chapter_position_idx
ON chapter_images (chapter_id, position);
