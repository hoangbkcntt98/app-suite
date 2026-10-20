import { Pool as PostgresPool } from "pg";

export type AnkiFields = {
  Word?: string;
  MeaningDestination?: string;
  Example1_Source?: string;
  Example1_Destination?: string;
};

export function getAnkiConfig() {
  const database = process.env.MANGA_ANKI_AI_DATABASE?.trim() || process.env.MANGA_DB_NAME || "";
  const table = process.env.MANGA_ANKI_AI_NOTES_TABLE?.trim() || "anki_ai_notes";
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!identifierPattern.test(database) || !identifierPattern.test(table)) {
    throw new Error("Anki database or table name is invalid.");
  }
  const noteType = process.env.MANGA_ANKI_AI_NOTE_TYPE?.trim() || "AIWordWithImage";
  if (!noteType || noteType.length > 255) throw new Error("ANKI_AI_NOTE_TYPE is invalid.");
  const tags = Array.from(new Set((process.env.MANGA_ANKI_AI_TAGS || "api").split(",").map((tag) => tag.trim()).filter(Boolean)));
  return { database, noteType, table, tags };
}

let _ankiPool: PostgresPool | null = null;

export function getAnkiPool(): PostgresPool {
  if (_ankiPool) return _ankiPool;
  const { database } = getAnkiConfig();
  _ankiPool = new PostgresPool({
    host: process.env.MANGA_DB_HOST,
    port: Number(process.env.MANGA_DB_PORT || 5432),
    database,
    user: process.env.MANGA_ANKI_AI_DB_USER || process.env.MANGA_DB_USER,
    password: process.env.MANGA_ANKI_AI_DB_PASSWORD || process.env.MANGA_DB_PASSWORD,
  });
  return _ankiPool;
}
