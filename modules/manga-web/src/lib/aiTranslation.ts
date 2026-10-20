import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ImageFormat,
} from "@aws-sdk/client-bedrock-runtime";
import { readFile } from "fs/promises";
import { extname } from "path";
import { pool } from "@manga/lib/db";
import { apiPath } from "@manga/lib/paths";
import {
  getStoredAiModel,
  resolveImageAiSelection,
  type ImageAiSelection,
} from "@manga/lib/aiModels";

export const TRANSLATE_PROMPT =
  'Hãy đọc toàn bộ chữ trong ảnh này. Trích xuất các từ/cụm từ tiếng Nhật trong ảnh, sau đó dịch sang tiếng Việt. Chỉ trả về JSON hợp lệ, không Markdown, không giải thích ngoài JSON. Format bắt buộc: {"items":[{"text":"từ/cụm từ trong ảnh","reading":"cách đọc nếu biết, nếu không thì null","meaning_vi":"nghĩa tiếng Việt","confidence":0.0}],"note":"ghi chú nếu ảnh mờ/không đọc được, nếu không thì null"}';

export type ApiResponse = {
  kind: "chat" | "translation";
  content: unknown;
};

export type ImageRecord = {
  id: string;
  src: string;
  local_path: string | null;
  chapter_id: string;
  manga_title_id: string;
  store_images_locally: boolean;
};

type OpenClawResponse = {
  choices?: Array<{
    message?: { content?: string };
    text?: string;
  }>;
  error?: { message?: string };
};

function extractJsonSlice(text: string) {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char !== "}" && char !== "]") continue;

    const expected = char === "}" ? "{" : "[";
    if (stack.pop() !== expected) return null;
    if (stack.length === 0) return text.slice(start, index + 1);
  }

  return null;
}

export function parseLooseJson<T = unknown>(text: string): T {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const jsonSlice = extractJsonSlice(trimmed);
    if (!jsonSlice) throw new Error("JSON response is invalid.");
    return JSON.parse(jsonSlice) as T;
  }
}

