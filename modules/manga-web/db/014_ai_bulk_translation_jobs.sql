CREATE TABLE IF NOT EXISTS manga_ai_bulk_jobs (
    manga_title_id BIGINT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'idle',
    total_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    translated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manga_ai_bulk_jobs_status_idx
ON manga_ai_bulk_jobs (status, updated_at DESC);
