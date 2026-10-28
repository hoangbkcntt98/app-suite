import { randomBytes, scrypt, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { pool } from "@manga/lib/db";
import { AUTH_COOKIE_NAME } from "@manga/lib/authConstants";

const scryptAsync = promisify(scrypt);

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
};

export type CurrentUser = {
  id: string;
  username: string;
};

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string) {
  return /^[a-z0-9_-]{3,32}$/.test(username);
}

export function validatePassword(password: string) {
  return password.length >= 8 && password.length <= 128;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, salt, storedKey] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !storedKey) return false;

  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  const stored = Buffer.from(storedKey, "hex");
  return stored.length === key.length && timingSafeEqual(stored, key);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  await pool.query(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)`,
    [tokenHash, userId, SESSION_MAX_AGE_SECONDS]
  );

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.MANGA_AUTH_COOKIE_SECURE === "true",
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (token) {
    await pool.query("DELETE FROM app_sessions WHERE token_hash = $1", [
      hashSessionToken(token),
    ]);
  }
  cookieStore.delete(AUTH_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  const result = await pool.query<CurrentUser>(
    `SELECT u.id::text, u.username
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [hashSessionToken(token)]
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export async function createUser(username: string, password: string) {
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO app_users (username, password_hash)
     VALUES ($1, $2)`,
    [username, passwordHash]
  );
  const user = await findUserByUsername(username);
  if (!user) throw new Error("User was created but could not be loaded");
  return { id: user.id, username: user.username };
}

export async function findUserByUsername(username: string) {
  const result = await pool.query<UserRow>(
    `SELECT id::text, username, password_hash
     FROM app_users
     WHERE username = $1
     LIMIT 1`,
    [username]
  );

  return result.rows[0] ?? null;
}
