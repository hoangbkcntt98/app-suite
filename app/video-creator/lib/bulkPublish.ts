import { createHash } from "node:crypto";
import { db, ensureVideoCreatorSchema, query } from "@video/lib/db";
import { findPatternVideo, type PatternVideoIdentity } from "@video/lib/patternVideo";
import { getVideoDetails, listVideos } from "@video/lib/video";
import { startFacebookPublish } from "@video/lib/pipeline";

export class BulkPublishError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type BulkPublishSettings = {
  startDate: string;
  time: string;
  timezone: string;
  videosPerDay: number;
  count: number;
};
type Candidate = { patternId: number; patternName: string; relativePath: string; title: string; caption: string };
export type PublishPlanItem = Candidate & { scheduledFor: string };
export type PublishPreview = { settings: BulkPublishSettings; items: PublishPlanItem[]; hash: string };
export type PublishJob = {
  id: string; batchId: string; patternId: number; patternName: string; relativePath: string;
  scheduledFor: string; timezone: string; status: string; error: string | null; runId: string | null;
};

export function validateBulkPublishSettings(input: unknown): BulkPublishSettings {
  if (!input || typeof input !== "object") throw new BulkPublishError("Thiếu cài đặt lịch.");
  const value = input as Record<string, unknown>;
  const { startDate, time, timezone, videosPerDay, count } = value;
  if (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
    || !Number.isFinite(Date.parse(`${startDate}T00:00:00Z`))
    || new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate) {
    throw new BulkPublishError("Ngày bắt đầu không hợp lệ.");
  }
  if (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BulkPublishError("Giờ phải có dạng HH:mm.");
  if (typeof timezone !== "string" || timezone.length > 100
    || !/^(?:UTC|GMT|[A-Za-z_]+\/[A-Za-z0-9_+/-]+)$/.test(timezone)) {
    throw new BulkPublishError("Dùng múi giờ IANA, ví dụ Asia/Tokyo hoặc UTC.");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
  catch { throw new BulkPublishError("Múi giờ không hợp lệ."); }
  if (typeof videosPerDay !== "number" || !Number.isInteger(videosPerDay) || videosPerDay < 1 || videosPerDay > 20) {
    throw new BulkPublishError("Số video/ngày phải từ 1 đến 20.");
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 1000) {
    throw new BulkPublishError("Số video cần lên lịch phải từ 1 đến 1000.");
  }
  return { startDate, time, timezone, videosPerDay, count };
}

async function getCandidates() {
  await ensureVideoCreatorSchema();
  const [patterns, videos, reserved, remote] = await Promise.all([
    query<PatternVideoIdentity>(`SELECT id, pattern, safe_file_name AS "safeFileName", video_path AS "videoPath"
      FROM grammar_patterns WHERE NULLIF(BTRIM(facebook_video_id), '') IS NULL AND published_at IS NULL
      ORDER BY id`),
    listVideos({ limit: null, strict: true }),
    query<{ relative_path: string; pattern_id: number }>(`SELECT relative_path, pattern_id FROM video_creator_publish_jobs WHERE state IN ('queued', 'failed')`),
    query<{ relativePath: string; title: string }>(`SELECT relative_path AS "relativePath", title
      FROM video_creator_videos WHERE NULLIF(BTRIM(facebook_video_id), '') IS NOT NULL
        OR published_at IS NOT NULL OR scheduled_publish_at IS NOT NULL`),
  ]);
  const usedPaths = new Set(reserved.rows.map((row) => row.relative_path));
  const usedPatterns = new Set(reserved.rows.map((row) => Number(row.pattern_id)));
  const items: Candidate[] = [];
  let missingCaption = 0;
  for (const pattern of patterns.rows) {
    if (usedPatterns.has(Number(pattern.id)) || findPatternVideo(pattern, remote.rows)) continue;
    const video = findPatternVideo(pattern, videos);
    if (!video || usedPaths.has(video.relativePath) || video.facebookVideoId || video.publishedAt || video.scheduledPublishAt) continue;
    if (!video.caption.trim()) { missingCaption++; continue; }
    items.push({
      patternId: Number(pattern.id), patternName: pattern.pattern, relativePath: video.relativePath,
      title: (video.title || pattern.pattern).slice(0, 300), caption: video.caption.trim().slice(0, 5000),
    });
    usedPaths.add(video.relativePath);
  }
  return { items, missingCaption };
}

export async function previewBulkPublish(input: unknown, now = new Date()): Promise<PublishPreview> {
  const settings = validateBulkPublishSettings(input);
  const candidates = await getCandidates();
  if (settings.count > candidates.items.length) throw new BulkPublishError(`Chỉ còn ${candidates.items.length} video đủ điều kiện. Tải lại danh sách.`, 409);
  const dates = await query<{ scheduled_for: string; valid: boolean }>(`
    SELECT ((($1::date + (i / $3::int)) + $2::time) AT TIME ZONE $4)::text AS scheduled_for,
      (((($1::date + (i / $3::int)) + $2::time) AT TIME ZONE $4) AT TIME ZONE $4)
        = (($1::date + (i / $3::int)) + $2::time) AS valid
    FROM generate_series(0, $5::int - 1) AS i ORDER BY i`,
  [settings.startDate, settings.time, settings.videosPerDay, settings.timezone, settings.count]);
  if (dates.rows.some((row) => !row.valid)) throw new BulkPublishError("Giờ đăng không tồn tại do đổi giờ mùa hè. Chọn giờ khác.");
  const items = candidates.items.slice(0, settings.count).map((item, index) => ({
    ...item, scheduledFor: new Date(dates.rows[index].scheduled_for).toISOString(),
  }));
  if (Date.parse(items[0].scheduledFor) <= now.getTime()) throw new BulkPublishError("Giờ bắt đầu đã qua. Chọn giờ sắp tới để bắt đầu từ hôm nay.");
  const hash = createHash("sha256").update(JSON.stringify({ settings, items })).digest("hex");
  return { settings, items, hash };
}

export async function createBulkPublish(input: {
  settings?: unknown; previewHash?: unknown; requestId?: unknown; confirmPublish?: unknown;
}) {
  if (input.confirmPublish !== true) throw new BulkPublishError("Cần xác nhận cho phép tự động đăng công khai lên Facebook.");
  if (typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new BulkPublishError("Mã yêu cầu không hợp lệ.");
  }
  if (typeof input.previewHash !== "string" || !/^[0-9a-f]{64}$/.test(input.previewHash)) throw new BulkPublishError("Cần xem trước lịch.");
  if (!process.env.VIDEO_FACEBOOK_PAGE_ID?.trim() || !process.env.VIDEO_FACEBOOK_PAGE_TOKEN?.trim()) throw new BulkPublishError("Thiếu cấu hình Facebook.");
  await ensureVideoCreatorSchema();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("LOCK TABLE video_creator_publish_jobs IN SHARE ROW EXCLUSIVE MODE");
    const existing = await client.query<{ preview_hash: string }>("SELECT preview_hash FROM video_creator_publish_batches WHERE id = $1", [input.requestId]);
    if (existing.rows[0]) {
      if (existing.rows[0].preview_hash !== input.previewHash) throw new BulkPublishError("Mã yêu cầu đã được sử dụng cho lịch khác.", 409);
      await client.query("COMMIT");
      return { batchId: input.requestId, alreadyCreated: true };
    }
    const preview = await previewBulkPublish(input.settings);
    if (preview.hash !== input.previewHash) throw new BulkPublishError("Danh sách hoặc nội dung video đã thay đổi. Xem trước và xác nhận lại.", 409);
    await client.query(`INSERT INTO video_creator_publish_batches (id, preview_hash, timezone, settings)
      VALUES ($1, $2, $3, $4::jsonb)`, [input.requestId, preview.hash, preview.settings.timezone, JSON.stringify(preview.settings)]);
    await client.query(`INSERT INTO video_creator_publish_jobs
      (batch_id, pattern_id, pattern_name, relative_path, title, caption, scheduled_for)
      SELECT $1, item."patternId", item."patternName", item."relativePath", item.title, item.caption, item."scheduledFor"::timestamptz
      FROM jsonb_to_recordset($2::jsonb) AS item(
        "patternId" bigint, "patternName" text, "relativePath" text, title text, caption text, "scheduledFor" text)`,
    [input.requestId, JSON.stringify(preview.items)]);
    await client.query("COMMIT");
    return { batchId: input.requestId, alreadyCreated: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function getBulkPublishState() {
  const candidates = await getCandidates();
  const jobs = await query<PublishJob>(`SELECT jobs.id::text, jobs.batch_id::text AS "batchId",
    jobs.pattern_id AS "patternId", jobs.pattern_name AS "patternName", jobs.relative_path AS "relativePath",
    jobs.scheduled_for::text AS "scheduledFor", batches.timezone,
    COALESCE(runs.status, jobs.state) AS status, COALESCE(runs.error, jobs.error) AS error, runs.id::text AS "runId"
    FROM video_creator_publish_jobs jobs JOIN video_creator_publish_batches batches ON batches.id = jobs.batch_id
    LEFT JOIN vc_runs_shared runs ON runs.publish_job_id = jobs.id AND runs.object_type = 'video_publish'
    ORDER BY jobs.scheduled_for DESC, jobs.id DESC LIMIT 2000`);
  return {
    eligibleCount: candidates.items.length, missingCaption: candidates.missingCaption,
    jobs: jobs.rows.map((job) => ({
      ...job, patternId: Number(job.patternId), scheduledFor: new Date(job.scheduledFor).toISOString(),
    })),
  };
}

export async function cancelBulkPublish(batchId: unknown) {
  if (typeof batchId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) throw new BulkPublishError("Mã lịch không hợp lệ.");
  await ensureVideoCreatorSchema();
  return updateUnclaimedJobs("jobs.batch_id = $1::uuid", [batchId], "cancelled", null);
}

async function updateUnclaimedJobs(where: string, values: unknown[], state: string, error: string | null) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const locked = await client.query<{ id: string }>(`SELECT jobs.id FROM video_creator_publish_jobs jobs
      JOIN video_creator_publish_batches batches ON batches.id = jobs.batch_id
      WHERE jobs.state = 'queued' AND (${where})
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared WHERE object_type = 'video_publish' AND publish_job_id = jobs.id)
      ORDER BY jobs.id FOR UPDATE OF jobs`, values);
    // Fresh statement snapshot sees a run committed while waiting for its job lock.
    const result = await client.query(`UPDATE video_creator_publish_jobs jobs SET state = $2, error = $3
      WHERE id = ANY($1::bigint[]) AND state = 'queued'
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared WHERE object_type = 'video_publish' AND publish_job_id = jobs.id)`,
    [locked.rows.map((row) => row.id), state, error]);
    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function tickBulkPublish() {
  await ensureVideoCreatorSchema();
  await query(`UPDATE vc_runs_shared SET status = 'failed', finished_at = NOW(),
    error = 'Scheduled upload did not record its PID. Check Facebook before retrying.'
    WHERE object_type = 'video_publish' AND publish_job_id IS NOT NULL AND status = 'running' AND runner_pid IS NULL
      AND started_at < NOW() - INTERVAL '10 minutes'`);
  // Do not flood Facebook with all missed days after downtime.
  await updateUnclaimedJobs(
    "(jobs.scheduled_for AT TIME ZONE batches.timezone)::date < (NOW() AT TIME ZONE batches.timezone)::date",
    [], "missed", "Missed local publishing date; not uploaded automatically.",
  );
  const busy = await query(`SELECT 1 FROM vc_runs_shared
    WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
      AND (status = 'running' OR after_run_pending OR after_run_publish IS NOT NULL) LIMIT 1`);
  if (busy.rows.length) return;
  const job = (await query<{
    id: number; pattern_id: number; relative_path: string; title: string; caption: string;
  }>(`SELECT jobs.id, jobs.pattern_id, jobs.relative_path, jobs.title, jobs.caption FROM video_creator_publish_jobs jobs
    WHERE jobs.state = 'queued' AND jobs.scheduled_for <= NOW()
      AND NOT EXISTS (SELECT 1 FROM vc_runs_shared WHERE object_type = 'video_publish' AND publish_job_id = jobs.id)
    ORDER BY jobs.scheduled_for, jobs.id LIMIT 1`)).rows[0];
  if (!job) return;
  try {
    const [video, published] = await Promise.all([
      getVideoDetails(job.relative_path),
      query(`SELECT 1 FROM grammar_patterns WHERE id = $1
        AND (NULLIF(BTRIM(facebook_video_id), '') IS NOT NULL OR published_at IS NOT NULL)`, [job.pattern_id]),
    ]);
    if (!video || video.size <= 0) throw new Error("Video file is missing or empty.");
    if (video.facebookVideoId || video.publishedAt || video.scheduledPublishAt || published.rows.length) {
      await updateUnclaimedJobs("jobs.id = $1", [job.id], "skipped", "Already published or scheduled on Facebook.");
      return;
    }
    await startFacebookPublish(job.relative_path, job.caption, { title: job.title, publishJobId: job.id });
  } catch (error) {
    if ((error as { code?: string }).code === "23505"
      || (error instanceof Error && error.message === "Scheduled video is no longer pending.")) return;
    // Never auto-retry an ambiguous external upload; an existing run consumes this job.
    await updateUnclaimedJobs("jobs.id = $1", [job.id], "failed",
      (error instanceof Error ? error.message : "Scheduled upload failed.").slice(0, 2000));
  }
}

export function startBulkPublishScheduler() {
  const global = globalThis as typeof globalThis & { __bulkPublishScheduler?: boolean };
  if (global.__bulkPublishScheduler || process.env.NODE_ENV === "test") return;
  global.__bulkPublishScheduler = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await tickBulkPublish(); }
    catch (error) { console.error("Bulk publish scheduler:", error); }
    finally { busy = false; }
  };
  setInterval(() => void tick(), 15_000).unref();
  setTimeout(() => void tick(), 3_000).unref();
}
