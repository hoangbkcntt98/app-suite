import { appendFileSync, closeSync, openSync, promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { appConfig, resolvedOutputPath, toRelativeOutputPath } from "@video/lib/config";
import { ensureVideoCreatorSchema, processAlive, query } from "@video/lib/db";
import { markFacebookPublished, markFacebookScheduled, markYouTubeUploaded, saveVideoDetails } from "@video/lib/video";
import { markWordCreatorStatus } from "@video/lib/wordCreator/index";
import { validateYouTubePublishSettings, validateYouTubeUpload, youtubeConfiguration, type YouTubeUploadInput, type YouTubePublishSettings } from "@video/lib/youtube";
import type { Run, RunAction } from "@video/models/run";
export type { Run } from "@video/models/run";

type AfterRunPublish = {
  facebook?: boolean;
  youtube?: YouTubePublishSettings;
  outputVideo?: string;
  sourceRunId?: number;
  title?: string;
  caption?: string;
};

function safeLogName() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function createRun(action: RunAction, patternId?: number, patternName?: string, afterRunPublish?: AfterRunPublish, scheduleJobId?: number, publishJobId?: number) {
  await ensureVideoCreatorSchema();
  const logDir = path.join(appConfig.logDir(), "video-creator", "runs");
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${safeLogName()}-${action}.log`);
  const values = [action, patternId ?? null, patternName ?? null, logPath, afterRunPublish ? JSON.stringify(afterRunPublish) : null];
  const result = publishJobId !== undefined
    ? await query<Run>(`INSERT INTO vc_runs_shared
        (action, pattern_id, pattern_name, log_path, after_run_publish, after_run_pending, publish_job_id, object_type, object_id)
      SELECT $1, COALESCE($2::bigint, jobs.pattern_id), COALESCE($3::text, jobs.pattern_name), $4, $5::jsonb, FALSE, jobs.id, 'video_publish', jobs.id::text
      FROM video_creator_publish_jobs jobs
      JOIN video_creator_publish_batches batches ON batches.id = jobs.batch_id
      WHERE jobs.id = $6 AND jobs.state = 'queued' AND jobs.scheduled_for <= NOW()
        AND (jobs.scheduled_for AT TIME ZONE batches.timezone)::date = (NOW() AT TIME ZONE batches.timezone)::date
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared WHERE object_type = 'video_publish' AND publish_job_id = jobs.id)
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
          WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
            AND (status = 'running' OR after_run_pending OR after_run_publish IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM video_creator_videos videos WHERE videos.relative_path = jobs.relative_path
          AND (NULLIF(BTRIM(videos.facebook_video_id), '') IS NOT NULL
            OR videos.published_at IS NOT NULL OR videos.scheduled_publish_at IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM grammar_patterns patterns WHERE patterns.id = jobs.pattern_id
          AND (NULLIF(BTRIM(patterns.facebook_video_id), '') IS NOT NULL OR patterns.published_at IS NOT NULL))
      FOR UPDATE OF jobs
      RETURNING *`, [...values, publishJobId])
    : scheduleJobId === undefined
    ? await query<Run>(`INSERT INTO vc_runs_shared
        (action, pattern_id, pattern_name, log_path, after_run_publish, after_run_pending, object_type, object_id)
      VALUES ($1, $2, $3, $4, $5::jsonb, $5::jsonb IS NOT NULL,
        CASE WHEN $1 = 'create_kanji' THEN 'word_creator'
          WHEN $1 IN ('publish', 'youtube_publish') THEN 'video_publish' ELSE 'grammar_video' END,
        COALESCE($2::bigint::text, $3::text)) RETURNING *`, values)
    : await query<Run>(`INSERT INTO vc_runs_shared
        (action, pattern_id, pattern_name, log_path, after_run_publish, after_run_pending, schedule_job_id, object_type, object_id)
      SELECT $1, $2, $3, $4, $5::jsonb, $5::jsonb IS NOT NULL, jobs.id,
        CASE WHEN $1 = 'create_kanji' THEN 'word_creator' ELSE 'grammar_video' END, jobs.id::text
      FROM video_creator_schedule_jobs jobs
      JOIN video_creator_schedule schedule ON schedule.id = jobs.schedule_id
      WHERE jobs.id = $6 AND NOT jobs.cancelled AND schedule.enabled
        AND jobs.schedule_revision = schedule.revision
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
          WHERE object_type IN ('grammar_video', 'word_creator') AND schedule_job_id = jobs.id)
        AND NOT EXISTS (SELECT 1 FROM vc_runs_shared
          WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
            AND (status = 'running' OR after_run_pending OR after_run_publish IS NOT NULL))
      FOR UPDATE OF jobs, schedule
      RETURNING *`, [...values, scheduleJobId]);
  if (!result.rows[0]) throw new Error("Scheduled video is no longer pending.");
  return result.rows[0];
}

// Persist intent on the source run before starting Python. Claim once after the
// worker ends, so restart recovery cannot launch duplicate external uploads.
const postRunTasks = new Map<number, Promise<void>>();

function publishAfterRun(run: Pick<Run, "id" | "log_path" | "action">, outputVideo?: string) {
  const existing = postRunTasks.get(run.id);
  if (existing) return existing;
  const task = performPublishAfterRun(run, outputVideo).finally(async () => {
    // Keep the schedule queue waiting while the upload continuation is being
    // prepared, including the gap after its JSON intent has been claimed.
    await query(`UPDATE vc_runs_shared SET after_run_pending = FALSE WHERE id = $1`, [run.id]);
  }).finally(() => { postRunTasks.delete(run.id); });
  postRunTasks.set(run.id, task);
  return task;
}

async function performPublishAfterRun(run: Pick<Run, "id" | "log_path" | "action">, outputVideo?: string) {
  const result = await query<{ after_run_publish: AfterRunPublish; status: string; error: string | null }>(`
    WITH pending AS (
      SELECT id, after_run_publish FROM vc_runs_shared
      WHERE id = $1 AND status <> 'running' AND after_run_publish IS NOT NULL FOR UPDATE
    )
    UPDATE vc_runs_shared AS runs SET after_run_publish = NULL FROM pending
    WHERE runs.id = pending.id
    RETURNING pending.after_run_publish, runs.status, runs.error`, [run.id]);
  const row = result.rows[0];
  if (!row) return;
  const plan = row.after_run_publish;
  const sourceRunId = plan.sourceRunId ?? run.id;
  async function report(message: string) {
    await fs.appendFile(run.log_path, `\nAutomatic publishing: ${message}\n`);
    await query(`UPDATE video_creator_schedule SET
      last_error = LEFT(CONCAT_WS(E'\\n', NULLIF(last_error, ''), $2::text), 4000), updated_at = NOW()
      WHERE last_run_id = $1`, [sourceRunId, message]);
  }
  if (row.status === "failed") {
    await report(`Run #${run.id} failed: ${row.error || "See run log."}`);
    if (run.action !== "publish") return; // Never upload a failed generation.
  }
  if (!plan.facebook && !plan.youtube) return;
  const video = outputVideo || plan.outputVideo;
  try {
    if (!video) throw new Error("Video created, but output video path is missing.");
    const patternName = path.basename(video).replace(/_video\.mp4$/i, "");
    const captionPath = path.join(appConfig.dataDir(), path.dirname(video), `${patternName}_reel_caption.txt`);
    // Try reading from video_creator_videos first (saved by saveVideoDetails)
    const savedDetails = await query<{ title: string | null; caption: string | null }>(
      `SELECT title, caption FROM video_creator_videos WHERE relative_path = $1`,
      [video]
    );
    const caption = plan.caption ?? savedDetails.rows[0]?.caption ?? await fs.readFile(captionPath, "utf8").catch(() => "");
    const title = plan.title ?? savedDetails.rows[0]?.title ?? patternName.replaceAll("_", " ").trim();
    if (plan.facebook) {
      try {
        const upload = await startFacebookPublish(video, caption, { title }, {
          youtube: plan.youtube, outputVideo: video, sourceRunId, title, caption,
        });
        await fs.appendFile(run.log_path, `\nAutomatic Facebook upload: run #${upload.id}.\n`).catch(() => {});
        return; // YouTube starts only after the Facebook worker finishes.
      } catch (error) {
        await report(`Facebook upload could not start: ${error instanceof Error ? error.message : "Unknown error"}`);
        // A preflight failure on Facebook must not prevent YouTube uploading.
      }
    }
    if (plan.youtube) {
      const input = validateYouTubeUpload({
        path: video, title, description: caption, ...plan.youtube, confirmUpload: true,
      });
      const upload = await startYouTubePublish(input, { sourceRunId, outputVideo: video });
      await fs.appendFile(run.log_path, `\nAutomatic YouTube upload: run #${upload.id}.\n`);
    }
  } catch (error) {
    await report(error instanceof Error ? error.message : "Automatic publishing failed.");
  }
}

