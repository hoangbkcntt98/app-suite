import { appPath } from "@video/lib/paths";
import Link from "next/link";
import AppSwitcher from "@video/components/AppSwitcher";
import LogoutButton from "@video/components/LogoutButton";
import ResetPatternStatuses from "@video/components/ResetPatternStatuses";
import BulkPublishSchedule from "@video/components/BulkPublishSchedule";
import PatternFilters from "@video/components/PatternFilters";
import { getGrammarPatterns } from "@video/lib/dashboard";
import { listVideos, type VideoRecord } from "@video/lib/video";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PatternsPage() {
  let patterns: Awaited<ReturnType<typeof getGrammarPatterns>> = [];
  let videos: VideoRecord[] = [];
  let error = "";
  try { patterns = await getGrammarPatterns(); } catch { error = "Could not read grammar_patterns. Check PostgreSQL and VIDEO_DATABASE_URL."; }
  try { videos = await listVideos({ limit: null, strict: true }); } catch { error ||= "Could not read videos. Check database and output directory."; }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>VC</span>
          <div>
            <strong>Video Creator</strong>
            <small>JLPT N1 · Facebook Reels</small>
          </div>
        </div>
        <nav className={styles.actions}>
          <Link href={appPath("/")}>Dashboard</Link>
          <Link href={appPath("/studio")}>Video Studio</Link>
          <Link href={appPath("/library")}>Library</Link>
          <Link href={appPath("/quota")}>Codex Quota</Link>
          <AppSwitcher />
          <LogoutButton />
        </nav>
      </header>

      <section className={styles.content}>
        <div className={styles.heading}>
          <div>
            <p className="eyebrow">GRAMMAR_PATTERNS</p>
            <h1>Grammar Pattern List</h1>
            <p>IDs are ordered ascending. Select a pattern from Dashboard to run the pipeline.</p>
          </div>
          <strong>{patterns.length} patterns</strong>
        </div>
        {!error ? <ResetPatternStatuses /> : null}
        {!error ? <BulkPublishSchedule /> : null}
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : (
          <PatternFilters rows={patterns} videos={videos} />
        )}
      </section>
    </main>
  );
}
