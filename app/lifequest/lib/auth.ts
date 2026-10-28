import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

function getJwtSecret() {
  const secret = process.env.LIFEQUEST_JWT_SECRET;
  if (!secret) throw new Error("LIFEQUEST_JWT_SECRET is not defined");
  return secret;
}

export type AuthPayload = {
  userId: string;
  email: string;
};

export function signToken(payload: AuthPayload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): AuthPayload | null {
  const secret = process.env.LIFEQUEST_JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret) as AuthPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUserFromCookie(): Promise<AuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("lifequest_token")?.value;

  if (!token) {
    return null;
  }

  return verifyToken(token);
}
