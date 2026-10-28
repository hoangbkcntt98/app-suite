ALTER TABLE crawler_sites
ADD COLUMN IF NOT EXISTS store_images_locally BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE crawler_sites s
SET store_images_locally = TRUE,
    updated_at = NOW()
WHERE EXISTS (
    SELECT 1
    FROM manga_titles m
    JOIN manga_chapters c ON c.manga_title_id = m.id
    JOIN chapter_images i ON i.chapter_id = c.id
    WHERE m.site_key = s.site_key
      AND i.local_path IS NOT NULL
);
