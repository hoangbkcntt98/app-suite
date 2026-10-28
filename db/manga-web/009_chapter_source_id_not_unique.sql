ALTER TABLE manga_chapters
DROP CONSTRAINT IF EXISTS manga_chapters_source_id_key;

CREATE INDEX IF NOT EXISTS manga_chapters_source_id_idx
ON manga_chapters (source_id)
WHERE source_id IS NOT NULL;
