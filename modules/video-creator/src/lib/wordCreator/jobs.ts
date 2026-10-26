import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { appConfig } from "@video/lib/config";
import { db, ensureVideoCreatorSchema, query } from "@video/lib/db";
import { generateWordCreator, type WordCreatorOptions, type WordCreatorLogger } from "@video/lib/wordCreator";

export type WordCreatorJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  processed: number;
  generated: number;
  current_source: string | null;
  errors: Array<{ source: string; error: string }>;
  error: string | null;
};

let schemaPromise: Promise<void> | undefined;

async function ensureJobsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      // Keep in sync with db/008_word_creator_jobs.sql.
      await query(`CREATE TABLE IF NOT EXISTS word_creator_jobs (
        id UUID PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        options JSONB NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        generated INTEGER NOT NULL DEFAULT 0,
        current_source TEXT,
        errors JSONB NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      )`);
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS word_creator_one_active_job_idx
        ON word_creator_jobs ((1)) WHERE status IN ('queued', 'running')`);
    })().catch((error) => { schemaPromise = undefined; throw error; });
  }
  await schemaPromise;
}

const columns = "id, status, total, processed, generated, current_source, errors, error";

export async function enqueueWordCreator(options: WordCreatorOptions, reuseActive = true) {
  if (!Array.isArray(options.sources) || options.sources.length === 0
    || options.sources.some((source) => typeof source !== "string" || !source.trim())) {
    throw new Error("Chọn Kanji cần tạo trước khi chạy WordCreator.");
  }
  await ensureVideoCreatorSchema();
  await ensureJobsSchema();
  const jobId = randomUUID();
  // Reuse retries only when they requested identical work; never substitute
  // another queued/scheduled batch for an explicitly selected Kanji batch.
  const result = await query<WordCreatorJob>(`INSERT INTO word_creator_jobs (id, options)
    VALUES ($1, $2::jsonb)
    ON CONFLICT ((1)) WHERE status IN ('queued', 'running')
    ${reuseActive
      ? "DO UPDATE SET updated_at = word_creator_jobs.updated_at WHERE word_creator_jobs.options = EXCLUDED.options"
      : "DO NOTHING"}
    RETURNING ${columns}`, [jobId, JSON.stringify(options)]);
  if (!result.rows[0]) {
    throw Object.assign(new Error("Đang có batch WordCreator khác chạy. Chờ batch kết thúc rồi gửi lựa chọn Kanji."), { code: "WORD_CREATOR_BUSY" });
  }
  if (result.rows[0].id === jobId && !options.pipelineRunId) {
    const logDir = path.join(appConfig.logDir(), "video-creator", "runs");
    await fs.mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, `${new Date().toISOString().replaceAll(":", "-")}-create_kanji.log`);
    await fs.writeFile(logPath, "WordCreator batch queued.\n", { mode: 0o600 });
    const run = await query<{ id: number }>(`INSERT INTO vc_runs_shared
      (action, pattern_name, status, log_path, object_type, object_id, metadata)
      VALUES ('create_kanji', $1, 'running', $2, 'word_creator', $3, $4::jsonb)
      RETURNING id`, [options.sources.join(", "), logPath, jobId, JSON.stringify({ options })]);
    if (!run.rows[0]) {
      await query(`UPDATE word_creator_jobs SET status = 'failed', error = 'Could not create run record.',
        finished_at = NOW(), updated_at = NOW() WHERE id = $1`, [jobId]);
      throw new Error("Không tạo được WordCreator run.");
    }
    await query(`UPDATE word_creator_jobs SET options = options || $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [jobId, JSON.stringify({ pipelineRunId: run.rows[0].id })]);
  }
  startWordCreatorWorker();
  return result.rows[0];
}

export async function getWordCreatorJob(id?: string) {
  await ensureJobsSchema();
  const result = id
    ? await query<WordCreatorJob>(`SELECT ${columns} FROM word_creator_jobs WHERE id = $1::uuid`, [id])
    : await query<WordCreatorJob>(`SELECT ${columns} FROM word_creator_jobs ORDER BY created_at DESC LIMIT 1`);
  const job = result.rows[0];
  if (!job) return null;
  return job;
}

