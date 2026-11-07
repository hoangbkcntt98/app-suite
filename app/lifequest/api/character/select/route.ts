import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { CHARACTER_COOKIE } from "@lifequest/lib/character/session";

const selectCharacterSchema = z.object({
  characterId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = selectCharacterSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid character selection." },
      { status: 400 }
    );
  }

  const result = await query(
    `SELECT * FROM characters WHERE id = $1 AND "userId" = $2 LIMIT 1`,
    [parsed.data.characterId, authUser.userId]
  );
  const character = result.rows[0] ?? null;

  if (!character) {
    return NextResponse.json({ message: "Character not found." }, { status: 404 });
  }

  const response = NextResponse.json({
    character,
  });

  response.cookies.set(CHARACTER_COOKIE, character.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
