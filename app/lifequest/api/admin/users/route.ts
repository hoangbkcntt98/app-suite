import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { requireAdmin } from "@lifequest/lib/admin/auth";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const result = await query(
    `SELECT u.id, u.email, u.role, u."createdAt",
       (SELECT COUNT(*)::int FROM missions m WHERE m."userId" = u.id) AS "_count_missions",
       (SELECT COUNT(*)::int FROM attributes a WHERE a."userId" = u.id) AS "_count_attributes",
       (SELECT COUNT(*)::int FROM push_subscriptions p WHERE p."userId" = u.id) AS "_count_pushSubscriptions"
     FROM users u ORDER BY u."createdAt" DESC`
  );
  const users = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    _count: {
      missions: row._count_missions,
      attributes: row._count_attributes,
      pushSubscriptions: row._count_pushSubscriptions,
    },
  }));

  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const { response } = await requireAdmin();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid user data." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    const result = await query(
      `INSERT INTO users (id, email, "passwordHash", role, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, role, "createdAt"`,
      [randomUUID(), parsed.data.email, passwordHash, parsed.data.role]
    );
    const user = result.rows[0];

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ message: "Email already exists." }, { status: 409 });
    }

    throw error;
  }
}
