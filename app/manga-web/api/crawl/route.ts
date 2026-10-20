import { readFile } from "fs/promises";
import { pool } from "@manga/lib/db";
import { spawnCrawler } from "@manga/lib/crawler";
import { clearStoredChapterImages } from "@manga/lib/imageStorage";

export async function GET() {
  const logPath = process.env.MANGA_CRAWLER_LOG || "/home/opc/manga-crawler/crawler.log";

  try {
    const content = await readFile(logPath, "utf8");
    const lines = content.split("\n").slice(-80).join("\n");

    return Response.json({
      ok: true,
      log: lines,
    });
  } catch {
    return Response.json({
      ok: true,
      log: "No log yet",
    });
  }
}

export async function POST(request: Request) {
  let body: { siteKey?: string };
  try {
    body = (await request.json()) as { siteKey?: string };
  } catch {
    return Response.json(
      { ok: false, message: "siteKey is required" },
      { status: 400 }
    );
  }
  if (!body.siteKey) {
    return Response.json(
      { ok: false, message: "siteKey is required" },
      { status: 400 }
    );
  }

  try {
    spawnCrawler(["--site-key", body.siteKey]);

    return Response.json({
      ok: true,
      message: `${body.siteKey}: crawler started in background`,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Could not start crawler",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  let body: { confirmation?: string };

  try {
    body = (await request.json()) as { confirmation?: string };
  } catch {
    return Response.json(
      { ok: false, message: "Invalid request" },
      { status: 400 }
    );
  }

  if (body.confirmation !== "CLEAR_CRAWLED_DATA") {
    return Response.json(
      { ok: false, message: "Confirmation is required" },
      { status: 400 }
    );
  }

  const activeResult = await pool.query<{ total: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM manga_details WHERE crawl_status = 'crawling') +
       (SELECT COUNT(*) FROM crawler_sites WHERE crawl_status = 'crawling')
     )::int AS total`
  );
  if ((activeResult.rows[0]?.total ?? 0) > 0) {
    return Response.json(
      {
        ok: false,
        message: "クローラーの実行中はデータを削除できません。",
      },
      { status: 409 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const countsResult = await client.query<{
      details: number;
      chapters: number;
      images: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM manga_details) AS details,
         (SELECT COUNT(*)::int FROM manga_chapters) AS chapters,
         (SELECT COUNT(*)::int FROM chapter_images) AS images`
    );
    const counts = countsResult.rows[0] ?? {
      details: 0,
      chapters: 0,
      images: 0,
    };

    // Images, AI responses and reading history are removed by FK cascades.
    await client.query("DELETE FROM manga_chapters");
    await client.query("DELETE FROM manga_details");
    await client.query(
      `UPDATE crawler_sites
       SET crawl_status = 'idle',
           crawl_error = NULL,
           last_crawled_at = NULL,
           updated_at = NOW()`
    );
    await client.query("COMMIT");
    await clearStoredChapterImages().catch((error) => {
      console.error("Could not clear local manga images", error);
    });

    return Response.json({
      ok: true,
      message: "クロール済みデータを削除しました。",
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
            : "Could not clear crawled data",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
