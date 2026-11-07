import { NextResponse } from "next/server";
import {
  batchJobDb,
  getSubtaskRunSchemas,
  hasBatchJobAccess,
  quoteDatabaseIdentifier,
} from "../../lib/server";

export const runtime = "nodejs";

type SubtaskRun = {
  id: number;
  schema: string;
  object_id: string | null;
  status: string;
  object_type: string | null;
  action: string | null;
  progress: number | null;
  log_path: string | null;
  started_at: string;
  is_completed: boolean;
};

export async function GET() {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const schemas = await getSubtaskRunSchemas();
    const results = await Promise.all(
      schemas.map(async (schema) => {
        const table = `${quoteDatabaseIdentifier(schema, "schema")}."runs"`;
        try {
          const result = await batchJobDb.query<Omit<SubtaskRun, "schema">>(
            `SELECT id, object_id, status, object_type, action, progress,
                    log_path, started_at, is_completed
             FROM ${table}
             ORDER BY started_at DESC
             LIMIT 100`,
          );
          return result.rows.map((run) => ({ ...run, schema }));
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "";
          if (code === "42P01" || code === "3F000") return [];
          throw error;
        }
      }),
    );
    const runs = results
      .flat()
      .sort(
        (left, right) =>
          new Date(right.started_at).getTime() -
          new Date(left.started_at).getTime(),
      )
      .slice(0, 100);

    return NextResponse.json({ runs });
  } catch {
    return NextResponse.json(
      { message: "Không tải được sub task runs." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const requestedRuns = Array.isArray(body?.runs) ? body.runs : [];
  if (requestedRuns.length < 1 || requestedRuns.length > 100) {
    return NextResponse.json({ message: "Invalid subtask run IDs." }, { status: 400 });
  }

  try {
    const allowedSchemas = new Set(await getSubtaskRunSchemas());
    const groupedIds = new Map<string, Set<number>>();
    for (const run of requestedRuns) {
      if (
        !run ||
        typeof run !== "object" ||
        typeof run.schema !== "string" ||
        !allowedSchemas.has(run.schema) ||
        !Number.isSafeInteger(run.id) ||
        run.id < 1
      ) {
        return NextResponse.json({ message: "Invalid subtask run IDs." }, { status: 400 });
      }
      const ids = groupedIds.get(run.schema) || new Set<number>();
      ids.add(run.id);
      groupedIds.set(run.schema, ids);
    }

    const deletedRuns: { schema: string; id: number }[] = [];
    for (const [schema, ids] of groupedIds) {
      const table = `${quoteDatabaseIdentifier(schema, "schema")}."runs"`;
      const result = await batchJobDb.query<{ id: number }>(
        `DELETE FROM ${table}
         WHERE id = ANY($1::bigint[]) AND is_completed = TRUE
         RETURNING id`,
        [[...ids]],
      );
      deletedRuns.push(
        ...result.rows.map((row) => ({ schema, id: Number(row.id) })),
      );
    }

    return NextResponse.json({
      deletedRuns,
      deletedCount: deletedRuns.length,
      skippedCount: requestedRuns.length - deletedRuns.length,
    });
  } catch {
    return NextResponse.json(
      { message: "Không xóa được sub task activity." },
      { status: 503 },
    );
  }
}
