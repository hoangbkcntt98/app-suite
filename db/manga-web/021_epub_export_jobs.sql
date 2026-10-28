CREATE TABLE IF NOT EXISTS manga_epub_export_jobs (
    manga_title_id BIGINT PRIMARY KEY REFERENCES manga_titles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'idle',
    phase TEXT NOT NULL DEFAULT 'idle',
    total_count INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    file_name TEXT,
    drive_file_id TEXT,
    drive_web_view_link TEXT,
    drive_web_content_link TEXT,
    file_size BIGINT,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manga_epub_export_jobs_status_idx
ON manga_epub_export_jobs (status, updated_at DESC);
