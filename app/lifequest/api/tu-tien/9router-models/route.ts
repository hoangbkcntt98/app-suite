import { NextResponse } from "next/server";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { isAiNarrationFeatureEnabled } from "@lifequest/lib/tu-tien";

type ModelPayload = {
  data?: unknown;
  models?: unknown;
};

function apiBaseUrl(): string {
  return (process.env.LIFEQUEST_NINE_ROUTER_API_BASE || "http://127.0.0.1:20128/v1").replace(
    /\/+$/,
    ""
  );
}

function modelIds(payload: unknown): string[] {
  const source =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object"
        ? ((payload as ModelPayload).data ?? (payload as ModelPayload).models)
        : [];
  if (!Array.isArray(source)) return [];

  return [
    ...new Set(
      source.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const model = item as { id?: unknown; name?: unknown; model?: unknown };
        const value = model.id ?? model.name ?? model.model;
        return typeof value === "string" &&
          value.trim() &&
          value.length <= 200 &&
          !/[\u0000-\u001f]/.test(value)
          ? [value.trim()]
          : [];
      })
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export async function GET() {
  const authUser = await getCurrentUserFromCookie();
  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  if (!isAiNarrationFeatureEnabled()) {
    return NextResponse.json(
      { message: "AI narration is disabled." },
      { status: 403 }
    );
  }

  const apiKey = process.env.LIFEQUEST_NINE_ROUTER_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { message: "9router is not configured." },
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${apiBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn("TU_TIEN_9ROUTER_MODELS_ERROR", response.status);
      return NextResponse.json(
        { message: "Không thể tải model từ 9router." },
        { status: 502 }
      );
    }

    const models = modelIds(await response.json());
    if (models.length === 0) {
      return NextResponse.json(
        { message: "9router không trả model hợp lệ." },
        { status: 502 }
      );
    }

    return NextResponse.json({ models });
  } catch (error) {
    console.warn(
      "TU_TIEN_9ROUTER_MODELS_ERROR",
      error instanceof Error ? error.message : "Unknown model-list error"
    );
    return NextResponse.json(
      { message: "Không thể kết nối 9router." },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
