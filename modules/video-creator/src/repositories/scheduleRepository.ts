import { ensureVideoCreatorSchema, query } from "@video/lib/db";
import { mapSchedule, type PipelineSchedule, type ScheduleRow, type ScheduleWrite } from "@video/models/schedule";

const scheduleColumns = `id, kind, kanji_options, enabled, mode, run_time::text, timezone, starts_at::text,
  to_char(starts_at AT TIME ZONE timezone, 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at_local,
  interval_hours, videos_per_run, revision::text, force_recreate,
  publish_to_facebook, publish_to_youtube, youtube_privacy,
  youtube_made_for_kids, youtube_contains_synthetic_media,
  last_run_date::text, last_scheduled_at::text, last_run_id, last_error, updated_at::text`;

export class ScheduleRepository {
  async findEnabled(): Promise<PipelineSchedule[]> {
    await ensureVideoCreatorSchema();
    const result = await query<ScheduleRow>(`SELECT ${scheduleColumns}
      FROM video_creator_schedule WHERE enabled ORDER BY id`);
    return result.rows.map(mapSchedule);
  }

  async findById(id: number): Promise<PipelineSchedule> {
    await ensureVideoCreatorSchema();
    const result = await query<ScheduleRow>(`SELECT ${scheduleColumns},
      (SELECT COUNT(*) FROM video_creator_schedule_jobs jobs
        WHERE jobs.schedule_id = video_creator_schedule.id
          AND jobs.schedule_revision = video_creator_schedule.revision AND NOT jobs.cancelled
          AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
            WHERE object_type IN ('grammar_video', 'word_creator') AND schedule_job_id = jobs.id)) AS pending_videos
      FROM video_creator_schedule WHERE id = $1`, [id]);
    if (!result.rows[0]) throw new Error("Schedule is not configured.");
    return mapSchedule(result.rows[0]);
  }

  async save(input: ScheduleWrite): Promise<PipelineSchedule> {
    await ensureVideoCreatorSchema();
    const result = await query<ScheduleRow>(`INSERT INTO video_creator_schedule
      (id, enabled, run_time, timezone, force_recreate, publish_to_facebook,
        publish_to_youtube, youtube_privacy, youtube_made_for_kids, youtube_contains_synthetic_media,
        mode, starts_at, interval_hours, videos_per_run, last_error, updated_at, kind, kanji_options)
      SELECT $14, $1, $2::time, $3, $4, $5, $6, $7, $8, $9,
        $10, $11::timestamp AT TIME ZONE $3, $12, $13, NULL, NOW(), $15, $16::jsonb
      WHERE $11::timestamp IS NULL OR
        (($11::timestamp AT TIME ZONE $3) AT TIME ZONE $3) = $11::timestamp
      ON CONFLICT (id) DO UPDATE SET
        enabled = EXCLUDED.enabled, run_time = EXCLUDED.run_time, timezone = EXCLUDED.timezone,
        force_recreate = EXCLUDED.force_recreate, publish_to_facebook = EXCLUDED.publish_to_facebook,
        publish_to_youtube = EXCLUDED.publish_to_youtube, youtube_privacy = EXCLUDED.youtube_privacy,
        youtube_made_for_kids = EXCLUDED.youtube_made_for_kids,
        youtube_contains_synthetic_media = EXCLUDED.youtube_contains_synthetic_media,
        mode = EXCLUDED.mode, starts_at = EXCLUDED.starts_at,
        kind = EXCLUDED.kind, kanji_options = EXCLUDED.kanji_options,
        interval_hours = EXCLUDED.interval_hours, videos_per_run = EXCLUDED.videos_per_run,
        revision = video_creator_schedule.revision + 1,
        last_scheduled_at = CASE WHEN
          (video_creator_schedule.mode, video_creator_schedule.starts_at, video_creator_schedule.interval_hours)
            IS DISTINCT FROM (EXCLUDED.mode, EXCLUDED.starts_at, EXCLUDED.interval_hours)
          THEN NULL ELSE video_creator_schedule.last_scheduled_at END,
        last_run_date = CASE WHEN
          (video_creator_schedule.mode, video_creator_schedule.run_time, video_creator_schedule.timezone)
            IS DISTINCT FROM (EXCLUDED.mode, EXCLUDED.run_time, EXCLUDED.timezone)
          THEN NULL ELSE video_creator_schedule.last_run_date END,
        last_error = NULL, updated_at = NOW()
      RETURNING ${scheduleColumns}`,
    [input.enabled, input.runTime, input.timezone, input.forceRecreate, input.publishToFacebook,
      input.publishToYouTube, input.youtubePrivacy, input.youtubeMadeForKids, input.youtubeContainsSyntheticMedia,
      input.mode, input.startsAt, input.intervalHours, input.videosPerRun, input.id,
      input.kind, JSON.stringify(input.kanjiOptions)]);
    if (!result.rows[0]) throw new Error("Start time does not exist in the selected timezone (daylight-saving change).");
    return mapSchedule(result.rows[0]);
  }

  async deleteById(id: number) {
    await ensureVideoCreatorSchema();
    await query(`DELETE FROM video_creator_schedule WHERE id = $1`, [id]);
  }
}
