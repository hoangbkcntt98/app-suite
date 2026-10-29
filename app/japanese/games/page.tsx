import Link from "next/link";
import { pool } from "@manga/lib/db";
import GamesClient from "./GamesClient";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Example = { ja: string | null; vi: string | null; videoPath?: string | null };
type Choice = {
  label: string;
  answer: string;
  kanji?: string | null;
  onYomi?: string | null;
  kunYomi?: string | null;
  reading?: string | null;
  meaningVi?: string | null;
  meaningJa?: string | null;
  videoPath?: string | null;
  examples?: Example[];
  choices?: string[];
};

async function gameDeck() {
  const [words, kanji, grammar] = await Promise.all([
    pool.query<Choice>(`SELECT "Word" AS label, "MeaningSource" AS answer,
        "Reading" AS reading,
        COALESCE("MeaningDestination", "Chineses") AS "meaningVi",
        json_build_array(
          json_build_object('ja', "Example1_Source", 'vi', "Example1_Destination"),
          json_build_object('ja', "Example2_Source", 'vi', "Example2_Destination"),
          json_build_object('ja', "Example3_Source", 'vi', "Example3_Destination")
        ) AS examples
      FROM anki_word
      WHERE NULLIF(BTRIM("Word"), '') IS NOT NULL
        AND NULLIF(BTRIM("MeaningSource"), '') IS NOT NULL
      ORDER BY id`),
    pool.query<Choice>(`SELECT
        r.resource_data->>'requiredVocabulary' AS label,
        r.resource_data->>'correctAnswer' AS answer,
        k."Kanji" AS kanji,
        k."OnYomi" AS "onYomi",
        k."KunYomi" AS "kunYomi",
        k."MeaningVI" AS "meaningVi",
        json_build_array(
          json_build_object('ja', k."Example1_JP", 'vi', k."Example1_VN"),
          json_build_object('ja', k."Example2_JP", 'vi', k."Example2_VN"),
          json_build_object('ja', k."Example3_JP", 'vi', k."Example3_VN"),
          json_build_object('ja', k."Example4_JP", 'vi', k."Example4_VN"),
          json_build_object('ja', k."Example5_JP", 'vi', k."Example5_VN"),
          json_build_object('ja', k."Example6_JP", 'vi', k."Example6_VN")
        ) AS examples,
        ARRAY(
          SELECT choice->>'reading'
          FROM jsonb_array_elements(r.resource_data->'choices') choice
          ORDER BY choice->>'key'
        ) AS choices
      FROM game_resources r
      JOIN anki_kanji k ON k.anki_note_id = r.resource_id
      WHERE r.game_type = 'kanji_rush'
        AND r.resource_table = 'anki_kanji'
        AND r.resource_data IS NOT NULL
      ORDER BY k.id`),
    pool.query<Choice>(`SELECT
        gp.pattern AS label,
        gp.meaning_vi AS answer,
        gp.meaning_vi AS "meaningVi",
        gp.meaning_ja AS "meaningJa",
        gp.video_path AS "videoPath",
        COALESCE((
          SELECT json_agg(json_build_object(
            'ja', e.example_ja,
            'vi', e.example_vi,
            'videoPath', e.video_path
          ) ORDER BY e.display_order)
          FROM grammar_examples e
          WHERE e.pattern_id = gp.id
        ), '[]'::json) AS examples
      FROM grammar_patterns gp
      WHERE gp.deleted_at IS NULL
        AND NULLIF(BTRIM(gp.pattern), '') IS NOT NULL
        AND NULLIF(BTRIM(gp.meaning_vi), '') IS NOT NULL
      ORDER BY gp.id`),
  ]);
  return { words: words.rows, kanji: kanji.rows, grammar: grammar.rows };
}

export default async function GamesPage() {
  let deck: Awaited<ReturnType<typeof gameDeck>> | null = null;
  try { deck = await gameDeck(); } catch { /* show a clear error below */ }
  if (!deck) return <main className={styles.page}><p className={styles.error}>Chưa thể tải bộ câu hỏi. Hãy kiểm tra PostgreSQL.</p></main>;
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/japanese" className={styles.back}>← Japanese Lab</Link>
      <span className={styles.badge}>GAME ROOM · 日本語</span>
    </header>
    <GamesClient deck={deck} />
  </main>;
}
