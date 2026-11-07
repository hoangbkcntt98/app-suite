import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { DEFAULT_ATTRIBUTES } from "@lifequest/lib/default-attributes";
import { CHARACTER_COOKIE, getSelectedCharacter } from "@lifequest/lib/character/session";

const characterClasses = ["KIEM_TU", "DAO_TU", "THE_TU"] as const;
const createCharacterSchema = z.object({
 name: z.string().min(1).max(30),
  className: z.enum(characterClasses).default("KIEM_TU"),
 avatarUrl: z.string().url().optional().nullable(),
});

export async function GET() {
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

    const characters = await query(
      `SELECT * FROM characters WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
      [authUser.userId]
    ).then((result) => result.rows);
    const selectedCharacter = await getSelectedCharacter(authUser.userId);

    const attributes = await query(
      `SELECT * FROM attributes WHERE "characterId" = $1 ORDER BY "createdAt" ASC`,
      [selectedCharacter?.id ?? ""]
    ).then((result) => result.rows);

    return NextResponse.json({
      character: selectedCharacter,
      selectedCharacter,
      characters,
      attributes,
    });
  } catch (error) {
    console.error("GET_CHARACTER_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();

    const parsed = createCharacterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          message: "Invalid character data.",
          errors: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { name, className, avatarUrl } = parsed.data;

    const result = await withTransaction(async (client) => {
      const characterResult = await client.query(
        `INSERT INTO characters (id, "userId", name, "className", "avatarUrl", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
        [randomUUID(), authUser.userId, name, className, avatarUrl ?? null]
      );
      const character = characterResult.rows[0];
      const attributes = [];
      for (const attribute of DEFAULT_ATTRIBUTES) {
        const inserted = await client.query(
          `INSERT INTO attributes (id, "userId", "characterId", name, value, icon, color, multiplier, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 0, $5, $6, $7, NOW(), NOW()) RETURNING *`,
          [
            randomUUID(),
            authUser.userId,
            character.id,
            attribute.name,
            attribute.icon,
            attribute.color,
            attribute.multiplier,
          ]
        );
        attributes.push(inserted.rows[0]);
      }
      return { character, attributes };
    });

    const response = NextResponse.json(
      {
        message: "Character created successfully.",
        character: result.character,
        attributes: result.attributes,
      },
      { status: 201 }
    );
    response.cookies.set(CHARACTER_COOKIE, result.character.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    console.error("CREATE_CHARACTER_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
