import { NextRequest, NextResponse } from "next/server";
import {
  BATCH_JOB_RUNS_TABLE,
  batchJobDb,
  hasBatchJobAccess,
} from "../../lib/server";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest) {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids)] : [];
  if (
    ids.length < 1 ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !UUID_RE.test(id))
  ) {
    return NextResponse.json({ message: "Invalid run IDs." }, { status: 400 });
  }

  try {
    const result = await batchJobDb.query<{ id: string }>(
      `DELETE FROM ${BATCH_JOB_RUNS_TABLE}
       WHERE id = ANY($1::uuid[]) AND status NOT IN ('running', 'stopping')
       RETURNING id`,
      [ids],
    );
    return NextResponse.json({
      deletedIds: result.rows.map((row) => row.id),
      deletedCount: result.rowCount || 0,
      skippedCount: ids.length - (result.rowCount || 0),
    });
  } catch {
    return NextResponse.json(
      { message: "Không xóa được batch activity." },
      { status: 503 },
    );
  }
}
