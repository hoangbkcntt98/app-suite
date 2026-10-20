import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@video/lib/auth";

const BASE_PATH = "/video-creator";
const PUBLIC_PATHS = new Set([
  `${BASE_PATH}/login`,
  `${BASE_PATH}/api/auth/login`,
  `${BASE_PATH}/api/auth/logout`,
]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  if (pathname.startsWith(`${BASE_PATH}/api/`)) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập để sử dụng chức năng này." },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = `${BASE_PATH}/login`;
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/video-creator", "/video-creator/:path*"],
};
