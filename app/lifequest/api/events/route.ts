import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { parseDateOnlyUTC } from "@lifequest/lib/date";
import { randomUUID } from "node:crypto";
import { query } from "@lifequest/lib/db";

const eventSchema = z.object({
  title: z.string().min(1).max(120),
  location: z.string().max(160).optional().nullable(),
  content: z.string().max(1000).optional().nullable(),
  startDate: z.string().date(),
  endDate: z.string().date().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));

  const monthFilter = year && month >= 1 && month <= 12;
  const events = await query(
    `SELECT * FROM calendar_events
     WHERE "userId" = $1
       AND ($2::boolean = FALSE OR ("startDate" >= $3 AND "startDate" < $4))
     ORDER BY "startDate" ASC, "createdAt" ASC`,
    [
      authUser.userId,
      monthFilter,
      new Date(Date.UTC(year, month - 1, 1)),
      new Date(Date.UTC(year, month, 1)),
    ]
  ).then((result) => result.rows);

  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid event data." }, { status: 400 });
  }

  const startDate = parseDateOnlyUTC(parsed.data.startDate);
  const endDate = parsed.data.endDate ? parseDateOnlyUTC(parsed.data.endDate) : null;

  if (endDate && endDate < startDate) {
    return NextResponse.json(
      { message: "End date must be after start date." },
      { status: 400 }
    );
  }

  const event = await query(
    `INSERT INTO calendar_events (id, "userId", title, location, content, "startDate", "endDate", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
    [
      randomUUID(),
      authUser.userId,
      parsed.data.title,
      parsed.data.location || null,
      parsed.data.content || null,
      startDate,
      endDate,
    ]
  ).then((result) => result.rows[0]);

  return NextResponse.json({ event }, { status: 201 });
}
