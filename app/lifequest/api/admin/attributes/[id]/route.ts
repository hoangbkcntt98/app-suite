import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const updateAttributeSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  value: z.number().int().min(0).optional(),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/attributes/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateAttributeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid attribute data." },
      { status: 400 }
    );
  }

  try {
    const fields = Object.entries(parsed.data);
    const values: unknown[] = [id];
    const assignments = fields.map(([field, value]) => {
      values.push(value);
      return `"${field}" = $${values.length}`;
    });
    const result = await query(
      `UPDATE attributes SET ${assignments.length ? `${assignments.join(", ")}, ` : ""}"updatedAt" = NOW()
       WHERE id = $1 RETURNING *`,
      values
    );
    const attribute = result.rows[0];
    if (!attribute) {
      return NextResponse.json({ message: "Attribute not found." }, { status: 404 });
    }

    return NextResponse.json({ attribute });
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

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/attributes/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;
  const result = await query<{ mission_count: number }>(
    `SELECT COUNT(m.id)::int AS mission_count
     FROM attributes a LEFT JOIN missions m ON m."attributeId" = a.id
     WHERE a.id = $1 GROUP BY a.id`,
    [id]
  );
  const attribute = result.rows[0];

  if (!attribute) {
    return NextResponse.json({ message: "Attribute not found." }, { status: 404 });
  }

  if (attribute.mission_count > 0) {
    return NextResponse.json(
      { message: "Cannot delete attribute because it has missions." },
      { status: 400 }
    );
  }

  await query(`DELETE FROM attributes WHERE id = $1`, [id]);

  return NextResponse.json({ message: "Attribute deleted." });
}
