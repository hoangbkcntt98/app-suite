import { pool } from "@manga/lib/db";
import { spawnCrawler } from "@manga/lib/crawler";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const { siteKey } = await params;
  const siteResult = await pool.query<{ crawl_status: string }>(
    "SELECT crawl_status FROM crawler_sites WHERE site_key = $1",
    [siteKey]
  );
  const site = siteResult.rows[0];
  if (!site) {
    return Response.json(
      { ok: false, message: "Site config not found" },
      { status: 404 }
    );
  }
  const started = await pool.query(
    `UPDATE crawler_sites
     SET crawl_status = 'crawling',
         crawl_error = NULL,
         crawler_pid = NULL,
         crawl_started_at = NOW(),
         updated_at = NOW()
     WHERE site_key = $1 AND crawl_status IS DISTINCT FROM 'crawling'
     RETURNING site_key`,
    [siteKey]
  );
  if (started.rowCount === 0) {
    return Response.json(
      { ok: true, status: "crawling", message: "Crawler is already running" },
      { status: 202 }
    );
  }

  try {
    const crawler = spawnCrawler(["--site-key", siteKey]);
    await pool.query(
      `UPDATE crawler_sites
       SET crawler_pid = $1, updated_at = NOW()
       WHERE site_key = $2 AND crawl_status = 'crawling'`,
      [crawler.pid, siteKey]
    );
    crawler.once("error", (error) => {
      void pool.query(
        `UPDATE crawler_sites
         SET crawl_status = 'failed',
             crawl_error = $1,
             crawler_pid = NULL,
             crawl_started_at = NULL,
             updated_at = NOW()
         WHERE site_key = $2`,
        [error.message, siteKey]
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
        [reason, siteKey]
      );
    });
    return Response.json(
      { ok: true, status: "crawling", message: `${siteKey}: crawl started` },
      { status: 202 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start crawler";
    await pool.query(
      `UPDATE crawler_sites
       SET crawl_status = 'failed',
           crawl_error = $1,
           crawler_pid = NULL,
           crawl_started_at = NULL,
           updated_at = NOW()
       WHERE site_key = $2`,
      [message, siteKey]
    );
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
