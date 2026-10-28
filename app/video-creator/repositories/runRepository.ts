import { ensureVideoCreatorSchema, query } from "@video/lib/db";
import type { Run, RunLogRecord } from "@video/models/run";

export async function listRecentRuns() {
  await ensureVideoCreatorSchema();
  const result = await query<Run>(`SELECT * FROM vc_runs_shared
    WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
    ORDER BY started_at DESC LIMIT 12`);
  return result.rows;
}

export async function getRunLogRecord(id: number) {
  await ensureVideoCreatorSchema();
  const result = await query<RunLogRecord>(`SELECT id, status, log_path, error, started_at, finished_at, output_video
    FROM vc_runs_shared
    WHERE id = $1 AND object_type IN ('grammar_video', 'word_creator', 'video_publish')`, [id]);
  return result.rows[0] ?? null;
}

export async function saveRecoveredOutputVideo(id: number, outputVideo: string) {
  await query(`UPDATE vc_runs_shared SET output_video = $2 WHERE id = $1`, [id, outputVideo]);
}
