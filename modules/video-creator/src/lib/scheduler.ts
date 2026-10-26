import { ensureVideoCreatorSchema, query } from "@video/lib/db";
import { startGeneration, startKanjiGeneration } from "@video/lib/pipeline";
import { startQuotaScheduler } from "@video/lib/quotaScheduler";
import { intervalTiming, type PipelineSchedule } from "@video/models/schedule";
import { validateYouTubePublishSettings } from "@video/lib/youtube";
import { ScheduleRepository } from "@video/repositories/scheduleRepository";

const scheduleRepository = new ScheduleRepository();

function zonedNow(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

type Job = {
  id: number;
  schedule_id: number;
  schedule_revision: string;
  scheduled_for: string;
  settings: Parameters<typeof startGeneration>[0] & { kind?: PipelineSchedule["kind"]; kanjiOptions?: PipelineSchedule["kanjiOptions"] };
};


async function prepareSchedule(schedule: PipelineSchedule, now: Date) {
  // Fail only this schedule's batch, even when both slots share a revision/time.
  await query(`WITH failed AS (
    SELECT jobs.scheduled_for, runs.id, runs.error FROM video_creator_schedule_jobs jobs
    JOIN vc_runs_shared runs ON runs.schedule_job_id = jobs.id AND runs.object_type IN ('grammar_video', 'word_creator')
    WHERE jobs.schedule_revision = $1::bigint AND jobs.schedule_id = $2 AND runs.status = 'failed'
  ), cancelled AS (
    UPDATE video_creator_schedule_jobs jobs SET cancelled = TRUE FROM failed
    WHERE jobs.schedule_id = $2 AND jobs.schedule_revision = $1::bigint
      AND jobs.scheduled_for = failed.scheduled_for AND NOT jobs.cancelled
      AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
        WHERE object_type IN ('grammar_video', 'word_creator') AND schedule_job_id = jobs.id)
    RETURNING jobs.id
  ) UPDATE video_creator_schedule SET last_error = LEFT(
      'Scheduled generation failed; remaining videos in that batch cancelled. See run #' || failed.id || ': ' || COALESCE(failed.error, ''), 4000)
    FROM failed WHERE video_creator_schedule.id = $2 AND revision = $1::bigint
      AND last_run_id = failed.id`, [schedule.revision, schedule.id]);

  const pending = await query(`SELECT 1 FROM video_creator_schedule_jobs jobs
    WHERE jobs.schedule_id = $1 AND jobs.schedule_revision = $2::bigint AND NOT jobs.cancelled
      AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
        WHERE object_type IN ('grammar_video', 'word_creator') AND schedule_job_id = jobs.id) LIMIT 1`,
  [schedule.id, schedule.revision]);
  if (pending.rows.length) return;
  const local = zonedNow(schedule.timezone, now);
  const due = schedule.mode === "interval"
    ? (schedule.startsAtUtc ? intervalTiming(schedule.startsAtUtc, schedule.intervalHours, schedule.lastRunAt, now).due : null)
    : local.time >= schedule.runTime && schedule.lastRunDate !== local.date ? now.toISOString() : null;
  if (!due) return;
  const settings = {
    kind: schedule.kind,
    kanjiOptions: schedule.kanjiOptions,
    forceRecreate: schedule.forceRecreate,
    publishToFacebook: schedule.publishToFacebook,
    youtube: schedule.publishToYouTube ? validateYouTubePublishSettings({
      privacy: schedule.youtubePrivacy, madeForKids: schedule.youtubeMadeForKids,
      containsSyntheticMedia: schedule.youtubeContainsSyntheticMedia,
    }) : undefined,
  };
  // Both schedules can queue while the shared worker is busy. Keep last_run_id
  // until dispatch so an in-flight upload still reports errors to its schedule.
  // Revision + previous occurrence guards make claiming atomic across processes.
  await query(`WITH claimed AS (
    UPDATE video_creator_schedule SET last_scheduled_at = $2::timestamptz,
      last_run_date = $3::date, last_error = NULL, updated_at = NOW()
    WHERE id = $6 AND enabled AND revision = $1::bigint
      AND last_scheduled_at IS NOT DISTINCT FROM $4::timestamptz
      AND (mode = 'interval' OR last_run_date IS DISTINCT FROM $3::date)
    RETURNING id, revision, videos_per_run
  ) INSERT INTO video_creator_schedule_jobs (schedule_id, schedule_revision, scheduled_for, position, settings)
    SELECT claimed.id, claimed.revision, $2::timestamptz, position, $5::jsonb
    FROM claimed CROSS JOIN LATERAL generate_series(1, claimed.videos_per_run) AS position`,
  [schedule.revision, due, local.date, schedule.lastRunAt, JSON.stringify(settings), schedule.id]);
}

export async function tickSchedule(now = new Date()) {
  try {
    await ensureVideoCreatorSchema();
    // Cover a restart after inserting a scheduled run but before storing its PID.
    // Consume that job as failed rather than launching it a second time.
    await query(`UPDATE vc_runs_shared SET status = 'failed',
      error = 'Scheduled worker did not record its PID. Check run log before retrying.',
      finished_at = NOW(), after_run_publish = NULL, after_run_pending = FALSE
      WHERE object_type IN ('grammar_video', 'word_creator')
        AND schedule_job_id IS NOT NULL AND status = 'running' AND runner_pid IS NULL
        AND started_at < NOW() - INTERVAL '10 minutes'`);
    const schedules = await scheduleRepository.findEnabled();
    for (const schedule of schedules) {
      try {
        await prepareSchedule(schedule, now);
      } catch (error) {
        // Invalid settings in one slot must not stop the other from queuing.
        const message = error instanceof Error ? error.message : "Could not prepare scheduled batch.";
        await query(`UPDATE video_creator_schedule SET last_error = $1, updated_at = NOW()
          WHERE id = $2 AND revision = $3::bigint`, [message.slice(0, 4000), schedule.id, schedule.revision]).catch(() => {});
      }
    }
    // Global worker/upload barrier is checked AFTER preparing all queues.
    const busy = await query(`SELECT 1 FROM vc_runs_shared
      WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
        AND (status = 'running' OR after_run_pending OR after_run_publish IS NOT NULL) LIMIT 1`);
    if (busy.rows.length) return;
    const pending = await query<Job>(`SELECT jobs.id, jobs.schedule_id, jobs.schedule_revision::text,
        jobs.scheduled_for::text, jobs.settings
      FROM video_creator_schedule_jobs jobs
      JOIN video_creator_schedule schedule ON schedule.id = jobs.schedule_id
        AND schedule.revision = jobs.schedule_revision AND schedule.enabled
      WHERE NOT jobs.cancelled
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
          WHERE object_type IN ('grammar_video', 'word_creator') AND schedule_job_id = jobs.id)
      ORDER BY jobs.scheduled_for, jobs.id LIMIT 1`);
    const job = pending.rows[0];
    if (!job) return;
    try {
      // Unique job ID is stored before starting generation; restart cannot replay it.
      const run = job.settings.kind === "kanji"
        ? await startKanjiGeneration({ ...job.settings, scheduleJobId: job.id })
        : await startGeneration({ ...job.settings, scheduleJobId: job.id });
      await query(`UPDATE video_creator_schedule SET last_run_id = $1, updated_at = NOW()
        WHERE id = $3 AND revision = $2::bigint`, [run.id, job.schedule_revision, job.schedule_id]);
    } catch (error) {
      // Another scheduler/manual request won the worker slot: leave job queued.
      if ((error as { code?: string })?.code === "23505" ||
          (error instanceof Error && error.message === "Scheduled video is no longer pending.")) return;
      const message = error instanceof Error ? error.message : "Scheduled pipeline failed.";
      await query(`UPDATE video_creator_schedule_jobs SET cancelled = TRUE
        WHERE schedule_id = $3 AND schedule_revision = $1::bigint AND scheduled_for = $2::timestamptz`,
      [job.schedule_revision, job.scheduled_for, job.schedule_id]);
      await query(`UPDATE video_creator_schedule SET last_error = $1, updated_at = NOW()
        WHERE id = $3 AND revision = $2::bigint`, [message.slice(0, 4000), job.schedule_revision, job.schedule_id]);
    }
  } catch {
    // Database/preflight failures retry on next tick, never crash the web process.
  }
}

type SchedulerGlobal = typeof globalThis & { __videoCreatorScheduler?: boolean };

export function startScheduler() {
  const state = globalThis as SchedulerGlobal;
  if (state.__videoCreatorScheduler || process.env.NODE_ENV === "test") return;
  state.__videoCreatorScheduler = true;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try { await tickSchedule(); } finally { ticking = false; }
  };
  const timer = setInterval(() => { void tick(); }, 10_000);
  timer.unref();
  const initial = setTimeout(() => { void tick(); }, 2_000);
  initial.unref();
  startQuotaScheduler();
}
