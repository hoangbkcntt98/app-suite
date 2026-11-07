import { NextResponse } from "next/server";
import { query } from "@lifequest/lib/db";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";

export async function requireAdmin() {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return {
      user: null,
      response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }),
    };
  }

  const result = await query<{ id: string; email: string; role: string }>(
    `SELECT id, email, role FROM users WHERE id = $1 LIMIT 1`,
    [authUser.userId]
  );
  const user = result.rows[0] ?? null;

  if (!user || user.role !== "ADMIN") {
    return {
      user: null,
      response: NextResponse.json({ message: "Admin only." }, { status: 403 }),
    };
  }

  return {
    user,
    response: null,
  };
}
