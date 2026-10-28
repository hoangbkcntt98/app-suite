ALTER TABLE manga_details
ADD COLUMN IF NOT EXISTS images_crawled_at TIMESTAMPTZ;

UPDATE manga_details d
SET images_crawled_at = NOW()
WHERE images_crawled_at IS NULL
  AND EXISTS (
      SELECT 1
      FROM manga_chapters c
      WHERE c.manga_title_id = d.manga_title_id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM manga_chapters c
      WHERE c.manga_title_id = d.manga_title_id
        AND c.crawled_at IS NULL
  );
