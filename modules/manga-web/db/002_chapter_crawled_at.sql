ALTER TABLE manga_chapters
ADD COLUMN IF NOT EXISTS crawled_at TIMESTAMPTZ;

UPDATE manga_chapters c
SET crawled_at = image_times.last_crawled_at
FROM (
    SELECT chapter_id, MAX(updated_at) AS last_crawled_at
    FROM chapter_images
    GROUP BY chapter_id
) AS image_times
WHERE c.id = image_times.chapter_id
  AND c.crawled_at IS NULL;
