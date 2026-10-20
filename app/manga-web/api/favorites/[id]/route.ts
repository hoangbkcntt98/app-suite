import { pool } from "@manga/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ ok: false, message: "Invalid title ID" }, { status: 400 });
  }

  const titleResult = await pool.query(
    "SELECT 1 FROM manga_titles WHERE id = $1",
    [id]
  );
  if (titleResult.rowCount === 0) {
    return Response.json({ ok: false, message: "Title not found" }, { status: 404 });
  }

  const favoriteResult = await pool.query(
    "SELECT 1 FROM manga_favorites WHERE manga_title_id = $1",
    [id]
  );

  if (favoriteResult.rowCount) {
    await pool.query(
      "DELETE FROM manga_favorites WHERE manga_title_id = $1",
      [id]
    );
    return Response.json({ ok: true, favorite: false });
  }

  await pool.query(
    `INSERT INTO manga_favorites (manga_title_id)
     VALUES ($1)
     ON CONFLICT (manga_title_id) DO NOTHING`,
    [id]
  );
  return Response.json({ ok: true, favorite: true });
}
