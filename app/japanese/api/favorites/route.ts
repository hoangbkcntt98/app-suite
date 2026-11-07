import { NextResponse } from "next/server";
import { pool } from "@manga/lib/db";

const validTypes = new Set(["words", "kanji", "grammar"]);

export async function GET() {
  const { rows } = await pool.query<{ game_type: string; resource_id: string }>(
    `SELECT game_type, resource_id FROM japanese_game_favorites ORDER BY created_at DESC`,
  );
  return NextResponse.json(rows.map(({ game_type, resource_id }) => `${game_type}:${resource_id}`));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !validTypes.has(body.type) || typeof body.id !== "string" || !body.question) {
    return NextResponse.json({ error: "Dữ liệu yêu thích không hợp lệ." }, { status: 400 });
  }
  await pool.query(
    `INSERT INTO japanese_game_favorites (game_type, resource_id, question)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (game_type, resource_id) DO NOTHING`,
    [body.type, body.id, JSON.stringify(body.question)],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !validTypes.has(body.type) || typeof body.id !== "string") {
    return NextResponse.json({ error: "Dữ liệu yêu thích không hợp lệ." }, { status: 400 });
  }
  await pool.query(`DELETE FROM japanese_game_favorites WHERE game_type = $1 AND resource_id = $2`, [body.type, body.id]);
  return NextResponse.json({ ok: true });
}
