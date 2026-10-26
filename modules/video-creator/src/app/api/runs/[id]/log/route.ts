import { getRunLog } from "@video/services/runService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return Response.json({ error: "Run ID không hợp lệ." }, { status: 400 });
  }

  try {
    const result = await getRunLog(runId);
    return result
      ? Response.json(result)
      : Response.json({ error: "Không tìm thấy pipeline run." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không đọc được log pipeline." }, { status: 500 });
  }
}