export async function tickWordCreatorJobs() {
  await ensureJobsSchema();
  const client = await db().connect();
  let locked = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => { connectionError = error; };
  client.on("error", onError);
  try {
    // Session lock spans the whole batch, including Chromium/FFmpeg awaits.
    // Multiple Next workers cannot render the same HTML at the same time.
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(824731, 1) AS locked");
    locked = lock.rows[0].locked;
    if (!locked) return;
    // Owning the lock means no previous worker still owns a running job.
    // Do not silently repeat AI calls/rendering after a server restart.
    const interrupted = await client.query<{ options: WordCreatorOptions; error: string }>(`UPDATE word_creator_jobs SET status = 'failed',
      error = 'Tạo video bị gián đoạn do worker dừng hoặc server khởi động lại. Hãy tạo lại.',
      current_source = NULL, finished_at = NOW(), updated_at = NOW()
      WHERE status = 'running' RETURNING id, error, options`);
    for (const previous of interrupted.rows) {
      if (previous.options.pipelineRunId) {
        const { finishKanjiGeneration } = await import("@video/lib/pipeline");
        await finishKanjiGeneration(previous.options.pipelineRunId, undefined, previous.error);
      }
    }
    const pending = await client.query<WordCreatorJob & { options: WordCreatorOptions }>(
      `UPDATE word_creator_jobs SET status = 'running', updated_at = NOW()
       WHERE id = (SELECT id FROM word_creator_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1)
       RETURNING ${columns}, options`,
    );
    const job = pending.rows[0];
    if (!job) return;
    let runLogPath: string | undefined;
    if (job.options.pipelineRunId) {
      const run = (await client.query<{ status: string; log_path: string }>(
        "SELECT status, log_path FROM vc_runs_shared WHERE id = $1 AND object_type = 'word_creator' AND action = 'create_kanji'", [job.options.pipelineRunId])).rows[0];
      if (!run || run.status !== "running") {
        await client.query(`UPDATE word_creator_jobs SET status = 'failed', error = 'Scheduled run interrupted; not replayed.',
          finished_at = NOW(), updated_at = NOW() WHERE id = $1`, [job.id]);
        return;
      }
      runLogPath = run.log_path;
    }
    const log: WordCreatorLogger = async (message, level = "info", source) => {
      if (connectionError) throw connectionError;
      if (runLogPath) await fs.appendFile(runLogPath, `[${new Date().toISOString()}] ${level} ${source || ""} ${message}\n`);
    };
    try {
      await log("Worker bắt đầu tạo video.");
      const result = await generateWordCreator(job.options, async (progress) => {
        if (connectionError) throw connectionError;
        await client.query(`UPDATE word_creator_jobs SET total = $2, processed = $3,
          generated = $4, current_source = $5, errors = $6::jsonb, updated_at = NOW()
          WHERE id = $1`,
        [job.id, progress.total, progress.processed, progress.generated,
          progress.currentSource, JSON.stringify(progress.errors)]);
      }, log);
      if (job.options.pipelineRunId && !result.generated) {
        throw new Error(result.errors[0]?.error || "Không còn Kanji chưa tạo. Chọn Force recreate để tạo lại.");
      }
      await log("Tác vụ hoàn tất.");
      await client.query(`UPDATE word_creator_jobs SET status = 'completed',
        current_source = NULL, finished_at = NOW(), updated_at = NOW() WHERE id = $1`, [job.id]);
      if (job.options.pipelineRunId) {
        const { finishKanjiGeneration } = await import("@video/lib/pipeline");
        await finishKanjiGeneration(job.options.pipelineRunId, result.results[0]);
      }
    } catch (error) {
      await log(error instanceof Error ? error.message : "Không tạo được WordCreator.", "error");
      await client.query(`UPDATE word_creator_jobs SET status = 'failed', error = $2,
        current_source = NULL, finished_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [job.id, error instanceof Error ? error.message : "Không tạo được WordCreator."]);
      if (job.options.pipelineRunId) {
        const { finishKanjiGeneration } = await import("@video/lib/pipeline");
        await finishKanjiGeneration(job.options.pipelineRunId, undefined, error instanceof Error ? error.message : "Kanji render failed.");
      }
    }
  } finally {
    if (locked && !connectionError) {
      await client.query("SELECT pg_advisory_unlock(824731, 1)").catch((error: Error) => { connectionError = error; });
    }
    client.removeListener("error", onError);
    client.release(connectionError);
  }
}

type WorkerState = typeof globalThis & { __wordCreatorWorkerStarted?: boolean };

export function startWordCreatorWorker() {
  const state = globalThis as WorkerState;
  if (state.__wordCreatorWorkerStarted || process.env.NODE_ENV === "test") return;
  state.__wordCreatorWorkerStarted = true;
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tickWordCreatorJobs();
    } catch (error) {
      console.error("WordCreator worker:", error);
    } finally {
      ticking = false;
    }
  };
  // Persistent Node/PM2 worker; never await rendering inside an HTTP request.
  const timer = setInterval(() => { void tick(); }, 2_000);
  timer.unref();
}
