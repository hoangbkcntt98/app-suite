import { pool } from "@manga/lib/db";
import { spawnCrawler } from "@manga/lib/crawler";

async function getChapter(id: string) {
  const result = await pool.query<{
    name: string;
    site_key: string;
    image_count: number;
    crawled_at: string | null;
    site_crawl_status: string;
    site_crawl_error: string | null;
  }>(
    `SELECT
       c.name,
       m.site_key,
       SUM(CASE
         WHEN i.id IS NOT NULL
          AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)
         THEN 1 ELSE 0
       END)::int AS image_count,
       c.crawled_at,
       s.crawl_status AS site_crawl_status,
       s.crawl_error AS site_crawl_error
     FROM manga_chapters c
     JOIN manga_titles m ON m.id = c.manga_title_id
     JOIN crawler_sites s ON s.site_key = m.site_key
     LEFT JOIN chapter_images i ON i.chapter_id = c.id
     WHERE c.id = $1
     GROUP BY c.id, m.site_key, s.crawl_status, s.crawl_error`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json(
      { ok: false, message: "Invalid chapter ID" },
      { status: 400 }
    );
  }

  const chapter = await getChapter(id);
  if (!chapter) {
    return Response.json(
      { ok: false, message: "Chapter not found" },
      { status: 404 }
    );
  }

  return Response.json({
    ok: true,
    imageCount: chapter.image_count,
    crawledAt: chapter.crawled_at,
    status:
      chapter.image_count > 0
        ? "completed"
        : chapter.site_crawl_status === "failed"
          ? "failed"
          : chapter.site_crawl_status === "crawling"
            ? "crawling"
            : "idle",
    error: chapter.site_crawl_error,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json(
      { ok: false, message: "Invalid chapter ID" },
      { status: 400 }
    );
  }

  const chapter = await getChapter(id);
  if (!chapter) {
    return Response.json(
      { ok: false, message: "Chapter not found" },
      { status: 404 }
    );
  }

  try {
    await pool.query(
      `UPDATE crawler_sites
       SET crawl_status = 'crawling', crawl_error = NULL, updated_at = NOW()
       WHERE site_key = $1`,
      [chapter.site_key]
    );
    const crawler = spawnCrawler([
      "--site-key",
      chapter.site_key,
      "--chapter-id",
      id,
    ]);
    crawler.once("error", (error) => {
      void pool.query(
        `UPDATE crawler_sites
         SET crawl_status = 'failed',
             crawl_error = $1,
             crawler_pid = NULL,
             crawl_started_at = NULL,
             updated_at = NOW()
         WHERE site_key = $2 AND crawl_status = 'crawling'`,
        [error.message, chapter.site_key]
      );
    });
    crawler.once("exit", (code, signal) => {
      if (code === 0) return;

      const reason = signal
        ? `Crawler stopped by signal ${signal}`
        : `Crawler exited with code ${code}`;
      void pool.query(
        `UPDATE crawler_sites
         SET crawl_status = 'failed',
             crawl_error = COALESCE(crawl_error, $1),
             crawler_pid = NULL,
             crawl_started_at = NULL,
             updated_at = NOW()
         WHERE site_key = $2 AND crawl_status = 'crawling'`,
        [reason, chapter.site_key]
      );
    });

    return Response.json(
      {
        ok: true,
        message: `${chapter.name}: crawl started`,
        status: "crawling",
      },
      { status: 202 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not crawl chapter";
    await pool.query(
      `UPDATE crawler_sites
       SET crawl_status = 'failed',
           crawl_error = $1,
           crawler_pid = NULL,
           crawl_started_at = NULL,
           updated_at = NOW()
       WHERE site_key = $2 AND crawl_status = 'crawling'`,
      [message, chapter.site_key]
    );
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
