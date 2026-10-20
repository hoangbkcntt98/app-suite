import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import {
  getCrowdworksPool,
  serializeCrowdworksJob,
  type CrowdworksJobRow,
} from "@lifequest/lib/crowdworks";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();
  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim() ?? "active";
  const requestedLimit = Number(searchParams.get("limit") ?? "50");
  const requestedOffset = Number(searchParams.get("offset") ?? "0");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT)
    : 50;
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(Math.trunc(requestedOffset), 0)
    : 0;

  const values: (string | number)[] = [];
  const conditions: string[] = [];

  if (status && status !== "all") {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  if (query) {
    values.push(`%${query}%`);
    const queryParameter = `$${values.length}`;
    conditions.push(
      `(title ILIKE ${queryParameter} OR client_name ILIKE ${queryParameter} OR tool_idea ILIKE ${queryParameter} OR automation_reason ILIKE ${queryParameter})`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParameter = values.length + 1;
  values.push(limit);
  const offsetParameter = values.length + 1;
  values.push(offset);

  try {
    const result = await getCrowdworksPool().query<CrowdworksJobRow>(
      `
        SELECT
          id,
          crowdworks_job_id,
          canonical_url,
          title,
          client_name,
          posted_date,
          application_deadline,
          budget_text,
          priority,
          automation_level,
          automation_reason,
          tool_idea,
          poc_scope,
          estimated_manual_workload,
          estimated_automation_percentage,
          suggested_project_price,
          japanese_proposal,
          first_seen_at,
          last_seen_at,
          status,
          source,
          COUNT(*) OVER() AS total_count
        FROM crowdworks_jobs
        ${whereClause}
        ORDER BY priority DESC NULLS LAST, last_seen_at DESC
        LIMIT $${limitParameter}
        OFFSET $${offsetParameter}
      `,
      values
    );

    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    return NextResponse.json({
      jobs: result.rows.map(serializeCrowdworksJob),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("GET_CROWDWORKS_JOBS_ERROR", error);
    return NextResponse.json(
      { message: "Không thể tải CrowdWorks jobs." },
      { status: 500 }
    );
  }
}
