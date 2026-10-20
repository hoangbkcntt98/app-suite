import webpush from "web-push";
import { prisma } from "@lifequest/lib/prisma";

export function configureWebPush() {
  const publicKey = process.env.LIFEQUEST_NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.LIFEQUEST_VAPID_PRIVATE_KEY;
  const subject = process.env.LIFEQUEST_VAPID_SUBJECT ?? "mailto:admin@lifequest.local";

  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendPushToSubscriptions(
  subscriptions: {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[],
  payload: {
    title: string;
    body: string;
    url?: string;
  }
) {
  configureWebPush();

  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify({
          ...payload,
          url: payload.url ?? "/dashboard",
        })
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({
          where: {
            id: subscription.id,
          },
        });
      } else {
        console.error("PUSH_SEND_ERROR", error);
      }
    }
  }

  return {
    sent,
    failed,
  };
}
