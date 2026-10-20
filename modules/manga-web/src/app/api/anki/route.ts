import { NextResponse } from "next/server";
import { getCurrentUser } from "@manga/lib/auth";
import { parseLooseJson, requestTextAi } from "@manga/lib/aiTranslation";
import { resolveImageAiSelection } from "@manga/lib/aiModels";
import { getAnkiConfig, getAnkiPool } from "@manga/lib/anki";

type AnkiRequest = {
  context?: string;
  model?: string;
  phrase?: string;
  provider?: string;
};

type Vocabulary = {
  fields: AnkiFields;
  part_of_speech: "noun" | "verb" | "adjective";
  word: string;
};

type AnkiFields = {
  Word: string;
  Image: string;
  Notes: string;
  Usage: string;
  Reading: string;
  Chineses: string;
  ImagePrompt: string;
  sync_status: "OK";
  MeaningSource: string;
  upload_status: "not_yet";
  Example1_Source: string;
  Example2_Source: string;
  Example3_Source: string;
  Example4_Source: string;
  Example5_Source: string;
  Example6_Source: string;
  source_language: "Japanese";
  MeaningDestination: string;
  Example1_Destination: string;
  Example2_Destination: string;
  Example3_Destination: string;
  Example4_Destination: string;
  Example5_Destination: string;
  Example6_Destination: string;
  destination_language: "Vietnamese";
};

type VocabularyAiItem = {
  fields?: Partial<AnkiFields>;
  part_of_speech?: Vocabulary["part_of_speech"];
  word?: string;
};

type VocabularyResponse = {
  words?: VocabularyAiItem[];
};

const ALLOWED_PARTS = new Set<Vocabulary["part_of_speech"]>([
  "noun",
  "verb",
  "adjective",
]);

function vocabularyPrompt(phrase: string, context: string) {
  return `Bạn là giáo viên tiếng Nhật chuyên dạy người Việt. Tách và phân tích từ vựng trong cụm từ tiếng Nhật dưới đây.
Chỉ lấy danh từ, động từ và tính từ. Động từ và tính từ phải ở dạng từ điển; bỏ trợ từ, trợ động từ, phó từ, liên từ, đại từ và ký hiệu.
Chỉ trả về JSON hợp lệ, không Markdown và không giải thích ngoài JSON.
Format bắt buộc:
{"words":[{"word":"音楽","part_of_speech":"noun","fields":{"Word":"音楽","Reading":"おんがく","MeaningSource":"音を楽しむこと。歌や楽器などで表現される芸術。","MeaningDestination":"âm nhạc","Usage":"<div>「音楽」は、音楽全般を指す一般的な言葉です。聴く、演奏する、作るなど、様々な動詞と一緒に使われます。</div>","Example1_Source":"音楽を聞くのが好きです。","Example1_Destination":"Tôi thích nghe nhạc.","Example2_Source":"彼女は音楽の先生です。","Example2_Destination":"Cô ấy là giáo viên âm nhạc.","Example3_Source":"","Example3_Destination":"","Example4_Source":"","Example4_Destination":"","Example5_Source":"","Example5_Destination":"","Example6_Source":"","Example6_Destination":"","ImagePrompt":"A person listening to music with headphones, enjoying the melody.","Notes":"","Chineses":"ÂM NHẠC"}}]}

part_of_speech chỉ được là: noun, verb, adjective.
Mỗi fields phải tuân theo các quy tắc:
- Word là đúng từ dạng từ điển trong word.
- Reading là cách đọc hiragana.
- MeaningSource là giải thích ngắn, dễ hiểu bằng tiếng Nhật.
- MeaningDestination là nghĩa tiếng Việt ngắn gọn, tự nhiên.
- Usage là HTML dạng 1-3 dòng <div>...</div>, bằng tiếng Nhật, mô tả cách dùng, sắc thái hoặc collocation quan trọng.
- Trả từ 1 đến tối đa 6 cặp ExampleN_Source tiếng Nhật và ExampleN_Destination tiếng Việt; thông thường chỉ cần 1-2 cặp. Các field ví dụ còn lại phải là chuỗi rỗng.
- ImagePrompt là một câu tiếng Anh ngắn chỉ mô tả nghĩa phổ biến nhất; không thêm mnemonic, chữ viết hoặc hướng dẫn bố cục.
- Notes là lưu ý ngắn về lỗi dễ nhầm, register hoặc cách dùng; không có thì để trống.
- Chineses là âm Hán Việt tự nhiên, IN HOA nếu từ có Hán tự; nếu không có thì để trống.
- Chỉ dùng các key fields xuất hiện trong JSON mẫu, không thêm key khác.
- Không tự bịa thông tin từ nguyên hoặc pitch accent. Nếu có nhiều nghĩa, ưu tiên nghĩa phổ biến nhất.

Cụm từ được chọn: ${phrase}
Ngữ cảnh: ${context || phrase}`;
}

