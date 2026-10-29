import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  BATCH_JOBS_TABLE,
  BATCH_JOB_RUNS_TABLE,
  batchJobDb,
  hasBatchJobAccess,
} from "../../../../lib/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Context) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  const result = await batchJobDb.query<{
    pid: number | null;
    status: string;
    script_path: string;
  }>(
    `SELECT r.pid, r.status, j.script_path
     FROM ${BATCH_JOB_RUNS_TABLE} r
     JOIN ${BATCH_JOBS_TABLE} j ON j.id = r.job_id
     WHERE r.id = $1::uuid`,
    [id],
  );
  const run = result.rows[0];
  if (!run) {
    return NextResponse.json({ message: "Run not found." }, { status: 404 });
  }
  if (run.status !== "running") {
    return NextResponse.json(
      { message: "Run is no longer running." },
      { status: 409 },
    );
  }
  if (!run.pid || !Number.isInteger(run.pid) || run.pid <= 1) {
    return NextResponse.json(
      { message: "Run has no active process PID yet. Retry shortly." },
      { status: 409 },
    );
  }

  const expectedScript = `/${run.script_path}`;
  try {
    const [commandLine, stat] = await Promise.all([
      readFile(/*turbopackIgnore: true*/ `/proc/${run.pid}/cmdline`, "utf8"),
      readFile(/*turbopackIgnore: true*/ `/proc/${run.pid}/stat`, "utf8"),
    ]);
    if (!commandLine.includes(expectedScript)) {
      return NextResponse.json(
        { message: "Stored PID no longer belongs to this run." },
        { status: 409 },
      );
    }

    const closingParen = stat.lastIndexOf(")");
    const processGroup = Number(stat.slice(closingParen + 2).split(" ")[2]);
    const marked = await batchJobDb.query(
      `UPDATE ${BATCH_JOB_RUNS_TABLE}
       SET stage = 'stopping', heartbeat_at = NOW()
       WHERE id = $1::uuid AND status = 'running' AND pid = $2`,
      [id, run.pid],
    );
    if (!marked.rowCount) {
      return NextResponse.json(
        { message: "Run is no longer running." },
        { status: 409 },
      );
    }

    process.kill(processGroup === run.pid ? -run.pid : run.pid, "SIGTERM");
    return NextResponse.json(
      { stopping: true, message: "Stop requested." },
      { status: 202 },
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "ESRCH" || code === "ENOENT") {
      return NextResponse.json(
        { message: "Run process already stopped; status will refresh shortly." },
        { status: 409 },
      );
    }
    console.error("BATCH_JOB_STOP_ERROR", error);
    return NextResponse.json(
      { message: "Could not stop run process." },
      { status: 500 },
    );
  }
}
