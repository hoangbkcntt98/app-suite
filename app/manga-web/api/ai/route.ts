import { NextResponse } from "next/server";
import {
  getAiImage,
  getCachedImageTranslation,
  requestImageAi,
  saveAiResponse,
  translateImageWithAi,
  type ApiResponse,
} from "@manga/lib/aiTranslation";
import { resolveImageAiSelection } from "@manga/lib/aiModels";

type AiRequest =
  | {
      action: "translate";
      imageId: string | number;
      model?: string;
      provider?: string;
    }
  | {
      action: "chat";
      imageId: string | number;
      message: string;
      model?: string;
      provider?: string;
    };

export async function POST(request: Request) {
  let body: AiRequest;

  try {
    body = (await request.json()) as AiRequest;
  } catch {
    return NextResponse.json(
      { error: "リクエストの形式が正しくありません。" },
      { status: 400 }
    );
  }

  const imageId = String(body.imageId ?? "");
  if (
    (body.action !== "translate" && body.action !== "chat") ||
    !/^\d+$/.test(imageId)
  ) {
    return NextResponse.json(
      { error: "画像または操作が正しくありません。" },
      { status: 400 }
    );
  }

  if (
    body.action === "chat" &&
    (typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > 4000)
  ) {
    return NextResponse.json(
      { error: "メッセージを入力してください。" },
      { status: 400 }
    );
  }

  const image = await getAiImage(imageId);
  if (!image) {
    return NextResponse.json(
      { error: "この画像は見つかりませんでした。" },
      { status: 404 }
    );
  }

  let selection;
  try {
    selection = resolveImageAiSelection(body.provider, body.model);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "AI model is invalid.",
      },
      { status: 400 }
    );
  }

  if (body.action === "translate") {
    const cached = await getCachedImageTranslation(image.id);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }
  }

  try {
    let apiResponse: ApiResponse;
    if (body.action === "translate") {
      apiResponse = await translateImageWithAi({
        image,
        selection,
      });
    } else {
      const { content, model } = await requestImageAi({
        image,
        message: body.message,
        selection,
      });
      apiResponse = { kind: "chat", content };
      await saveAiResponse({
        action: "chat",
        image,
        model,
        prompt: body.message.trim(),
        response: apiResponse,
      });
    }

    return NextResponse.json({ ...apiResponse, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AIサービスに接続できませんでした。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
