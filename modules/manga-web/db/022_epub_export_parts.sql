ALTER TABLE manga_epub_export_jobs
    ADD COLUMN IF NOT EXISTS current_page_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_page_total INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS exported_files JSONB NOT NULL DEFAULT '[]'::jsonb;
