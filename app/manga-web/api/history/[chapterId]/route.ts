import { pool } from "@manga/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ chapterId: string }> }
) {
  const { chapterId } = await params;
  if (!/^\d+$/.test(chapterId)) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const chapterResult = await pool.query<{ manga_title_id: string }>(
    "SELECT manga_title_id FROM manga_chapters WHERE id = $1",
    [chapterId]
  );
  const chapter = chapterResult.rows[0];
  if (!chapter) {
    return Response.json({ ok: false }, { status: 404 });
  }

  await pool.query(
    `INSERT INTO reading_history (manga_title_id, chapter_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (manga_title_id) DO UPDATE SET
       chapter_id = EXCLUDED.chapter_id,
       last_read_at = NOW()`,
    [chapter.manga_title_id, chapterId]
  );

  return Response.json({ ok: true });
}
