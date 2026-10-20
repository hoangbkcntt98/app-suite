import { PatternResetConflict, resetPatternsWithoutVideo } from "@video/lib/grammarPatterns";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.confirmReset !== true) {
    return Response.json({ error: "Cần xác nhận reset status." }, { status: 400 });
  }
  try {
    const resetCount = await resetPatternsWithoutVideo();
    return Response.json({ resetCount });
  } catch (error) {
    if (error instanceof PatternResetConflict) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Grammar pattern reset failed:", error);
    return Response.json({ error: "Không reset được status. Kiểm tra database và thư mục video." }, { status: 500 });
  }
}
