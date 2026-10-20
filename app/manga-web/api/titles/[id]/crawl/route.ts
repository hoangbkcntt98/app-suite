import { pool } from "@manga/lib/db";
import { spawnCrawler } from "@manga/lib/crawler";

type CrawlProgress = {
  status: string;
  error: string | null;
  total: number;
  crawled: number;
};

async function getProgress(id: string) {
  const result = await pool.query<CrawlProgress>(
    `SELECT
       COALESCE(d.crawl_status, 'idle') AS status,
       d.crawl_error AS error,
       COUNT(c.id)::int AS total,
       SUM(CASE
         WHEN c.id IS NOT NULL AND EXISTS (
           SELECT 1
           FROM chapter_images i
           WHERE i.chapter_id = c.id
             AND (
               s.store_images_locally = FALSE
               OR i.local_path IS NOT NULL
             )
         ) THEN 1 ELSE 0
       END)::int AS crawled
     FROM manga_titles m
     JOIN crawler_sites s ON s.site_key = m.site_key
     LEFT JOIN manga_details d ON d.manga_title_id = m.id
     LEFT JOIN manga_chapters c ON c.manga_title_id = m.id
     WHERE m.id = $1
     GROUP BY m.id, s.store_images_locally, d.crawl_status, d.crawl_error`,
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
    return Response.json({ ok: false, message: "Invalid title ID" }, { status: 400 });
  }

  const progress = await getProgress(id);
  if (!progress) {
    return Response.json({ ok: false, message: "Title not found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    status: progress.status,
    error: progress.error,
    chapterCount: progress.total,
    crawledChapterCount: progress.crawled,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json(
      { ok: false, message: "Invalid title ID" },
      { status: 400 }
    );
  }

  const titleResult = await pool.query<{ title: string; site_key: string }>(
    `SELECT title, site_key
     FROM manga_titles
     WHERE id = $1`,
    [id]
  );
  const title = titleResult.rows[0];
  if (!title) {
    return Response.json(
      { ok: false, message: "Title not found" },
      { status: 404 }
    );
  }

  try {
    const started = await pool.query(
      `INSERT INTO manga_details (
         manga_title_id,
         crawl_status,
         crawl_error
       )
       VALUES ($1, 'crawling', NULL)
       ON CONFLICT (manga_title_id) DO UPDATE SET
         crawl_status = 'crawling',
         crawl_error = NULL,
         images_crawled_at = NULL,
         updated_at = NOW()
       WHERE manga_details.crawl_status IS DISTINCT FROM 'crawling'
       RETURNING manga_title_id`,
      [id]
    );

    if (started.rowCount === 0) {
      const progress = await getProgress(id);
      return Response.json(
        {
          ok: true,
          status: "crawling",
          chapterCount: progress?.total ?? 0,
          crawledChapterCount: progress?.crawled ?? 0,
        },
        { status: 202 }
      );
    }

    const crawler = spawnCrawler([
      "--site-key",
      title.site_key,
      "--manga-id",
      id,
      "--skip-title-list",
      "--crawl-images",
    ]);
    crawler.once("error", (error) => {
      void pool.query(
        `UPDATE manga_details
         SET crawl_status = 'failed', crawl_error = $1, updated_at = NOW()
         WHERE manga_title_id = $2 AND crawl_status = 'crawling'`,
        [error.message, id]
      );
    });
    crawler.once("exit", (code, signal) => {
      if (code === 0) return;

      const reason = signal
        ? `Crawler stopped by signal ${signal}`
        : `Crawler exited with code ${code}`;
      void pool.query(
        `UPDATE manga_details
         SET crawl_status = 'failed',
             crawl_error = COALESCE(crawl_error, $1),
             updated_at = NOW()
         WHERE manga_title_id = $2 AND crawl_status = 'crawling'`,
        [reason, id]
      );
    });
    const progress = await getProgress(id);

    return Response.json({
      ok: true,
      message: `${title.title}: crawl started`,
      status: "crawling",
      chapterCount: progress?.total ?? 0,
      crawledChapterCount: progress?.crawled ?? 0,
    }, { status: 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not crawl title";
    await pool.query(
      `UPDATE manga_details
       SET crawl_status = 'failed', crawl_error = $1, updated_at = NOW()
       WHERE manga_title_id = $2 AND crawl_status = 'crawling'`,
      [message, id]
    );
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
