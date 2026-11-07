import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { parseDateOnlyUTC } from "@lifequest/lib/date";
import { query } from "@lifequest/lib/db";

const updateEventSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  location: z.string().max(160).optional().nullable(),
  content: z.string().max(1000).optional().nullable(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/lifequest/api/events/[id]">
) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = updateEventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid event data." }, { status: 400 });
  }

  const existingResult = await query(
    `SELECT * FROM calendar_events WHERE id = $1 AND "userId" = $2`,
    [id, authUser.userId]
  );
  const existing = existingResult.rows[0];

  if (!existing) {
    return NextResponse.json({ message: "Event not found." }, { status: 404 });
  }

  const startDate = parsed.data.startDate
    ? parseDateOnlyUTC(parsed.data.startDate)
    : existing.startDate;
  const endDate =
    parsed.data.endDate === undefined
      ? existing.endDate
      : parsed.data.endDate
        ? parseDateOnlyUTC(parsed.data.endDate)
        : null;

  if (endDate && endDate < startDate) {
    return NextResponse.json(
      { message: "End date must be after start date." },
      { status: 400 }
    );
  }

  const result = await query(
    `UPDATE calendar_events SET
       title = $3, location = $4, content = $5, "startDate" = $6,
       "endDate" = $7, "updatedAt" = NOW()
     WHERE id = $1 AND "userId" = $2 RETURNING *`,
    [
      id,
      authUser.userId,
      parsed.data.title ?? existing.title,
      parsed.data.location === undefined ? existing.location : parsed.data.location,
      parsed.data.content === undefined ? existing.content : parsed.data.content,
      startDate,
      endDate,
    ]
  );
  const event = result.rows[0];

  return NextResponse.json({ event });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/lifequest/api/events/[id]">
) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await query(
    `DELETE FROM calendar_events WHERE id = $1 AND "userId" = $2`,
    [id, authUser.userId]
  );
  if (!result.rowCount) {
    return NextResponse.json({ message: "Event not found." }, { status: 404 });
  }

  return NextResponse.json({ message: "Event deleted." });
}
