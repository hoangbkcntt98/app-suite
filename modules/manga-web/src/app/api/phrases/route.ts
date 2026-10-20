import { NextResponse } from "next/server";
import { getCurrentUser } from "@manga/lib/auth";
import { pool } from "@manga/lib/db";
import { parseLooseJson, requestTextAi } from "@manga/lib/aiTranslation";
import { resolveImageAiSelection } from "@manga/lib/aiModels";

type PhraseRequest = {
  action?: "ask";
  context?: string;
  model?: string;
  phrase?: string;
  provider?: string;
};

type PhraseAnalysis = {
  reading: string | null;
  meaning_vi: string;
  kanji: Array<{
    kanji: string;
    meaning_vi: string;
    onyomi?: string | null;
    kunyomi?: string | null;
  }>;
  grammar: string | null;
};

type PhraseCacheRow = {
  response: PhraseAnalysis;
  model: string | null;
};

function normalizeCachedAnalysis(value: unknown): PhraseAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<PhraseAnalysis>;
  if (typeof parsed.meaning_vi !== "string") return null;

  return {
    reading: typeof parsed.reading === "string" ? parsed.reading : null,
    meaning_vi: parsed.meaning_vi,
    kanji: Array.isArray(parsed.kanji) ? parsed.kanji : [],
    grammar: typeof parsed.grammar === "string" ? parsed.grammar : null,
  };
}

function analysisPrompt(phrase: string, context: string) {
  return `Hãy phân tích cụm từ tiếng Nhật sau cho người Việt học tiếng Nhật.
Chỉ trả về JSON hợp lệ, không Markdown, không giải thích ngoài JSON.
Format bắt buộc:
{"reading":"cách đọc bằng hiragana nếu biết, nếu không thì null","meaning_vi":"nghĩa tiếng Việt ngắn gọn","kanji":[{"kanji":"漢字","meaning_vi":"nghĩa tiếng Việt","onyomi":"âm on nếu biết hoặc null","kunyomi":"âm kun nếu biết hoặc null"}],"grammar":"ngữ pháp rất ngắn nếu có, nếu không thì null"}

Cụm từ: ${phrase}
Ngữ cảnh câu gốc: ${context || phrase}`;
}

function parseAnalysis(content: string): PhraseAnalysis {
  try {
    const parsed = parseLooseJson<Partial<PhraseAnalysis>>(content);
    return {
      reading: typeof parsed.reading === "string" ? parsed.reading : null,
      meaning_vi:
        typeof parsed.meaning_vi === "string"
          ? parsed.meaning_vi
          : "Không rõ nghĩa.",
      kanji: Array.isArray(parsed.kanji) ? parsed.kanji : [],
      grammar: typeof parsed.grammar === "string" ? parsed.grammar : null,
    };
  } catch {
    return {
      reading: null,
      meaning_vi: content,
      kanji: [],
      grammar: null,
    };
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "ログインしてください。" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as PhraseRequest;
  const action = body.action;
  const phrase = body.phrase?.trim() ?? "";
  const context = body.context?.trim() ?? "";

  if (action !== "ask" || !phrase || phrase.length > 120) {
    return NextResponse.json(
      { error: "Phrase request is invalid." },
      { status: 400 }
    );
  }

  try {
    const selection = resolveImageAiSelection(body.provider, body.model);

    const contextKey = context || "";
    const cachedResult = await pool.query<PhraseCacheRow>(
      `SELECT response, model
       FROM app_phrase_ai_cache
       WHERE phrase = $1
       ORDER BY (source_context = $2) DESC, updated_at DESC
       LIMIT 1`,
      [phrase, contextKey]
    );
    const cachedAnalysis = normalizeCachedAnalysis(
      cachedResult.rows[0]?.response
    );

    let analysis = cachedAnalysis;
    let model = cachedResult.rows[0]?.model ?? null;
    const cached = Boolean(analysis);

    if (!analysis) {
      const aiResult = await requestTextAi({
        maxTokens: 800,
        message: analysisPrompt(phrase, context),
        responseFormatJson: true,
        selection,
        temperature: 0,
      });
      analysis = parseAnalysis(aiResult.content);
      model = aiResult.model;

      await pool.query(
        `INSERT INTO app_phrase_ai_cache (
           phrase,
           source_context,
           response,
           model
         )
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (phrase, source_context) DO UPDATE SET
           response = EXCLUDED.response,
           model = EXCLUDED.model,
           updated_at = NOW()`,
        [phrase, contextKey, JSON.stringify(analysis), model]
      );
    }

    return NextResponse.json({
      ok: true,
      action,
      phrase,
      analysis,
      cached,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI phrase request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
