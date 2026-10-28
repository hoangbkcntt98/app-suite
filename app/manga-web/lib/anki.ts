import { Pool as PostgresPool } from "pg";

export type AnkiFields = {
  Word?: string;
  MeaningDestination?: string;
  Example1_Source?: string;
  Example1_Destination?: string;
};

export function getAnkiConfig() {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "public";
  const table = process.env.MANGA_ANKI_AI_NOTES_TABLE?.trim() || "anki_ai_notes";
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
  if (!identifierPattern.test(schema) || !identifierPattern.test(table)) {
    throw new Error("Anki schema or table name is invalid.");
  }
  const noteType = process.env.MANGA_ANKI_AI_NOTE_TYPE?.trim() || "AIWordWithImage";
  if (!noteType || noteType.length > 255) throw new Error("ANKI_AI_NOTE_TYPE is invalid.");
  const tags = Array.from(new Set((process.env.MANGA_ANKI_AI_TAGS || "api").split(",").map((tag) => tag.trim()).filter(Boolean)));
  return { schema, noteType, table, tags };
}

let _ankiPool: PostgresPool | null = null;

export function getAnkiPool(): PostgresPool {
  if (_ankiPool) return _ankiPool;
  const { schema } = getAnkiConfig();
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  databaseUrl.searchParams.delete("schema");
  _ankiPool = new PostgresPool({
    connectionString: databaseUrl.toString(),
    options: `-c search_path="${schema}"`,
  });
  return _ankiPool;
}
