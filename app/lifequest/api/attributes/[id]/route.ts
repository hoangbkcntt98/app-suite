import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

const updateAttributeSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  value: z.coerce.number().int().min(0).optional(),
  icon: z.string().max(10).optional().nullable(),
  color: z.string().max(30).optional().nullable(),
});

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json(
        {
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const body = await request.json();

    const parsed = updateAttributeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid attribute data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const existingResult = await query(
      `SELECT * FROM attributes WHERE id = $1 AND "characterId" = $2`,
      [id, character.id]
    );
    const existingAttribute = existingResult.rows[0];

    if (!existingAttribute) {
      return NextResponse.json(
        {
          message: "Attribute not found.",
        },
        { status: 404 }
      );
    }

    const fields = Object.entries(parsed.data);
    const values: unknown[] = [id, character.id];
    const assignments = fields.map(([field, value]) => {
      values.push(value);
      return `"${field}" = $${values.length}`;
    });
    const attribute = await query(
      `UPDATE attributes SET ${assignments.length ? `${assignments.join(", ")}, ` : ""}"updatedAt" = NOW()
       WHERE id = $1 AND "characterId" = $2 RETURNING *`,
      values
    ).then((result) => result.rows[0]);

    return NextResponse.json({
      message: "Attribute updated successfully.",
      attribute,
    });
  } catch (error: unknown) {
    console.error("UPDATE_ATTRIBUTE_ERROR", error);

    if (getErrorCode(error) === "23505") {
      return NextResponse.json(
        {
          message: "Attribute name already exists.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json(
        {
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const character = await getSelectedCharacter(authUser.userId);

    if (!character) {
      return NextResponse.json(
        { message: "Selected character not found." },
        { status: 404 }
      );
    }

    const existingResult = await query<{ mission_count: number }>(
      `SELECT COUNT(m.id)::int AS mission_count
       FROM attributes a LEFT JOIN missions m ON m."attributeId" = a.id
       WHERE a.id = $1 AND a."characterId" = $2
       GROUP BY a.id`,
      [id, character.id]
    );
    const existingAttribute = existingResult.rows[0];

    if (!existingAttribute) {
      return NextResponse.json(
        {
          message: "Attribute not found.",
        },
        { status: 404 }
      );
    }

    if (existingAttribute.mission_count > 0) {
      return NextResponse.json(
        {
          message: "Cannot delete attribute because it has missions.",
        },
        { status: 400 }
      );
    }

    await query(`DELETE FROM attributes WHERE id = $1`, [id]);

    return NextResponse.json({
      message: "Attribute deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE_ATTRIBUTE_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
