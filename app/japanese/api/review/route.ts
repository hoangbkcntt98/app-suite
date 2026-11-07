import { NextResponse } from "next/server";
import { pool } from "@manga/lib/db";

const validTypes = new Set(["words", "kanji", "grammar"]);

export async function GET() {
  const { rows } = await pool.query<{ game_type: string; resource_id: string; question: unknown }>(
    `SELECT game_type, resource_id, question FROM japanese_game_review ORDER BY updated_at DESC`,
  );
  return NextResponse.json(rows.map(({ game_type, resource_id, question }) => ({ type: game_type, id: resource_id, question })));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !validTypes.has(body.type) || typeof body.id !== "string" || !body.question) {
    return NextResponse.json({ error: "Dữ liệu ôn tập không hợp lệ." }, { status: 400 });
  }
  await pool.query(
    `INSERT INTO japanese_game_review (game_type, resource_id, question)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (game_type, resource_id) DO UPDATE
     SET question = EXCLUDED.question, wrong_count = japanese_game_review.wrong_count + 1, updated_at = NOW()`,
    [body.type, body.id, JSON.stringify(body.question)],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !validTypes.has(body.type) || typeof body.id !== "string") {
    return NextResponse.json({ error: "Dữ liệu ôn tập không hợp lệ." }, { status: 400 });
  }
  await pool.query(`DELETE FROM japanese_game_review WHERE game_type = $1 AND resource_id = $2`, [body.type, body.id]);
  return NextResponse.json({ ok: true });
}
