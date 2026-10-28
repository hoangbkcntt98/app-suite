import Link from "next/link";
import { pool } from "@manga/lib/db";
import JapaneseQuiz from "./JapaneseQuiz";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Grammar = {
  id: number;
  pattern: string;
  meaningVi: string;
  level: string | null;
  usageNote: string | null;
  categories: string[];
  examples: { ja: string; vi: string }[];
};

type Word = { word: string; reading: string | null; meaning: string | null; example: string | null };
type Kanji = { kanji: string; onyomi: string | null; kunyomi: string | null; meaning: string | null };

async function loadJapaneseData() {
  const [counts, grammar, words, kanji] = await Promise.all([
    pool.query<{ grammar: string; words: string; kanji: string; flashcards: string }>(`
      SELECT
        (SELECT count(*) FROM grammar_patterns WHERE deleted_at IS NULL)::text AS grammar,
        (SELECT count(*) FROM anki_word)::text AS words,
        (SELECT count(*) FROM anki_kanji)::text AS kanji,
        (SELECT count(*) FROM app_flashcards)::text AS flashcards`),
    pool.query<Grammar>(`
      SELECT
        gp.id,
        gp.pattern,
        gp.meaning_vi AS "meaningVi",
        gp.level,
        gp.usage_note AS "usageNote",
        COALESCE(array_remove(array_agg(DISTINCT gc.name_vi), NULL), '{}') AS categories,
        COALESCE((
          SELECT json_agg(json_build_object('ja', e.example_ja, 'vi', e.example_vi) ORDER BY e.display_order)
          FROM grammar_examples e WHERE e.pattern_id = gp.id
        ), '[]'::json) AS examples
      FROM grammar_patterns gp
      LEFT JOIN grammar_pattern_categories gpc ON gpc.pattern_id = gp.id
      LEFT JOIN grammar_categories gc ON gc.id = gpc.category_id
      WHERE gp.deleted_at IS NULL
      GROUP BY gp.id
      ORDER BY (gp.id + (CURRENT_DATE - DATE '2026-01-01')) % 411
      LIMIT 1`),
    pool.query<Word>(`
      SELECT "Word" AS word, "Reading" AS reading,
        COALESCE("MeaningDestination", "Chineses") AS meaning,
        "Example1_Destination" AS example
      FROM anki_word
      WHERE "Word" IS NOT NULL AND BTRIM("Word") <> ''
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 6`),
    pool.query<Kanji>(`
      SELECT "Kanji" AS kanji, "OnYomi" AS onyomi, "KunYomi" AS kunyomi, "MeaningVI" AS meaning
      FROM anki_kanji
      WHERE "Kanji" IS NOT NULL AND BTRIM("Kanji") <> ''
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 3`),
  ]);
  return { counts: counts.rows[0], grammar: grammar.rows[0], words: words.rows, kanji: kanji.rows };
}

export default async function JapanesePage() {
  let data: Awaited<ReturnType<typeof loadJapaneseData>> | null = null;
  try { data = await loadJapaneseData(); } catch { /* shown below */ }

  if (!data || !data.grammar) {
    return <main className={styles.page}><p className={styles.error}>Chưa thể đọc dữ liệu học tiếng Nhật. Hãy kiểm tra kết nối PostgreSQL.</p></main>;
  }

  const { counts, grammar, words, kanji } = data;
  const quizChoices = words.slice(0, 4).map((word) => ({ prompt: word.word, answer: word.meaning || "Chưa có nghĩa" }));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>← Northstar</Link>
        <div className={styles.headerActions}>
          <span className={styles.today}>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short" }).format(new Date())}</span>
          <Link href="/japanese/games" className={styles.gameLink}>🎮 Chơi game</Link>
          <span className={styles.badge}>日本語 · DAILY LAB</span>
        </div>
      </header>

      <section className={styles.stats} aria-label="Kho dữ liệu học tập">
        <article><strong>{counts.grammar}</strong><span>MẪU NGỮ PHÁP</span></article>
        <article><strong>{counts.words}</strong><span>TỪ VỰNG</span></article>
        <article><strong>{counts.kanji}</strong><span>KANJI</span></article>
        <article><strong>{counts.flashcards}</strong><span>FLASHCARD TỰ TẠO</span></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.grammarCard}>
          <div className={styles.sectionTop}><span>NGỮ PHÁP HÔM NAY</span><b>{grammar.level || "N1"}</b></div>
          <h2>{grammar.pattern}</h2>
          <p className={styles.meaning}>{grammar.meaningVi}</p>
          {grammar.usageNote ? <p className={styles.note}>{grammar.usageNote}</p> : null}
          <div className={styles.tags}>{grammar.categories.map((category) => <span key={category}>{category}</span>)}</div>
          <div className={styles.examples}>
            {grammar.examples.slice(0, 2).map((example, index) => <div key={`${example.ja}-${index}`}><strong>{example.ja}</strong><small>{example.vi}</small></div>)}
          </div>
        </article>

        <JapaneseQuiz choices={quizChoices} />

        <article className={styles.vocabCard}>
          <div className={styles.sectionTop}><span>TỪ MỚI GẦN ĐÂY</span><Link href="/manga-web/flashcards">Flashcards →</Link></div>
          <div className={styles.wordList}>{words.map((word) => <div key={word.word}><b>{word.word}</b><span>{word.reading}</span><p>{word.meaning}</p>{word.example ? <small>{word.example}</small> : null}</div>)}</div>
        </article>

        <article className={styles.kanjiCard}>
          <div className={styles.sectionTop}><span>KANJI ĐANG ÔN</span><span>漢字</span></div>
          <div className={styles.kanjiList}>{kanji.map((item) => <div key={item.kanji}><strong>{item.kanji}</strong><p>{item.meaning}</p><small>音: {item.onyomi || "—"} · 訓: {item.kunyomi || "—"}</small></div>)}</div>
        </article>
      </section>
    </main>
  );
}
