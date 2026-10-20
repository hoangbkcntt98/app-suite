import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function GET() {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const count = await prisma.pushSubscription.count({
    where: {
      userId: authUser.userId,
    },
  });

  return NextResponse.json({
    subscribed: count > 0,
    publicKey: process.env.LIFEQUEST_NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
  });
}

export async function POST(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = subscriptionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid push subscription." },
      { status: 400 }
    );
  }

  const subscription = parsed.data;

  await prisma.pushSubscription.upsert({
    where: {
      endpoint: subscription.endpoint,
    },
    create: {
      userId: authUser.userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: {
      userId: authUser.userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  });

  return NextResponse.json({ subscribed: true });
}

export async function DELETE(request: NextRequest) {
  const authUser = await getCurrentUserFromCookie();

  if (!authUser) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { endpoint?: string }
    | null;

  if (!body?.endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: {
        userId: authUser.userId,
      },
    });

    return NextResponse.json({ subscribed: false });
  }

  await prisma.pushSubscription.deleteMany({
    where: {
      userId: authUser.userId,
      endpoint: body.endpoint,
    },
  });

  return NextResponse.json({ subscribed: false });
}
