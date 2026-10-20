import { pool } from "@manga/lib/db";
import { spawnCrawler } from "@manga/lib/crawler";
import { removeStoredChapterImages } from "@manga/lib/imageStorage";

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
         updated_at = NOW()
       WHERE manga_details.crawl_status IS DISTINCT FROM 'crawling'
       RETURNING manga_title_id`,
      [id]
    );

    if (started.rowCount === 0) {
      return Response.json(
        {
          ok: true,
          message: `${title.title}: chapter crawl already running`,
          status: "crawling",
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

    return Response.json(
      {
        ok: true,
        message: `${title.title}: chapter crawl started`,
        status: "crawling",
      },
      { status: 202 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not crawl chapters";
    await pool.query(
      `UPDATE manga_details
       SET crawl_status = 'failed', crawl_error = $1, updated_at = NOW()
       WHERE manga_title_id = $2 AND crawl_status = 'crawling'`,
      [message, id]
    );
    return Response.json({ ok: false, message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json(
      { ok: false, message: "Invalid title ID" },
      { status: 400 }
    );
  }

  let body: { confirmation?: string } = {};
  try {
    body = (await request.json()) as { confirmation?: string };
  } catch {
    return Response.json(
      { ok: false, message: "Invalid request" },
      { status: 400 }
    );
  }

  if (body.confirmation !== "DELETE_TITLE_CHAPTERS") {
    return Response.json(
      { ok: false, message: "Confirmation does not match" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const titleResult = await client.query<{
      title: string;
      crawl_status: string | null;
      local_image_storage_path: string | null;
    }>(
      `SELECT
         m.title,
         d.crawl_status,
         s.local_image_storage_path
       FROM manga_titles m
       JOIN crawler_sites s ON s.site_key = m.site_key
       LEFT JOIN manga_details d ON d.manga_title_id = m.id
       WHERE m.id = $1
       FOR UPDATE OF m`,
      [id]
    );
    const title = titleResult.rows[0];
    if (!title) {
      await client.query("ROLLBACK");
      return Response.json(
        { ok: false, message: "Title not found" },
        { status: 404 }
      );
    }

    const countsResult = await client.query<{
      chapters: number;
      images: number;
    }>(
      `SELECT
         COUNT(DISTINCT c.id)::int AS chapters,
         COUNT(DISTINCT i.id)::int AS images
       FROM manga_chapters c
       LEFT JOIN chapter_images i ON i.chapter_id = c.id
       WHERE c.manga_title_id = $1`,
      [id]
    );
    const counts = countsResult.rows[0] ?? { chapters: 0, images: 0 };
    const localPathsResult = await client.query<{ local_path: string }>(
      `SELECT local_path
       FROM chapter_images i
       JOIN manga_chapters c ON c.id = i.chapter_id
       WHERE c.manga_title_id = $1
         AND i.local_path IS NOT NULL`,
      [id]
    );

    await client.query("DELETE FROM manga_chapters WHERE manga_title_id = $1", [
      id,
    ]);
    await client.query(
      `INSERT INTO manga_details (
         manga_title_id,
         crawl_status,
         crawl_error,
         images_crawled_at,
         updated_at
       )
       VALUES ($1, 'idle', NULL, NULL, NOW())
       ON CONFLICT (manga_title_id) DO UPDATE SET
         crawl_status = 'idle',
         crawl_error = NULL,
         images_crawled_at = NULL,
         updated_at = NOW()`,
      [id]
    );
    await client.query("COMMIT");

    await removeStoredChapterImages(
      localPathsResult.rows.map((row) => row.local_path),
      [title.local_image_storage_path || undefined].filter(
        (path): path is string => Boolean(path)
      )
    ).catch((error) => {
      console.error(`Could not remove local images for title ${id}`, error);
    });

    return Response.json({
      ok: true,
      message: `${title.title}: クロール済みチャプターを削除しました。`,
      deleted: counts,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not delete crawled chapters",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
