import { NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { getSelectedCharacter } from "@lifequest/lib/character/session";

export async function GET() {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json(
        {
          user: null,
        },
        { status: 401 }
      );
    }

    const [userResult, selectedCharacter] = await Promise.all([
      query(
        `SELECT u.id, u.email, u.role, u."createdAt",
          COALESCE(
            json_agg(json_build_object(
              'id', c.id, 'name', c.name, 'className', c."className",
              'level', c.level, 'exp', c.exp, 'gold', c.gold
            )) FILTER (WHERE c.id IS NOT NULL),
            '[]'::json
          ) AS characters
         FROM users u
         LEFT JOIN characters c ON c."userId" = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [authUser.userId]
      ),
      getSelectedCharacter(authUser.userId),
    ]);
    const user = userResult.rows[0] ?? null;

    if (!user) {
      return NextResponse.json(
        {
          user: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        ...user,
        character: selectedCharacter,
      },
    });
  } catch (error) {
    console.error("ME_ERROR", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
