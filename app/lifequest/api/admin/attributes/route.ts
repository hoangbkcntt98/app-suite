import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const createAttributeSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(30),
  value: z.number().int().min(0).default(0),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const result = await query(
    `SELECT a.*,
       json_build_object('id', u.id, 'email', u.email) AS user,
       json_build_object('id', c.id, 'name', c.name) AS character,
       (SELECT COUNT(*)::int FROM missions m WHERE m."attributeId" = a.id) AS "_count_missions"
     FROM attributes a
     JOIN users u ON u.id = a."userId"
     JOIN characters c ON c.id = a."characterId"
     ORDER BY a."createdAt" DESC`
  );
  const attributes = result.rows.map((row) => ({
    ...row,
    _count: { missions: row._count_missions },
  }));

  return NextResponse.json({ attributes });
}

export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = createAttributeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid attribute data." },
      { status: 400 }
    );
  }

  try {
    const characterResult = await query(
      `SELECT id FROM characters WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 1`,
      [parsed.data.userId]
    );
    const character = characterResult.rows[0];

    if (!character) {
      return NextResponse.json(
        { message: "Create a character before adding attributes." },
        { status: 400 }
      );
    }

    const attribute = await query(
      `INSERT INTO attributes (id, "userId", "characterId", name, value, icon, color, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
      [
        randomUUID(),
        parsed.data.userId,
        character.id,
        parsed.data.name,
        parsed.data.value,
        parsed.data.icon ?? null,
        parsed.data.color ?? null,
      ]
    ).then((result) => result.rows[0]);

    return NextResponse.json({ attribute }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { message: "Attribute name already exists for this character." },
        { status: 409 }
      );
    }

    throw error;
  }
}
