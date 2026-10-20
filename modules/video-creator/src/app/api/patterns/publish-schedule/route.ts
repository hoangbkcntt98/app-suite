import { BulkPublishError, cancelBulkPublish, createBulkPublish, getBulkPublishState, previewBulkPublish } from "@video/lib/bulkPublish";

export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof BulkPublishError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Bulk publish API:", error);
  return Response.json({ error: "Không xử lý được lịch đăng. Kiểm tra database và thư mục video." }, { status: 500 });
}

export async function GET() {
  try { return Response.json(await getBulkPublishState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "JSON không hợp lệ." }, { status: 400 });
  try {
    if (body.action === "preview") return Response.json({ preview: await previewBulkPublish(body.settings) });
    if (body.action === "schedule") return Response.json(await createBulkPublish(body), { status: 201 });
    return Response.json({ error: "Action không hợp lệ." }, { status: 400 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.confirmCancel !== true) return Response.json({ error: "Cần xác nhận hủy lịch." }, { status: 400 });
  try { return Response.json({ cancelledCount: await cancelBulkPublish(body.batchId) }); }
  catch (error) { return failure(error); }
}
