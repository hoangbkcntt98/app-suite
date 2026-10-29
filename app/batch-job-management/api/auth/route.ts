import { NextRequest, NextResponse } from "next/server";
import {
  batchJobCookieName,
  batchJobTokenConfigured,
  hasBatchJobAccess,
} from "../../lib/server";
import { timingSafeEqual } from "node:crypto";

function matches(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET() {
  if (!batchJobTokenConfigured()) {
    return NextResponse.json(
      { message: "BATCH_JOB_MANAGEMENT_TOKEN is not configured." },
      { status: 503 },
    );
  }
  return NextResponse.json({ authenticated: await hasBatchJobAccess() });
}

export async function POST(request: NextRequest) {
  const expected = process.env.BATCH_JOB_MANAGEMENT_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { message: "BATCH_JOB_MANAGEMENT_TOKEN is not configured." },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.token !== "string" || !matches(body.token, expected)) {
    return NextResponse.json({ message: "Invalid access token." }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(batchJobCookieName(), expected, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.delete(batchJobCookieName());
  return response;
}
