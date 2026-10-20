import { NextResponse } from "next/server";

export async function POST() {
    const response = NextResponse.json({
        message: "Logout successful.",
    });

    response.cookies.set("lifequest_token", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
        path: "/",
        maxAge: 0,
    });

    return response;
}