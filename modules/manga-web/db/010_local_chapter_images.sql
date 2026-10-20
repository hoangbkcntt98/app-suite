ALTER TABLE chapter_images
ADD COLUMN IF NOT EXISTS local_path TEXT;

ALTER TABLE chapter_images
ADD COLUMN IF NOT EXISTS content_type TEXT;

CREATE INDEX IF NOT EXISTS chapter_images_local_path_idx
ON chapter_images (local_path)
WHERE local_path IS NOT NULL;

UPDATE manga_chapters c
SET crawled_at = NULL,
    updated_at = NOW()
WHERE NOT EXISTS (
    SELECT 1
    FROM chapter_images i
    WHERE i.chapter_id = c.id
      AND i.local_path IS NOT NULL
);

UPDATE manga_details d
SET images_crawled_at = NULL,
    crawl_status = CASE
        WHEN crawl_status = 'crawling' THEN crawl_status
        ELSE 'idle'
    END,
    crawl_error = CASE
        WHEN crawl_status = 'crawling' THEN crawl_error
        ELSE NULL
    END,
    updated_at = NOW()
WHERE EXISTS (
    SELECT 1
    FROM manga_chapters c
    WHERE c.manga_title_id = d.manga_title_id
      AND NOT EXISTS (
          SELECT 1
          FROM chapter_images i
          WHERE i.chapter_id = c.id
            AND i.local_path IS NOT NULL
      )
);
