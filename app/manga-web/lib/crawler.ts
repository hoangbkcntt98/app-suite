import { resolve } from "path";
import { spawn } from "child_process";
import { pool } from "@manga/lib/db";

const crawlerJob =
  process.env.MANGA_CRAWLER_JOB || "jobs/manga_crawler_jobs.py";
const crawlerJobPath = resolve(process.cwd(), crawlerJob);
const crawlerJobPython =
  process.env.MANGA_CRAWLER_JOB_PYTHON || "python3";
const crawlerPython = process.env.MANGA_CRAWLER_PYTHON || "python3";
const crawlerLog =
  process.env.MANGA_CRAWLER_LOG || resolve(process.cwd(), "jobs/manga_crawler.log");

export function spawnCrawler(args: string[]) {
  const databaseDialect =
    process.env.MANGA_DB_DIALECT?.toLowerCase() === "mysql" ? "mysql" : "postgres";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DB_HOST: process.env.DB_HOST || process.env.MANGA_DB_HOST,
    DB_PORT:
      process.env.DB_PORT ||
      process.env.MANGA_DB_PORT ||
      (databaseDialect === "mysql" ? "3306" : "5432"),
    DB_NAME: process.env.DB_NAME || process.env.MANGA_DB_NAME,
    DB_USER: process.env.DB_USER || process.env.MANGA_DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD || process.env.MANGA_DB_PASSWORD,
  };
  const child = spawn(
    crawlerJobPython,
    [crawlerJobPath, ...args, "--log-file", crawlerLog, "--python-bin", crawlerPython],
    {
      cwd: process.cwd(),
      detached: true,
      env,
      stdio: "ignore",
    }
  );

  child.once("spawn", () => child.unref());
  return child;
}

export function getCrawlerLogPath() {
  return crawlerLog;
}

type CrawlingSite = {
  site_key: string;
  crawler_pid: number | null;
};

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function reconcileStoppedCrawlers() {
  const result = await pool.query<CrawlingSite>(
    `SELECT site_key, crawler_pid
     FROM crawler_sites
     WHERE crawl_status = 'crawling'`
  );

  for (const site of result.rows) {
    if (site.crawler_pid && isProcessRunning(site.crawler_pid)) continue;

    await pool.query(
      `UPDATE crawler_sites
       SET crawl_status = 'failed',
           crawl_error = COALESCE(
             crawl_error,
             'Crawler process stopped unexpectedly'
           ),
           crawler_pid = NULL,
           crawl_started_at = NULL,
           updated_at = NOW()
       WHERE site_key = $1 AND crawl_status = 'crawling'`,
      [site.site_key]
    );
  }

  // A title crawl shares the site's crawler process. If that process has
  // already failed, make sure title rows do not remain stuck in "crawling"
  // (which would leave the title action buttons disabled indefinitely).
  await pool.query(
    `UPDATE manga_details d
     SET crawl_status = 'failed',
         crawl_error = COALESCE(
           d.crawl_error,
           s.crawl_error,
           'Crawler process stopped unexpectedly'
         ),
         updated_at = NOW()
     FROM manga_titles m
     JOIN crawler_sites s ON s.site_key = m.site_key
     WHERE d.manga_title_id = m.id
       AND d.crawl_status = 'crawling'
       AND s.crawl_status = 'failed'`
  );
}
