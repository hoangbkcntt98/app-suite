import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/users/[id]">
) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid user data." }, { status: 400 });
  }

  const values: unknown[] = [id];
  const assignments: string[] = [];
  if (parsed.data.email) {
    values.push(parsed.data.email);
    assignments.push(`email = $${values.length}`);
  }
  if (parsed.data.role) {
    values.push(parsed.data.role);
    assignments.push(`role = $${values.length}`);
  }
  if (parsed.data.password) {
    values.push(await bcrypt.hash(parsed.data.password, 10));
    assignments.push(`"passwordHash" = $${values.length}`);
  }

  try {
    const result = await query(
      `UPDATE users SET ${assignments.join(", ")}, "updatedAt" = NOW()
       WHERE id = $1 RETURNING id, email, role, "createdAt"`,
      values
    );
    const user = result.rows[0];
    if (!user) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ message: "Email already exists." }, { status: 409 });
    }

    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/admin/users/[id]">
) {
  const { user: adminUser, response } = await requireAdmin();
  if (response) return response;

  const { id } = await context.params;

  if (adminUser?.id === id) {
    return NextResponse.json(
      { message: "You cannot delete your own admin account." },
      { status: 400 }
    );
  }

  const result = await query(`DELETE FROM users WHERE id = $1`, [id]);
  if (!result.rowCount) {
    return NextResponse.json({ message: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ message: "User deleted." });
}
