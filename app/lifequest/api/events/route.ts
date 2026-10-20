import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { parseDateOnlyUTC } from "@lifequest/lib/date";
import { prisma } from "@lifequest/lib/prisma";

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

  const where =
    year && month >= 1 && month <= 12
      ? {
          userId: authUser.userId,
          startDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        }
      : { userId: authUser.userId };

  const events = await prisma.calendarEvent.findMany({
    where,
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
  });

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

  const event = await prisma.calendarEvent.create({
    data: {
      userId: authUser.userId,
      title: parsed.data.title,
      location: parsed.data.location || null,
      content: parsed.data.content || null,
      startDate,
      endDate,
    },
  });

  return NextResponse.json({ event }, { status: 201 });
}