async function finishRun(id: number, status: "success" | "failed", error?: string, outputVideo?: string) {
  await query(`UPDATE vc_runs_shared SET status = $2, error = $3, finished_at = NOW(), output_video = $4, runner_pid = NULL WHERE id = $1`,
    [id, status, error?.slice(0, 4000) ?? null, outputVideo ?? null]);
}

export function normalizeOutputVideo(videoPath: string) {
  const candidate = videoPath.trim().replace(/^["']|["']$/g, "");
  if (!candidate || !candidate.toLowerCase().endsWith(".mp4")) return undefined;
  try {
    return toRelativeOutputPath(path.isAbsolute(candidate) ? candidate : resolvedOutputPath(candidate));
  } catch {
    return undefined;
  }
}

/**
 * The pipeline's final JSON currently only contains `{ "success": true }`, while
 * the actual output path is printed in the preceding "Video ready:" log line.
 * Keep parsing both formats so completed runs can always point to their video.
 */
export function parseOutputVideo(output: string) {
  const lines = output.split(/\r?\n/);
  for (const line of [...lines].reverse()) {
    const ready = line.match(/Video ready:\s*(.+?\.mp4)\s*$/i);
    if (ready?.[1]) {
      const normalized = normalizeOutputVideo(ready[1]);
      if (normalized) return normalized;
    }

    try {
      const payload = JSON.parse(line.trim()) as { video_path?: unknown };
      if (typeof payload.video_path === "string") {
        const normalized = normalizeOutputVideo(payload.video_path);
        if (normalized) return normalized;
      }
    } catch {
      // Most pipeline lines are not JSON.
    }
  }
  return undefined;
}

async function saveGeneratedVideoDetails(relativePath: string) {
  const fileName = path.basename(relativePath);
  const patternName = fileName.replace(/_video\.mp4$/i, "");
  if (!patternName) return;

  const dateDir = path.dirname(relativePath);
  const captionPath = path.join(appConfig.dataDir(), dateDir, `${patternName}_reel_caption.txt`);
  const caption = await fs.readFile(captionPath, "utf8").catch(() => "");
  const title = patternName.replaceAll("_", " ").trim();
  if (!title && !caption.trim()) return;
  await saveVideoDetails(relativePath, { title, caption });
}

async function trackProcess(
  run: Run,
  command: string,
  args: string[],
  afterSuccess?: (stdout: string, outputVideo?: string) => Promise<void>,
  cwd: string = appConfig.skillDir(),
  envOverrides: Partial<NodeJS.ProcessEnv> = {},
) {
  const safeArgs = args.map((arg, index) => args[index - 1] === "--page-token" ? "[REDACTED]" : (arg.includes(" ") ? JSON.stringify(arg) : arg));
  const header = `$ ${command} ${safeArgs.join(" ")}\n\n`;
  appendFileSync(run.log_path, header, { mode: 0o600 });
  let child;
  try {
    const logFd = openSync(run.log_path, "a");
    child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...envOverrides },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    closeSync(logFd);
  } catch (error) {
    await finishRun(run.id, "failed", error instanceof Error ? error.message : "Không khởi động được pipeline.");
    await publishAfterRun(run);
    return;
  }
  child.on("error", (error) => {
    void fs.appendFile(run.log_path, `\nProcess error: ${error.message}\n`);
    void finishRun(run.id, "failed", error.message).then(() => publishAfterRun(run)).catch(() => {});
  });
  child.on("close", async (code) => {
    try {
      const output = await fs.readFile(run.log_path, "utf8").catch(() => "");
      if (code !== 0) throw new Error((output.split(/\r?\n/).slice(-20).join("\n") || `Pipeline kết thúc với mã ${code}.`).trim());
      // Python logging is written to stderr by default, while the final JSON
      // status is written to stdout. Parse both streams for the output path.
      const outputVideo = parseOutputVideo(output);
      const jsonLine = output.split(/\r?\n/).reverse().find((line) => {
        try { return Boolean(JSON.parse(line.trim()) && line.trim().startsWith("{")); } catch { return false; }
      })?.trim() || output;
      if (afterSuccess) await afterSuccess(jsonLine, outputVideo);
      if (outputVideo && run.action !== "youtube_publish") await saveGeneratedVideoDetails(outputVideo).catch(() => {});
      await finishRun(run.id, "success", undefined, outputVideo);
    } catch (error) {
      await finishRun(run.id, "failed", error instanceof Error ? error.message : "Pipeline lỗi không xác định.");
    }
    await publishAfterRun(run, parseOutputVideo(await fs.readFile(run.log_path, "utf8").catch(() => ""))).catch(async (error) => {
      await fs.appendFile(run.log_path, `\nPost-run action error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    });
  });
  await query(`UPDATE vc_runs_shared SET runner_pid = $2 WHERE id = $1 AND status = 'running'`, [run.id, child.pid ?? null]);
  child.unref();
}

export async function startYouTubePublish(input: YouTubeUploadInput, afterRunPublish?: AfterRunPublish) {
  const configuration = youtubeConfiguration();
  if (!configuration.configured) throw new Error(`Set ${configuration.missing.join(", ")} in .env.local.`);
  const root = await fs.realpath(appConfig.outputDir());
  const videoFile = await fs.realpath(resolvedOutputPath(input.path));
  if (!videoFile.startsWith(`${root}${path.sep}`)) throw new Error("Video must be inside OUTPUT_DIR.");
  const stat = await fs.stat(videoFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Video is missing or empty.");
  const script = path.join(appConfig.appRoot(), "scripts", "publish_youtube.py");
  await fs.access(script);
  const run = await createRun("youtube_publish", undefined, undefined, afterRunPublish);
  try {
    const jobPath = `${run.log_path}.json`;
    await fs.writeFile(jobPath, JSON.stringify({ ...input, videoFile }), { mode: 0o600 });
    await trackProcess(run, "python3", [script, jobPath], async (stdout) => {
      await recordYouTubeResult(input.path, stdout);
    });
  } catch (error) {
    await finishRun(run.id, "failed", error instanceof Error ? error.message : "Could not start YouTube upload.");
    await query(`UPDATE vc_runs_shared SET after_run_publish = NULL, after_run_pending = FALSE WHERE id = $1`, [run.id]);
    throw error;
  }
  return run;
}

async function recordYouTubeResult(relativePath: string, output: string) {
  const line = output.split(/\r?\n/).reverse().find((item) => item.trim().startsWith('{"success":'));
  const result = JSON.parse(line || output) as { success?: boolean; video_id?: string; privacy_status?: string };
  if (!result.success || !result.video_id || !/^[A-Za-z0-9_-]{11}$/.test(result.video_id)) {
    throw new Error("YouTube returned no valid video ID. Check YouTube Studio before retrying.");
  }
  await markYouTubeUploaded(relativePath, result.video_id, result.privacy_status || "private");
}

export async function startGeneration(input: {
  patternId?: number;
  patternName?: string;
  forceRecreate?: boolean;
  publishToFacebook?: boolean;
  youtube?: YouTubePublishSettings;
  scheduleJobId?: number;
}) {
  const selected = input.patternId !== undefined;
  if (selected && (!Number.isInteger(input.patternId) || input.patternId! <= 0 || !input.patternName?.trim())) {
    throw new Error("Chọn mẫu ngữ pháp hợp lệ trước khi tạo video.");
  }
  const youtube = input.youtube ? validateYouTubePublishSettings(input.youtube) : undefined;
  if (youtube && !youtubeConfiguration().configured) throw new Error("Configure YouTube OAuth credentials in .env.local first.");
  const repositoryRoot = path.resolve(appConfig.appRoot(), "../..");
  const script = path.join(repositoryRoot, "jobs", "create_grammar_video_jobs.py");
  const configPath = path.join(repositoryRoot, "jobs", "app-tools", "config.json");
  const rawConfig = await fs.readFile(configPath, "utf8").catch(() => {
    throw new Error("Không đọc được jobs/app-tools/config.json trên server.");
  });
  const jobConfig = JSON.parse(rawConfig) as {
    database?: { schema?: string };
    paths?: { dataDir?: string; outputDir?: string };
    job_config?: {
      create_grammar_video_jobs?: { dataDir?: string; outputDir?: string; schema?: string };
    };
  };
  const grammarJobConfig = jobConfig.job_config?.create_grammar_video_jobs;
  const configuredDataDir = path.resolve(
    repositoryRoot,
    grammarJobConfig?.dataDir || jobConfig.paths?.dataDir || "data",
  );
  const configuredOutputDir = path.resolve(
    repositoryRoot,
    grammarJobConfig?.outputDir || jobConfig.paths?.outputDir || "outputs",
  );
  if (configuredDataDir !== path.resolve(appConfig.dataDir())) {
    throw new Error("job_config.dataDir phải trùng VIDEO_DATA_DIR để Video Creator đọc được file tạo.");
  }
  if (configuredOutputDir !== path.resolve(appConfig.outputDir())) {
    throw new Error("job_config.outputDir phải trùng VIDEO_OUTPUT_DIR để video xuất hiện trong thư viện.");
  }
  await fs.access(script);
  const virtualenvPython = path.join(repositoryRoot, "jobs", "app-tools", ".venv", "bin", "python");
  const python = process.env.VIDEO_GRAMMAR_JOB_PYTHON?.trim() ||
    (await fs.access(virtualenvPython).then(() => virtualenvPython).catch(() => "python3"));
  const schema = new URL(appConfig.databaseUrl()).searchParams.get("schema") ||
    grammarJobConfig?.schema || jobConfig.database?.schema || "public";
  const run = await createRun(selected ? "generate_pattern" : "create_next", input.patternId, input.patternName?.trim(),
    input.publishToFacebook || youtube ? { facebook: input.publishToFacebook, youtube } : undefined, input.scheduleJobId);
  const args = [script, "--config", configPath, "--schema", schema];
  if (selected) args.push("--pattern-id", String(input.patternId));
  try {
    await trackProcess(run, python, args, undefined, repositoryRoot, {
      VIDEO_PIPELINE_RUN_ID: String(run.id),
    });
  } catch (error) {
    await finishRun(run.id, "failed", error instanceof Error ? error.message : "Could not start generation.");
    await publishAfterRun(run);
    throw error;
  }
  return run;
}

export async function startKanjiGeneration(input: {
  forceRecreate?: boolean;
  publishToFacebook?: boolean;
  youtube?: YouTubePublishSettings;
  scheduleJobId: number;
  kanjiOptions?: { source: string; durationSeconds: number; fps: number; autoFps: boolean };
}) {
  const { enqueueWordCreator, getWordCreatorJob } = await import("@video/lib/wordCreator/jobs");
  const source = input.kanjiOptions?.source.trim();
  if (!source) throw new Error("Chọn Kanji cụ thể cho lịch tạo WordCreator.");
  const active = await getWordCreatorJob();
  if (active && (active.status === "running" || active.status === "queued")) {
    throw Object.assign(new Error("Kanji worker is busy."), { code: "23505" });
  }
  const youtube = input.youtube ? validateYouTubePublishSettings(input.youtube) : undefined;
  if (youtube && !youtubeConfiguration().configured) throw new Error("Configure YouTube OAuth credentials in .env.local first.");
  const run = await createRun("create_kanji", undefined, source,
    input.publishToFacebook || youtube ? { facebook: input.publishToFacebook, youtube } : undefined, input.scheduleJobId);
  try {
    // A scheduled Kanji uses the same durable worker/logs as a manual render.
    // Its run occupies the shared schedule/upload slot until completion.
    await query("UPDATE vc_runs_shared SET runner_pid = $2 WHERE id = $1", [run.id, process.pid]);
    await fs.appendFile(run.log_path, "Scheduled Kanji generation queued.\n");
    await enqueueWordCreator({ ...input.kanjiOptions, sources: [source], scheduled: true,
      forceRecreate: input.forceRecreate, pipelineRunId: run.id }, false);
  } catch (error) {
    await finishRun(run.id, "failed", error instanceof Error ? error.message : "Could not enqueue Kanji.");
    await publishAfterRun(run);
    throw error;
  }
  return run;
}

export async function finishKanjiGeneration(runId: number, result?: {
  videoPath: string; source: string; requiredVocabulary: string;
}, error?: string) {
  const run = (await query<Run>("SELECT * FROM vc_runs_shared WHERE id = $1 AND object_type = 'word_creator' AND action = 'create_kanji'", [runId])).rows[0];
  if (!run || run.status !== "running") return;
  if (result && !error) {
    await markWordCreatorStatus(result.source, result.requiredVocabulary, "video_generated").catch(() => {});
    await query(`UPDATE vc_runs_shared SET after_run_publish = after_run_publish || $2::jsonb
      WHERE id = $1 AND after_run_publish IS NOT NULL`, [runId, JSON.stringify({
      title: `${result.source} ${result.requiredVocabulary}`,
      caption: `${result.requiredVocabulary} #kanji #jlpt #n1 #japanese #日本語 #漢字`,
    })]);
    await fs.appendFile(run.log_path, `\nVideo ready: ${result.videoPath}\n`);
  }
  await finishRun(runId, error || !result ? "failed" : "success", error || (!result ? "No Kanji video created." : undefined), result?.videoPath);
  await publishAfterRun(run, result?.videoPath);
}

const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;
const MAX_SCHEDULE_LEAD_MS = 29 * 24 * 60 * 60 * 1000;

function parseScheduledAt(value?: string) {
  if (!value?.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Thời gian lên lịch không hợp lệ.");
  if (date.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
    throw new Error("Thời gian lên lịch phải cách hiện tại ít nhất 10 phút.");
  }
  if (date.getTime() > Date.now() + MAX_SCHEDULE_LEAD_MS) {
    throw new Error("Facebook chỉ cho phép lên lịch trong vòng 29 ngày.");
  }
  return date;
}

export async function startFacebookPublish(
  relativePath: string,
  caption: string,
  options: { title?: string; scheduledAt?: string; publishJobId?: number } = {},
  afterRunPublish?: AfterRunPublish,
) {
  const videoFile = resolvedOutputPath(relativePath);
  const stat = await fs.stat(videoFile);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Không tìm thấy video MP4 để đăng.");
  if (!caption.trim()) throw new Error("Nhập caption trước khi đăng Facebook.");
  const scheduledAt = parseScheduledAt(options.scheduledAt);
  const run = await createRun("publish", undefined, undefined, afterRunPublish, undefined, options.publishJobId);
  try {
    const captionDir = path.join(appConfig.dataDir(), "video-creator", "captions");
    await fs.mkdir(captionDir, { recursive: true });
    const captionPath = path.join(captionDir, `${run.id}.txt`);
    await fs.writeFile(captionPath, caption.trim(), { mode: 0o600 });
    const args = ["grammar_pipeline_module/publish_reel.py", "--page-id", appConfig.pipelineConfig().facebook.pageId,
      "--page-token", appConfig.pipelineConfig().facebook.pageToken, "--video-file", videoFile, "--description-file", captionPath];
    if (options.title?.trim()) args.push("--title", options.title.trim());
    if (scheduledAt) args.push("--scheduled-publish-time", String(Math.floor(scheduledAt.getTime() / 1000)));
    await trackProcess(run, "python3", args, async (stdout) => {
      const payload = JSON.parse(stdout.trim()) as {
        video_id?: string; success?: boolean; scheduled_publish_time?: number | null;
      };
      if (!payload.success || !payload.video_id) throw new Error("Facebook không trả về video ID sau khi đăng.");
      if (scheduledAt || payload.scheduled_publish_time) {
        await markFacebookScheduled(
          relativePath,
          payload.video_id,
          scheduledAt || new Date(Number(payload.scheduled_publish_time) * 1000),
        );
      } else {
        await markFacebookPublished(relativePath, payload.video_id);
      }
    });
  } catch (error) {
    await finishRun(run.id, "failed", error instanceof Error ? error.message : "Could not start Facebook upload.");
    // The caller handles a start failure; leave no second continuation to retry.
    await query(`UPDATE vc_runs_shared SET after_run_publish = NULL, after_run_pending = FALSE WHERE id = $1`, [run.id]);
    throw error;
  }
  return run;
}

const resumedRuns = new Set<number>();

async function finalizeResumedRun(run: Pick<Run, "id" | "log_path" | "action" | "publish_job_id">) {
  const output = await fs.readFile(run.log_path, "utf8").catch(() => "");
  const outputVideo = parseOutputVideo(output);
  const succeeded = run.action !== "create_kanji" &&
    /PIPELINE COMPLETED SUCCESSFULLY|^\s*\{\s*"success"\s*:\s*true\b/m.test(output);
  if (succeeded) {
    if (run.action === "youtube_publish") {
      if (!outputVideo) throw new Error("YouTube upload log has no video path.");
      await recordYouTubeResult(outputVideo, output);
    } else if (run.action === "publish" && run.publish_job_id) {
      const job = (await query<{ relative_path: string }>(
        "SELECT relative_path FROM video_creator_publish_jobs WHERE id = $1", [run.publish_job_id],
      )).rows[0];
      const line = output.split(/\r?\n/).reverse().find((item) => {
        try { const parsed = JSON.parse(item); return parsed.success === true && parsed.video_id; }
        catch { return false; }
      });
      const result = JSON.parse(line || "{}") as { success?: boolean; video_id?: string };
      if (!job || !result.success || !result.video_id) throw new Error("Cannot recover scheduled Facebook result. Check Facebook before retrying.");
      await markFacebookPublished(job.relative_path, result.video_id);
    } else if (outputVideo) await saveGeneratedVideoDetails(outputVideo).catch(() => {});
    await finishRun(run.id, "success", undefined, outputVideo);
  } else {
    const error = /KeyboardInterrupt/.test(output)
      ? "Pipeline bị ngắt (KeyboardInterrupt), có thể do server khởi động lại."
      : "Pipeline đã dừng khi ứng dụng khởi động lại.";
    await finishRun(run.id, "failed", error);
  }
  await publishAfterRun(run, outputVideo).catch(async (error) => {
    await fs.appendFile(run.log_path, `\nPost-run recovery error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  });
}

function monitorResumedRun(run: Pick<Run, "id" | "log_path" | "action" | "publish_job_id">, pid: number) {
  if (resumedRuns.has(run.id)) return;
  resumedRuns.add(run.id);
  const timer = setInterval(() => {
    if (processAlive(pid)) return;
    clearInterval(timer);
    resumedRuns.delete(run.id);
    void finalizeResumedRun(run).catch(() => {
      void finishRun(run.id, "failed", "Could not recover upload metadata. Check publishing platform before retrying.");
    });
  }, 5_000);
  timer.unref();
}

export async function resumeActiveRuns() {
  await ensureVideoCreatorSchema();
  const result = await query<Pick<Run, "id" | "log_path" | "runner_pid" | "action" | "publish_job_id">>(
    `SELECT id, log_path, runner_pid, action, publish_job_id FROM vc_runs_shared
     WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
       AND status = 'running' AND runner_pid IS NOT NULL`,
  );
  for (const run of result.rows) {
    if (run.runner_pid && processAlive(run.runner_pid)) monitorResumedRun(run, run.runner_pid);
    else await finalizeResumedRun(run).catch(async () => {
      await finishRun(run.id, "failed", "Could not recover upload metadata. Check publishing platform before retrying.");
    });
  }
  // Also cover restart between marking a worker finished and claiming its
  // publishing continuation. Runs without an explicit saved opt-in are ignored.
  const pending = await query<Run>(`SELECT * FROM vc_runs_shared
    WHERE object_type IN ('grammar_video', 'word_creator', 'video_publish')
      AND status <> 'running' AND (after_run_publish IS NOT NULL OR after_run_pending) ORDER BY id`);
  for (const run of pending.rows) {
    await publishAfterRun(run, run.output_video || undefined);
  }
}
