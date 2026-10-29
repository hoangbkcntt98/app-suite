import { NextRequest, NextResponse } from "next/server";
import {
  BATCH_JOBS_TABLE,
  BATCH_JOB_RUNS_TABLE,
  batchJobDb,
  hasBatchJobAccess,
  validateConfigPath,
  validateJobArgs,
  validateScriptPath,
} from "../../../lib/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Invalid update." }, { status: 400 });
  }

  if (body.runNow === true) {
    const result = await batchJobDb.query(
      `UPDATE ${BATCH_JOBS_TABLE} SET next_run_at = NOW(), enabled = TRUE, updated_at = NOW()
       WHERE id = $1::uuid RETURNING *`,
      [id],
    );
    if (!result.rowCount) {
      return NextResponse.json({ message: "Job not found." }, { status: 404 });
    }
    return NextResponse.json({ job: result.rows[0] });
  }

  if (body.edit === true) {
    try {
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
        `UPDATE ${BATCH_JOBS_TABLE} j
         SET name = $2, script_path = $3, config_path = $4, args = $5::jsonb,
             interval_seconds = $6::int, run_once = $7::boolean,
             next_run_at = CASE WHEN $7::boolean THEN NOW()
                                ELSE NOW() + ($6::int * INTERVAL '1 second') END,
             updated_at = NOW()
         WHERE j.id = $1::uuid AND j.enabled = FALSE
           AND NOT EXISTS (
             SELECT 1 FROM ${BATCH_JOB_RUNS_TABLE} r
             WHERE r.job_id = j.id AND r.status = 'running'
           )
         RETURNING j.*`,
        [
          id,
          name,
          scriptPath,
          configPath,
          JSON.stringify(args),
          intervalSeconds,
          runOnce,
        ],
      );
      if (!result.rowCount) {
        const existing = await batchJobDb.query(
          `SELECT j.enabled,
             EXISTS (SELECT 1 FROM ${BATCH_JOB_RUNS_TABLE} r
                     WHERE r.job_id = j.id AND r.status = 'running') AS running
           FROM ${BATCH_JOBS_TABLE} j WHERE j.id = $1::uuid`,
          [id],
        );
        if (!existing.rowCount) {
          return NextResponse.json({ message: "Job not found." }, { status: 404 });
        }
        return NextResponse.json(
          { message: "Pause job and wait for active runs before editing." },
          { status: 409 },
        );
      }
      return NextResponse.json({ job: result.rows[0] });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update job.";
      return NextResponse.json({ message }, { status: 400 });
    }
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { message: "enabled must be boolean." },
      { status: 400 },
    );
  }
  const result = await batchJobDb.query(
    `UPDATE ${BATCH_JOBS_TABLE} SET enabled = $2, updated_at = NOW() WHERE id = $1::uuid
     RETURNING *`,
    [id, body.enabled],
  );
  if (!result.rowCount) {
    return NextResponse.json({ message: "Job not found." }, { status: 404 });
  }
  return NextResponse.json({ job: result.rows[0] });
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const result = await batchJobDb.query(
    `DELETE FROM ${BATCH_JOBS_TABLE} j
     WHERE j.id = $1::uuid
       AND NOT EXISTS (
         SELECT 1 FROM ${BATCH_JOB_RUNS_TABLE} r
         WHERE r.job_id = j.id AND r.status = 'running'
       )
     RETURNING id`,
    [id],
  );
  if (!result.rowCount) {
    return NextResponse.json(
      { message: "Job not found or has a running execution." },
      { status: 409 },
    );
  }
  return NextResponse.json({ deleted: true });
}
