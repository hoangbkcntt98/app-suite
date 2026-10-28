import Link from "next/link";
import { pool } from "@manga/lib/db";
import GamesClient from "./GamesClient";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Choice = { label: string; answer: string };

async function gameDeck() {
  const [words, kanji, grammar] = await Promise.all([
    pool.query<Choice>(`SELECT "Word" AS label, COALESCE("MeaningDestination", "Chineses") AS answer
      FROM anki_word WHERE "Word" IS NOT NULL AND COALESCE("MeaningDestination", "Chineses") IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 12`),
    pool.query<Choice>(`SELECT "Kanji" AS label, "MeaningVI" AS answer
      FROM anki_kanji WHERE "Kanji" IS NOT NULL AND "MeaningVI" IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 12`),
    pool.query<Choice>(`SELECT pattern AS label, meaning_vi AS answer
      FROM grammar_patterns WHERE deleted_at IS NULL AND meaning_vi IS NOT NULL
      ORDER BY id LIMIT 12`),
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
