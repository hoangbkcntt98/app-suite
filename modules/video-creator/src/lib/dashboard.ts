import { listRuns } from "@video/services/runService";
import type { Run } from "@video/models/run";
import { ensureVideoCreatorSchema, query } from "@video/lib/db";

export type GrammarPattern = {
  id: number; pattern: string; processingStatus: string; updatedAt: string | null;
  safeFileName?: string | null; videoPath?: string | null;
  facebookVideoId?: string | null; publishedAt?: string | null;
  scheduledPublishAt?: string | null;
};

export async function getGrammarPatterns(): Promise<GrammarPattern[]> {
  await ensureVideoCreatorSchema();
  const result = await query<{ id: number; pattern: string; processing_status: string; updated_at: string | null; safe_file_name: string | null; video_path: string | null; facebook_video_id: string | null; published_at: string | null; scheduled_publish_at: string | null }>(
    `SELECT id, pattern, COALESCE(processing_status, 'pending') AS processing_status, updated_at, safe_file_name, video_path,
      facebook_video_id, published_at,
      (SELECT scheduled_for
       FROM video_creator_publish_jobs
       WHERE pattern_id = grammar_patterns.id AND state = 'queued'
       ORDER BY scheduled_for ASC
       LIMIT 1) AS scheduled_publish_at
     FROM grammar_patterns ORDER BY id ASC LIMIT 1000`
  );
  return result.rows.map((row) => ({
    id: row.id, pattern: row.pattern, processingStatus: row.processing_status, updatedAt: row.updated_at,
    safeFileName: row.safe_file_name, videoPath: row.video_path,
    facebookVideoId: row.facebook_video_id, publishedAt: row.published_at,
    scheduledPublishAt: row.scheduled_publish_at,
  }));
}

export async function getDashboard() {
  const warnings: string[] = [];
  const [patterns, runs] = await Promise.all([
    getGrammarPatterns().catch((error) => {
      console.error("Video Creator: failed to load grammar_patterns", error);
      warnings.push("Không đọc được grammar_patterns. Kiểm tra PostgreSQL và VIDEO_DATABASE_URL.");
      return [] as GrammarPattern[];
    }),
    listRuns().catch((error) => {
      console.error("Video Creator: failed to load pipeline history", error);
      warnings.push("Không đọc được lịch sử pipeline. Kiểm tra PostgreSQL và VIDEO_DATABASE_URL.");
      return [] as Run[];
    }),
  ]);
  return { patterns, runs, warnings };
}
