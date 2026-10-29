import { NextRequest, NextResponse } from "next/server";
import {
  BATCH_JOBS_TABLE,
  BATCH_JOB_RUNS_TABLE,
  batchJobDb,
  getDefaultConfigPath,
  hasBatchJobAccess,
  validateConfigPath,
  validateJobArgs,
  validateScriptPath,
} from "../../lib/server";

export const runtime = "nodejs";

function databaseError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "42P01") {
    return {
      status: 503,
      message:
        "Batch Job Management tables are missing. Run `npm run db:migrate`.",
    };
  }
  return {
    status: 503,
    message: "Database unavailable. Check DATABASE_URL and database connectivity.",
  };
}

export async function GET() {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const [jobs, runs] = await Promise.all([
      batchJobDb.query(
        `SELECT j.*,
          (SELECT COUNT(*)::int FROM ${BATCH_JOB_RUNS_TABLE} r
           WHERE r.job_id = j.id AND r.status = 'running') AS running_count,
          (SELECT r.status FROM ${BATCH_JOB_RUNS_TABLE} r
           WHERE r.job_id = j.id ORDER BY r.started_at DESC LIMIT 1) AS last_status
         FROM ${BATCH_JOBS_TABLE} j
         ORDER BY j.created_at DESC`,
      ),
      batchJobDb.query(
        `SELECT r.id, r.job_id, j.name AS job_name, r.status, r.progress, r.stage,
                r.pid, r.log_path, r.error, r.started_at, r.finished_at
         FROM ${BATCH_JOB_RUNS_TABLE} r
         JOIN ${BATCH_JOBS_TABLE} j ON j.id = r.job_id
         ORDER BY r.started_at DESC
         LIMIT 100`,
      ),
    ]);

    return NextResponse.json({
      defaultConfigPath: getDefaultConfigPath(),
      jobs: jobs.rows,
      runs: runs.rows,
    });
  } catch (error) {
    const failure = databaseError(error);
    return NextResponse.json(
      { message: failure.message },
      { status: failure.status },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  try {
    if (!body || typeof body !== "object") throw new Error("Invalid job data.");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      throw new Error("Job name is required (max 100 characters).");
    }
    const runOnce = body.runOnce === true;
    const intervalSeconds = runOnce ? null : Number(body.intervalSeconds);
    if (
      !runOnce &&
      (!Number.isInteger(intervalSeconds) ||
        intervalSeconds! < 10 ||
        intervalSeconds! > 2_592_000)
    ) {
      throw new Error("Interval must be between 10 seconds and 30 days.");
    }

    const scriptPath = validateScriptPath(body.scriptPath);
    const configPath = validateConfigPath(body.configPath);
    const args = validateJobArgs(body.args);
    const result = await batchJobDb.query(
      `INSERT INTO ${BATCH_JOBS_TABLE}
         (name, script_path, config_path, args, interval_seconds, run_once, next_run_at)
       VALUES (
         $1, $2, $3, $4::jsonb, $5::int, $6::boolean,
         CASE WHEN $6::boolean THEN NOW()
              ELSE NOW() + ($5::int * INTERVAL '1 second') END
       )
       RETURNING *`,
      [name, scriptPath, configPath, JSON.stringify(args), intervalSeconds, runOnce],
    );
    return NextResponse.json({ job: result.rows[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create job.";
    const isDatabaseError =
      error !== null &&
      typeof error === "object" &&
      "code" in error;
    if (isDatabaseError) {
      const failure = databaseError(error);
      return NextResponse.json(
        { message: failure.message },
        { status: failure.status },
      );
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}
