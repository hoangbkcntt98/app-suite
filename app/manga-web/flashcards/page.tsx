import { appPath } from "@manga/lib/paths";
import { redirect } from "next/navigation";
import SiteHeader from "@manga/components/SiteHeader";
import { getAnkiConfig, getAnkiPool, type AnkiFields } from "@manga/lib/anki";
import { getCurrentUser } from "@manga/lib/auth";

import styles from "./page.module.css";

type AnkiNoteRow = {
  id: string;
  fields_json: AnkiFields | string | null;
  source: string;
  tags_json: string[] | string | null;
};

type PageProps = {
  searchParams: Promise<{
    q?: string | string[];
    tag?: string | string[];
  }>;
};
const NONE_TAG = "None";
export const dynamic = "force-dynamic";

function parseJson<T>(value: T | string | null, fallback: T): T {
  if (typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizeTags(value: AnkiNoteRow["tags_json"]) {
  const tags = parseJson<string[]>(value, [])
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length ? Array.from(new Set(tags)) : [NONE_TAG];
}

export default async function FlashcardsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect(appPath("/login"));
  const { noteType, table } = getAnkiConfig();
  const ankiPool = getAnkiPool();
  const result = await ankiPool.query<AnkiNoteRow>(
    `SELECT anki_note_id::text AS id, source, fields_json, tags_json
     FROM ${table}
     WHERE note_type = $1
     ORDER BY anki_modified_at DESC, anki_note_id DESC`,
    [noteType]
  );
  const notes = result.rows.map((row) => ({
    ...row,
    fields: parseJson<AnkiFields>(row.fields_json, {}),
    tags: normalizeTags(row.tags_json),
  }));
  const tagOptions = Array.from(new Set(notes.flatMap((note) => note.tags))).sort(
    (left, right) => left === NONE_TAG ? 1 : right === NONE_TAG ? -1 : left.localeCompare(right)
  );
  const params = await searchParams;
  const rawTag = params.tag;
  const selectedTag = (Array.isArray(rawTag) ? rawTag[0] : rawTag)?.trim() || "";
  const rawQuery = params.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() || "";
  const normalizedQuery = query.toLocaleLowerCase();
  const filteredNotes = notes.filter((note) => {
    if (selectedTag && !note.tags.includes(selectedTag)) return false;
    if (!normalizedQuery) return true;
    const searchableText = [
      note.fields.Word,
      note.source,
      note.fields.MeaningDestination,
      note.fields.Example1_Source,
      note.fields.Example1_Destination,
    ]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase();
    return searchableText.includes(normalizedQuery);
  });

  return (
    <main className={styles.page}>
      <SiteHeader />
      <div className={styles.container}>
        <div className={styles.heading}>
          <div><h1>Flash Cards</h1><p>{noteType} · {filteredNotes.length} cards</p></div>
          <form className={styles.filter}>
            <label htmlFor="flashcard-search">Search</label>
            <input
              defaultValue={query}
              id="flashcard-search"
              name="q"
              placeholder="Word, meaning, example..."
              type="search"
            />
            <label htmlFor="tag-filter">Tag</label>
            <select defaultValue={selectedTag} id="tag-filter" name="tag">
              <option value="">All</option>
              {tagOptions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <button type="submit">Filter</button>
          </form>
        </div>
        {filteredNotes.length ? (
          <div className={styles.grid}>
            {filteredNotes.map((card) => {
              const word = card.fields.Word?.trim() || card.source;
              return (
                <details className={styles.card} key={card.id}>
                  <summary><span>Front</span><strong>{word}</strong><small>Click để xem Back</small></summary>
                  <div className={styles.back}>
                    <span>Back</span><h2>{word}</h2>
                    <section><b>Meaning</b><p>{card.fields.MeaningDestination || "—"}</p></section>
                    <section>
                      <b>Example 1</b><p>{card.fields.Example1_Source || "—"}</p>
                      {card.fields.Example1_Destination ? <small>{card.fields.Example1_Destination}</small> : null}
                    </section>
                    <div className={styles.tags}>{card.tags.map((tag) => <em key={tag}>{tag}</em>)}</div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : <div className={styles.empty}>Không có flash card phù hợp.</div>}
      </div>
    </main>
  );
}
