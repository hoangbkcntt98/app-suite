ALTER TABLE manga_details
ADD COLUMN IF NOT EXISTS crawled_at TIMESTAMPTZ;

UPDATE manga_details
SET crawled_at = updated_at
WHERE crawled_at IS NULL;
