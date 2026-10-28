ALTER TABLE manga_titles
DROP CONSTRAINT IF EXISTS manga_titles_href_key;

CREATE UNIQUE INDEX IF NOT EXISTS manga_titles_site_href_key
ON manga_titles (site_key, href);

ALTER TABLE manga_chapters
DROP CONSTRAINT IF EXISTS manga_chapters_href_key;

CREATE UNIQUE INDEX IF NOT EXISTS manga_chapters_title_href_key
ON manga_chapters (manga_title_id, href);
