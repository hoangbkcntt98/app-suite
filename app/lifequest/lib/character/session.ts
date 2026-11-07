import { cookies } from "next/headers";
import { query } from "@lifequest/lib/db";

export const CHARACTER_COOKIE = "lifequest_character_id";

export async function getSelectedCharacter(userId: string) {
  const cookieStore = await cookies();
  const characterId = cookieStore.get(CHARACTER_COOKIE)?.value;

  if (!characterId) return null;

  const result = await query(
    `SELECT * FROM characters WHERE id = $1 AND "userId" = $2 LIMIT 1`,
    [characterId, userId]
  );
  return result.rows[0] ?? null;
}

export async function getUserCharacterCount(userId: string) {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM characters WHERE "userId" = $1`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}
