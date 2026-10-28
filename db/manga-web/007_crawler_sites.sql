CREATE TABLE IF NOT EXISTS crawler_sites (
    id BIGSERIAL PRIMARY KEY,
    site_key TEXT NOT NULL UNIQUE,
    config JSONB NOT NULL,
    crawl_status TEXT NOT NULL DEFAULT 'idle',
    crawl_error TEXT,
    last_crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(config) = 'object')
);

ALTER TABLE manga_titles
ADD COLUMN IF NOT EXISTS site_key TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS manga_titles_site_key_idx
ON manga_titles (site_key);

CREATE INDEX IF NOT EXISTS crawler_sites_status_idx
ON crawler_sites (crawl_status, updated_at DESC);
