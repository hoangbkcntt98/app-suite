import { pool } from "@manga/lib/db";
import { reconcileStoppedCrawlers } from "@manga/lib/crawler";
import { removeStoredChapterImages } from "@manga/lib/imageStorage";
import { SiteConfig, validateSiteConfig } from "@manga/lib/siteConfig";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const { siteKey } = await params;
  await reconcileStoppedCrawlers();
  const result = await pool.query(
    `SELECT
       site_key,
       config,
       crawl_status,
       crawl_error,
       last_crawled_at,
       store_images_locally,
       local_image_storage_path,
       created_at,
       updated_at
     FROM crawler_sites
     WHERE site_key = $1`,
    [siteKey]
  );
  const site = result.rows[0];

  if (!site) {
    return Response.json(
      { ok: false, message: "Site config not found" },
      { status: 404 }
    );
  }

  return Response.json({ ok: true, site });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const { siteKey } = await params;
  let config: SiteConfig;

  try {
    config = (await request.json()) as SiteConfig;
  } catch {
    return Response.json(
      { ok: false, message: "JSONの形式が正しくありません。" },
      { status: 400 }
    );
  }

  const validation = validateSiteConfig(config);
  if (validation.error) {
    return Response.json(
      { ok: false, message: validation.error },
      { status: 400 }
    );
  }
  if (validation.siteKey !== siteKey) {
    return Response.json(
      {
        ok: false,
        message:
          "Editではsite_keyを変更できません。別のsite_keyにはCloneを使用してください。",
      },
      { status: 400 }
    );
  }

  const result = await pool.query(
    `UPDATE crawler_sites
     SET config = $1::jsonb,
         crawl_error = NULL,
         crawl_status = CASE
           WHEN crawl_status = 'failed' THEN 'idle'
           ELSE crawl_status
         END,
         updated_at = NOW()
     WHERE site_key = $2
       AND crawl_status IS DISTINCT FROM 'crawling'
     RETURNING
       site_key,
       config,
       crawl_status,
       last_crawled_at,
       store_images_locally,
       local_image_storage_path`,
    [JSON.stringify(config), siteKey]
  );
  const site = result.rows[0];
  if (site) {
    return Response.json({ ok: true, site });
  }

  const existsResult = await pool.query<{ crawl_status: string }>(
    "SELECT crawl_status FROM crawler_sites WHERE site_key = $1",
    [siteKey]
  );
  if (!existsResult.rows[0]) {
    return Response.json(
      { ok: false, message: "Site config not found" },
      { status: 404 }
    );
  }
  return Response.json(
    { ok: false, message: "クローラーの実行中は設定を編集できません。" },
    { status: 409 }
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const { siteKey } = await params;
  let body: { confirmation?: string };

  try {
    body = (await request.json()) as { confirmation?: string };
  } catch {
    return Response.json(
      { ok: false, message: "Invalid request" },
      { status: 400 }
    );
  }

  if (body.confirmation !== siteKey) {
    return Response.json(
      { ok: false, message: "Confirmation does not match site_key" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const siteResult = await client.query<{
      crawl_status: string;
      local_image_storage_path: string | null;
    }>(
      `SELECT crawl_status, local_image_storage_path
       FROM crawler_sites
       WHERE site_key = $1
       FOR UPDATE`,
      [siteKey]
    );
    const site = siteResult.rows[0];

    if (!site) {
      await client.query("ROLLBACK");
      return Response.json(
        { ok: false, message: "Site config not found" },
        { status: 404 }
      );
    }
    if (site.crawl_status === "crawling") {
      await client.query("ROLLBACK");
      return Response.json(
        {
          ok: false,
          message: "クローラーの実行中は設定を削除できません。",
        },
        { status: 409 }
      );
    }

    const countsResult = await client.query<{
      titles: number;
      chapters: number;
      images: number;
    }>(
      `SELECT
         COUNT(DISTINCT m.id)::int AS titles,
         COUNT(DISTINCT c.id)::int AS chapters,
         COUNT(DISTINCT i.id)::int AS images
       FROM manga_titles m
       LEFT JOIN manga_chapters c ON c.manga_title_id = m.id
       LEFT JOIN chapter_images i ON i.chapter_id = c.id
       WHERE m.site_key = $1`,
      [siteKey]
    );
    const counts = countsResult.rows[0] ?? {
      titles: 0,
      chapters: 0,
      images: 0,
    };
    const localPathsResult = await client.query<{ local_path: string }>(
      `SELECT i.local_path
       FROM chapter_images i
       JOIN manga_chapters c ON c.id = i.chapter_id
       JOIN manga_titles m ON m.id = c.manga_title_id
       WHERE m.site_key = $1 AND i.local_path IS NOT NULL`,
      [siteKey]
    );

    await client.query(
      `DELETE FROM manga_favorites
       WHERE manga_title_id IN (
         SELECT id FROM manga_titles WHERE site_key = $1
       )`,
      [siteKey]
    );
    await client.query(
      `DELETE FROM manga_chapters
       WHERE manga_title_id IN (
         SELECT id FROM manga_titles WHERE site_key = $1
       )`,
      [siteKey]
    );
    await client.query(
      `DELETE FROM manga_details
       WHERE manga_title_id IN (
         SELECT id FROM manga_titles WHERE site_key = $1
       )`,
      [siteKey]
    );
    await client.query("DELETE FROM manga_titles WHERE site_key = $1", [
      siteKey,
    ]);
    await client.query("DELETE FROM crawler_sites WHERE site_key = $1", [
      siteKey,
    ]);
    await client.query("COMMIT");
    await removeStoredChapterImages(
      localPathsResult.rows.map((row) => row.local_path),
      [site.local_image_storage_path || undefined].filter(
        (path): path is string => Boolean(path)
      )
    ).catch((error) => {
      console.error(`Could not remove local images for ${siteKey}`, error);
    });

    return Response.json({
      ok: true,
      message: `${siteKey} を削除しました。`,
      deleted: counts,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Could not delete config",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
