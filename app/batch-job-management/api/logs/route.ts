import { open } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  BATCH_JOB_RUNS_TABLE,
  batchJobDb,
  hasBatchJobAccess,
  quoteDatabaseIdentifier,
} from "../../lib/server";

export const runtime = "nodejs";

const ROOT = process.cwd();
const JOBS_ROOT = path.join(ROOT, "jobs");
const MAX_LOG_BYTES = 64 * 1024;

export async function GET(request: NextRequest) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const source = params.get("source");
  const id = params.get("id") || "";
  const schema = params.get("schema") || "";
  if (!id || !["batch", "subtask"].includes(source || "")) {
    return NextResponse.json({ message: "Invalid log request." }, { status: 400 });
  }

  try {
    let logPath: string | null;
    if (source === "batch") {
      const result = await batchJobDb.query<{ log_path: string | null }>(
        `SELECT log_path FROM ${BATCH_JOB_RUNS_TABLE} WHERE id = $1::uuid`,
        [id],
      );
      logPath = result.rows[0]?.log_path || null;
    } else {
      if (!/^\d+$/.test(id)) {
        return NextResponse.json({ message: "Invalid subtask run ID." }, { status: 400 });
      }
      const table = `${quoteDatabaseIdentifier(schema, "schema")}."runs"`;
      const result = await batchJobDb.query<{ log_path: string | null }>(
        `SELECT log_path FROM ${table} WHERE id = $1`,
        [Number(id)],
      );
      logPath = result.rows[0]?.log_path || null;
    }

    if (!logPath) {
      return NextResponse.json({ message: "Log file not found." }, { status: 404 });
    }
    const absolutePath = path.resolve(/*turbopackIgnore: true*/ ROOT, logPath);
    const realPath = await import("node:fs/promises").then(({ realpath }) =>
      realpath(absolutePath),
    );
    if (realPath !== JOBS_ROOT && !realPath.startsWith(`${JOBS_ROOT}${path.sep}`)) {
      return NextResponse.json({ message: "Log path is outside jobs/." }, { status: 403 });
    }

    const file = await open(realPath, "r");
    try {
      const stats = await file.stat();
      const length = Math.min(stats.size, MAX_LOG_BYTES);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, Math.max(0, stats.size - length));
      return NextResponse.json({
        log: buffer.toString("utf8"),
        truncated: stats.size > length,
      });
    } finally {
      await file.close();
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "ENOENT") {
      return NextResponse.json({ message: "Log file not found." }, { status: 404 });
    }
    return NextResponse.json({ message: "Could not read run log." }, { status: 500 });
  }
}