function normalizeOpenClawBaseUrl() {
  const configured =
    process.env.MANGA_OPENCLAW_BASE_URL?.trim() || "http://openclaw:20128";
  const withProtocol = /^https?:\/\//i.test(configured)
    ? configured
    : `http://${configured}`;

  return withProtocol.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

export async function getAiImage(imageId: string) {
  const imageResult = await pool.query<ImageRecord>(
    `SELECT
       i.id,
       i.src,
       i.local_path,
       i.chapter_id,
       c.manga_title_id,
       s.store_images_locally
     FROM chapter_images i
     JOIN manga_chapters c ON c.id = i.chapter_id
     JOIN manga_titles m ON m.id = c.manga_title_id
     JOIN crawler_sites s ON s.site_key = m.site_key
     WHERE i.id = $1
       AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)`,
    [imageId]
  );

  return imageResult.rows[0] ?? null;
}

export async function getCachedImageTranslation(
  imageId: string,
  model?: string
) {
  const cachedResult = await pool.query<{ response: ApiResponse }>(
    `SELECT response
     FROM manga_ai_responses
     WHERE image_id = $1
       AND action = 'translate'
       AND ($2::text IS NULL OR model = $2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [imageId, model ?? null]
  );

  const response = cachedResult.rows[0]?.response ?? null;
  if (typeof response === "string") {
    return parseLooseJson<ApiResponse>(response);
  }
  return response;
}

export async function requestOpenClaw({
  image,
  message,
  model: requestedModel,
  requestUrl,
  translate,
}: {
  image: ImageRecord;
  message?: string;
  model?: string;
  requestUrl: string;
  translate: boolean;
}) {
  const apiKey =
    process.env.MANGA_OPENCLAW_API_KEY || process.env.MANGA_ROUTER_API_KEY;
  const baseUrl = normalizeOpenClawBaseUrl();
  const model = requestedModel || process.env.MANGA_OPENCLAW_MODEL || "openclaw";

  if (!apiKey) {
    throw new Error("AIサービスが設定されていません。");
  }

  const text = translate
    ? TRANSLATE_PROMPT
    : `Hãy trả lời bằng tiếng Việt: ${message?.trim() ?? ""}`;

  const payload = {
    model,
    stream: false,
    ...(translate ? { response_format: { type: "json_object" } } : {}),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text },
          {
            type: "image_url",
            image_url: {
              url:
                image.store_images_locally && image.local_path
                  ? new URL(apiPath(`/api/images/${image.id}`), requestUrl).toString()
                  : image.src,
            },
          },
        ],
      },
    ],
    max_tokens: translate ? 1000 : 100,
    temperature: translate ? 0 : 0.3,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const responseText = await response.text();
  const result = parseLooseJson<OpenClawResponse>(responseText);
  const content =
    result.choices?.[0]?.message?.content ??
    result.choices?.[0]?.text ??
    result.error?.message;

  if (!response.ok || !content) {
    throw new Error(content || "AIサービスから応答がありませんでした。");
  }

  return { content, model };
}

function imageFormatFrom(contentType: string | null, path: string): ImageFormat {
  const normalizedType = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (normalizedType === "image/png") return "png";
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return "jpeg";
  }
  if (normalizedType === "image/gif") return "gif";
  if (normalizedType === "image/webp") return "webp";

  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "png";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".gif") return "gif";
  if (extension === ".webp") return "webp";
  throw new Error("Amazon Bedrock does not support this image format.");
}

async function loadImageForBedrock(image: ImageRecord) {
  if (image.store_images_locally && image.local_path) {
    return {
      bytes: await readFile(image.local_path),
      format: imageFormatFrom(null, image.local_path),
    };
  }

  const imageUrl = new URL(image.src);
  const response = await fetch(imageUrl, {
    cache: "no-store",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: `${imageUrl.origin}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download image for Bedrock (${response.status}).`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    format: imageFormatFrom(response.headers.get("content-type"), imageUrl.pathname),
  };
}

async function requestBedrock({
  image,
  maxTokens,
  message,
  model,
  temperature,
}: {
  image?: ImageRecord;
  maxTokens: number;
  message: string;
  model: string;
  temperature: number;
}) {
  const region = process.env.MANGA_BEDROCK_REGION || process.env.MANGA_AWS_REGION;
  if (!region) {
    throw new Error("Amazon Bedrock region is not configured.");
  }

  const imageContent = image ? await loadImageForBedrock(image) : null;
  const client = new BedrockRuntimeClient({ region });
  const response = await client.send(
    new ConverseCommand({
      modelId: model,
      messages: [
        {
          role: "user",
          content: imageContent
            ? [
                { text: message },
                {
                  image: {
                    format: imageContent.format,
                    source: { bytes: imageContent.bytes },
                  },
                },
              ]
            : [{ text: message }],
        },
      ],
      inferenceConfig: { maxTokens, temperature },
    })
  );
  const content = (response.output?.message?.content ?? [])
    .flatMap((block) => (typeof block.text === "string" ? [block.text] : []))
    .join("\n")
    .trim();
  if (!content) {
    throw new Error("Amazon Bedrock returned an empty response.");
  }

  return { content, model: `bedrock:${model}` };
}

export async function requestOpenClawText({
  maxTokens = 800,
  message,
  model: requestedModel,
  responseFormatJson = false,
  temperature = 0.2,
}: {
  maxTokens?: number;
  message: string;
  model?: string;
  responseFormatJson?: boolean;
  temperature?: number;
}) {
  const apiKey =
    process.env.MANGA_OPENCLAW_API_KEY || process.env.MANGA_ROUTER_API_KEY;
  const baseUrl = normalizeOpenClawBaseUrl();
  const model = requestedModel || process.env.MANGA_OPENCLAW_MODEL || "openclaw";

  if (!apiKey) {
    throw new Error("AIサービスが設定されていません。");
  }

  const payload = {
    model,
    stream: false,
    ...(responseFormatJson ? { response_format: { type: "json_object" } } : {}),
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
    max_tokens: maxTokens,
    temperature,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const responseText = await response.text();
  const result = parseLooseJson<OpenClawResponse>(responseText);
  const content =
    result.choices?.[0]?.message?.content ??
    result.choices?.[0]?.text ??
    result.error?.message;

  if (!response.ok || !content) {
    throw new Error(content || "AIサービスから応答がありませんでした。");
  }

  return { content, model };
}

export async function requestImageAi({
  image,
  message,
  requestUrl,
  selection: requestedSelection,
}: {
  image: ImageRecord;
  message: string;
  requestUrl: string;
  selection?: ImageAiSelection;
}) {
  const selection = requestedSelection ?? resolveImageAiSelection();
  if (selection.provider === "bedrock") {
    return requestBedrock({
      image,
      maxTokens: 300,
      message: `Hãy trả lời bằng tiếng Việt: ${message.trim()}`,
      model: selection.model,
      temperature: 0.3,
    });
  }

  return requestOpenClaw({
    image,
    message,
    model: selection.model,
    requestUrl,
    translate: false,
  });
}

export async function requestTextAi({
  maxTokens = 800,
  message,
  responseFormatJson = false,
  selection: requestedSelection,
  temperature = 0.2,
}: {
  maxTokens?: number;
  message: string;
  responseFormatJson?: boolean;
  selection?: ImageAiSelection;
  temperature?: number;
}) {
  const selection = requestedSelection ?? resolveImageAiSelection();
  if (selection.provider === "bedrock") {
    return requestBedrock({
      maxTokens,
      message,
      model: selection.model,
      temperature,
    });
  }

  return requestOpenClawText({
    maxTokens,
    message,
    model: selection.model,
    responseFormatJson,
    temperature,
  });
}

export async function saveAiResponse({
  action,
  image,
  model,
  prompt,
  response,
}: {
  action: "chat" | "translate";
  image: ImageRecord;
  model: string;
  prompt: string;
  response: ApiResponse;
}) {
  await pool.query(
    `INSERT INTO manga_ai_responses (
       image_id,
       chapter_id,
       manga_title_id,
       action,
       prompt,
       response,
       model
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (image_id, action) WHERE action = 'translate'
     DO UPDATE SET
       chapter_id = EXCLUDED.chapter_id,
       manga_title_id = EXCLUDED.manga_title_id,
       prompt = EXCLUDED.prompt,
       response = EXCLUDED.response,
       model = EXCLUDED.model,
       updated_at = NOW()`,
    [
      image.id,
      image.chapter_id,
      image.manga_title_id,
      action,
      prompt,
      JSON.stringify(response),
      model,
    ]
  );
}

export async function translateImageWithAi({
  image,
  requestUrl,
  selection: requestedSelection,
}: {
  image: ImageRecord;
  requestUrl: string;
  selection?: ImageAiSelection;
}) {
  const selection = requestedSelection ?? resolveImageAiSelection();
  const { content, model } =
    selection.provider === "bedrock"
      ? await requestBedrock({
          image,
          maxTokens: 1000,
          message: TRANSLATE_PROMPT,
          model: selection.model,
          temperature: 0,
        })
      : await requestOpenClaw({
          image,
          model: selection.model,
          requestUrl,
          translate: true,
        });

  let apiResponse: ApiResponse;
  try {
    apiResponse = {
      kind: "translation",
      content: parseLooseJson(content),
    };
  } catch {
    apiResponse = { kind: "chat", content };
  }

  await saveAiResponse({
    action: "translate",
    image,
    model: selection.provider === "bedrock" ? model : getStoredAiModel(selection),
    prompt: TRANSLATE_PROMPT,
    response: apiResponse,
  });

  return apiResponse;
}
