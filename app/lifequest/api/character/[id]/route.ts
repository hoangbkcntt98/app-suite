import { NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import {
  CHARACTER_COOKIE,
  getSelectedCharacter,
} from "@lifequest/lib/character/session";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/lifequest/api/character/[id]">
) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { id } = await context.params;
    const selectedCharacter = await getSelectedCharacter(authUser.userId);

    const characterResult = await query(
      `SELECT id, name FROM characters WHERE id = $1 AND "userId" = $2`,
      [id, authUser.userId]
    );
    const character = characterResult.rows[0];

    if (!character) {
      return NextResponse.json({ message: "Character not found." }, { status: 404 });
    }

    await query(`DELETE FROM characters WHERE id = $1`, [character.id]);

    const shouldChooseNext =
      !selectedCharacter || selectedCharacter.id === character.id;
    const nextCharacter = shouldChooseNext
      ? await query(
          `SELECT * FROM characters WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
          [authUser.userId]
        ).then((result) => result.rows[0] ?? null)
      : selectedCharacter;

    const response = NextResponse.json({
      message: "Character deleted.",
      selectedCharacter: nextCharacter,
    });

    if (nextCharacter) {
      response.cookies.set(CHARACTER_COOKIE, nextCharacter.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    } else {
      response.cookies.set(CHARACTER_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
        path: "/",
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    console.error("DELETE_CHARACTER_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}