const AI_FIELD_NAMES = [
  "Reading",
  "MeaningSource",
  "MeaningDestination",
  "Usage",
  "Example1_Source",
  "Example1_Destination",
  "Example2_Source",
  "Example2_Destination",
  "Example3_Source",
  "Example3_Destination",
  "Example4_Source",
  "Example4_Destination",
  "Example5_Source",
  "Example5_Destination",
  "Example6_Source",
  "Example6_Destination",
  "ImagePrompt",
  "Notes",
  "Chineses",
] as const;

function normalizeFields(word: string, value: Partial<AnkiFields> | undefined): AnkiFields {
  const generated = Object.fromEntries(
    AI_FIELD_NAMES.map((name) => [
      name,
      typeof value?.[name] === "string" ? value[name].trim() : "",
    ])
  ) as Pick<AnkiFields, (typeof AI_FIELD_NAMES)[number]>;

  return {
    Word: word,
    Image: "",
    Notes: generated.Notes,
    Usage: generated.Usage,
    Reading: generated.Reading,
    Chineses: generated.Chineses,
    ImagePrompt: generated.ImagePrompt,
    sync_status: "OK",
    MeaningSource: generated.MeaningSource,
    upload_status: "not_yet",
    Example1_Source: generated.Example1_Source,
    Example2_Source: generated.Example2_Source,
    Example3_Source: generated.Example3_Source,
    Example4_Source: generated.Example4_Source,
    Example5_Source: generated.Example5_Source,
    Example6_Source: generated.Example6_Source,
    source_language: "Japanese",
    MeaningDestination: generated.MeaningDestination,
    Example1_Destination: generated.Example1_Destination,
    Example2_Destination: generated.Example2_Destination,
    Example3_Destination: generated.Example3_Destination,
    Example4_Destination: generated.Example4_Destination,
    Example5_Destination: generated.Example5_Destination,
    Example6_Destination: generated.Example6_Destination,
    destination_language: "Vietnamese",
  };
}

function parseVocabulary(content: string) {
  const parsed = parseLooseJson<VocabularyResponse>(content);
  const seen = new Set<string>();
  const words: Vocabulary[] = [];

  for (const item of Array.isArray(parsed.words) ? parsed.words : []) {
    const word = typeof item.word === "string" ? item.word.trim() : "";
    const part = item.part_of_speech;
    if (
      !word ||
      word.length > 120 ||
      !part ||
      !ALLOWED_PARTS.has(part) ||
      seen.has(word)
    ) {
      continue;
    }
    seen.add(word);
    words.push({
      fields: normalizeFields(word, item.fields),
      word,
      part_of_speech: part,
    });
  }

  return words;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AnkiRequest;
  const phrase = body.phrase?.trim() || "";
  const context = body.context?.trim() || "";
  if (!phrase || phrase.length > 500 || context.length > 2000) {
    return NextResponse.json({ error: "Anki request is invalid." }, { status: 400 });
  }

  try {
    const selection = resolveImageAiSelection(body.provider, body.model);
    const aiResult = await requestTextAi({
      maxTokens: 6000,
      message: vocabularyPrompt(phrase, context),
      responseFormatJson: true,
      selection,
      temperature: 0,
    });
    const words = parseVocabulary(aiResult.content);
    if (!words.length) {
      return NextResponse.json(
        { error: "AI không tìm thấy danh từ, động từ hoặc tính từ trong cụm đã chọn." },
        { status: 422 }
      );
    }

    const { noteType, table, tags } = getAnkiConfig();
    const ankiPool = getAnkiPool();
    for (const item of words) {
      await ankiPool.query(
        `INSERT INTO ${table} (
           anki_note_id,
           anki_guid,
           note_type,
           source,
           fields_json,
           tags_json,
           anki_modified_at,
           anki_usn
         ) VALUES (
           (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint + (random() * 999)::int,
           gen_random_uuid()::text,
           $1,
           $2,
           $3::jsonb,
           $4::jsonb,
           EXTRACT(EPOCH FROM NOW())::bigint,
           0
         )`,
        [
          noteType,
          item.word,
          JSON.stringify(item.fields),
          JSON.stringify(tags),
        ]
      );
    }

    return NextResponse.json({
      ok: true,
      count: words.length,
      model: aiResult.model,
      words,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Anki export failed." },
      { status: 502 }
    );
  }
}
