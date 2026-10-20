import { pool } from "@manga/lib/db";
import { reconcileStoppedCrawlers } from "@manga/lib/crawler";
import { SiteConfig, validateSiteConfig } from "@manga/lib/siteConfig";

export async function GET() {
  await reconcileStoppedCrawlers();
  const result = await pool.query(
    `SELECT
       s.site_key,
       s.config,
       s.crawl_status,
       s.crawl_error,
       s.last_crawled_at,
       s.store_images_locally,
       s.local_image_storage_path,
       COUNT(m.id)::int AS title_count
     FROM crawler_sites s
     LEFT JOIN manga_titles m ON m.site_key = s.site_key
     GROUP BY s.id
     ORDER BY s.created_at`
  );
  return Response.json({ ok: true, sites: result.rows });
}

export async function POST(request: Request) {
  const createOnly =
    new URL(request.url).searchParams.get("createOnly") === "1";
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
  const siteKey = validation.siteKey;

  config.site_key = siteKey;
  const siteCountResult = await pool.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM crawler_sites"
  );
  const isFirstSite = (siteCountResult.rows[0]?.total ?? 0) === 0;
  let result;
  try {
    result = await pool.query(
      createOnly
        ? `INSERT INTO crawler_sites (site_key, config)
           VALUES ($1, $2::jsonb)
           RETURNING site_key, config, crawl_status, last_crawled_at, store_images_locally, local_image_storage_path`
        : `INSERT INTO crawler_sites (site_key, config)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (site_key) DO UPDATE SET
             config = EXCLUDED.config,
             updated_at = NOW()
           RETURNING site_key, config, crawl_status, last_crawled_at, store_images_locally, local_image_storage_path`,
      [siteKey, JSON.stringify(config)]
    );
  } catch (error) {
    if (
      createOnly &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return Response.json(
        {
          ok: false,
          message: `site_key「${siteKey}」は既に登録されています。`,
        },
        { status: 409 }
      );
    }
    throw error;
  }

  if (isFirstSite && siteKey !== "default") {
    await pool.query(
      "UPDATE manga_titles SET site_key = $1 WHERE site_key = 'default'",
      [siteKey]
    );
  }

  return Response.json({ ok: true, site: result.rows[0] });
}
