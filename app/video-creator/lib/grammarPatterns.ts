import { db, ensureVideoCreatorSchema } from "@video/lib/db";
import { listVideos, videoFileExists } from "@video/lib/video";
import { findPatternVideo, type PatternVideoIdentity } from "@video/lib/patternVideo";

export class PatternResetConflict extends Error {}

export async function resetPatternsWithoutVideo() {
  await ensureVideoCreatorSchema();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Block new workers until eligibility and reset finish in one transaction.
    await client.query('LOCK TABLE "app-suite".runs IN SHARE ROW EXCLUSIVE MODE');
    const active = await client.query(`SELECT 1 FROM vc_runs_shared
      WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
        AND (status = 'running' OR after_run_pending OR after_run_publish IS NOT NULL) LIMIT 1`);
    if (active.rows.length) {
      throw new PatternResetConflict("Pipeline hoặc upload đang chạy. Chờ hoàn tất rồi reset.");
    }
    const patterns = await client.query<PatternVideoIdentity>(`
      SELECT id, pattern, safe_file_name AS "safeFileName", video_path AS "videoPath"
      FROM grammar_patterns
      WHERE NULLIF(BTRIM(facebook_video_id), '') IS NULL AND published_at IS NULL
      FOR UPDATE`);
    // Metadata alone is not proof that a local video still exists.
    const videos = await listVideos({ limit: null, strict: true });
    const remoteVideos = await client.query<{ relativePath: string; title: string }>(`
      SELECT relative_path AS "relativePath", title FROM video_creator_videos
      WHERE NULLIF(BTRIM(facebook_video_id), '') IS NOT NULL
        OR NULLIF(BTRIM(youtube_video_id), '') IS NOT NULL
        OR published_at IS NOT NULL OR scheduled_publish_at IS NOT NULL`);
    const resetIds: number[] = [];
    for (const pattern of patterns.rows) {
      if (!findPatternVideo(pattern, videos)
        && !findPatternVideo(pattern, remoteVideos.rows)
        && !await videoFileExists(pattern.videoPath ?? null)) {
        resetIds.push(pattern.id);
      }
    }
    const result = await client.query(`
      UPDATE grammar_patterns AS pattern
      SET processing_status = 'pending', is_processed = FALSE,
          processing_started_at = NULL, processed_at = NULL,
          processing_locked_by = NULL, processing_error = NULL, video_path = NULL, updated_at = NOW()
      WHERE pattern.id = ANY($1::int[])
        AND (pattern.processing_status IS DISTINCT FROM 'pending'
          OR pattern.is_processed IS DISTINCT FROM FALSE
          OR pattern.processing_started_at IS NOT NULL OR pattern.processed_at IS NOT NULL
          OR pattern.processing_locked_by IS NOT NULL OR pattern.processing_error IS NOT NULL
          OR pattern.video_path IS NOT NULL)
    `, [resetIds]);
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
