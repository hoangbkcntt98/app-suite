import { authConfigured, configuredUsername, createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@video/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Auth chưa được cấu hình. Thiết lập VIDEO_APP_AUTH_USERNAME, VIDEO_APP_AUTH_PASSWORD và VIDEO_APP_AUTH_SECRET." }, { status: 503 });
  }

  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username !== configuredUsername() || password !== process.env.VIDEO_APP_AUTH_PASSWORD) {
      return NextResponse.json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }, { status: 401 });
    }

    const token = await createSessionToken(username);
    const response = NextResponse.json({ ok: true });
    response.cookies.set({ ...sessionCookieOptions, name: SESSION_COOKIE, value: token });
    return response;
  } catch {
    return NextResponse.json({ error: "Dữ liệu đăng nhập không hợp lệ." }, { status: 400 });
  }
}
