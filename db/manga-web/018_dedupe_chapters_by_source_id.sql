-- Merge duplicate chapters created when the same reader URL is discovered under
-- different domains. The crawler treats source_id as the stable chapter key.

BEGIN;

DROP TABLE IF EXISTS tmp_duplicate_chapter_map;

CREATE TEMP TABLE tmp_duplicate_chapter_map AS
WITH ranked AS (
  SELECT
    c.id,
    c.manga_title_id,
    c.source_id,
    FIRST_VALUE(c.id) OVER (
      PARTITION BY c.manga_title_id, c.source_id
      ORDER BY
        COUNT(i.id) DESC,
        c.crawled_at DESC NULLS LAST,
        c.id ASC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.manga_title_id, c.source_id
      ORDER BY
        COUNT(i.id) DESC,
        c.crawled_at DESC NULLS LAST,
        c.id ASC
    ) AS row_number
  FROM manga_chapters c
  LEFT JOIN chapter_images i ON i.chapter_id = c.id
  WHERE c.source_id IS NOT NULL
  GROUP BY c.id
)
SELECT id AS old_id, keep_id
FROM ranked
WHERE row_number > 1;

UPDATE reading_history h
SET chapter_id = m.keep_id
FROM tmp_duplicate_chapter_map m
WHERE h.chapter_id = m.old_id;

UPDATE manga_ai_responses r
SET chapter_id = m.keep_id,
    updated_at = NOW()
FROM tmp_duplicate_chapter_map m
WHERE r.chapter_id = m.old_id;

DELETE FROM chapter_images i
USING tmp_duplicate_chapter_map m
WHERE i.chapter_id = m.old_id
  AND EXISTS (
    SELECT 1
    FROM chapter_images keep_image
    WHERE keep_image.chapter_id = m.keep_id
      AND (
        keep_image.position = i.position
        OR keep_image.src = i.src
      )
  );

UPDATE chapter_images i
SET chapter_id = m.keep_id,
    updated_at = NOW()
FROM tmp_duplicate_chapter_map m
WHERE i.chapter_id = m.old_id;

DELETE FROM manga_chapters c
USING tmp_duplicate_chapter_map m
WHERE c.id = m.old_id;

CREATE UNIQUE INDEX IF NOT EXISTS manga_chapters_title_source_id_key
ON manga_chapters (manga_title_id, source_id)
WHERE source_id IS NOT NULL;

COMMIT;
