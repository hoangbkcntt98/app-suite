import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "@lifequest/lib/db";
import { signToken } from "@lifequest/lib/auth";

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const parsed = loginSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    message: "Invalid email or password.",
                },
                { status: 400 }
            );
        }

        const { email, password } = parsed.data;

        const userResult = await query<{
            id: string;
            email: string;
            passwordHash: string;
            role: string;
        }>(`SELECT id, email, "passwordHash", role FROM users WHERE email = $1`, [email]);
        const user = userResult.rows[0];

        if (!user) {
            return NextResponse.json(
                {
                    message: "Invalid email or password.",
                },
                { status: 401 }
            );
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return NextResponse.json(
                {
                    message: "Invalid email or password.",
                },
                { status: 401 }
            );
        }

        const characterResult = await query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM characters WHERE "userId" = $1`,
            [user.id]
        );
        const characterCount = Number(characterResult.rows[0]?.count ?? 0);

        const token = signToken({
            userId: user.id,
            email: user.email,
        });

        const response = NextResponse.json({
            message: "Login successful.",
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                characterCount,
            },
        });

        response.cookies.set("lifequest_token", token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
            path: "/",
            maxAge: 60 * 60 * 24 * 7,
        });
        return response;
    } catch (error) {
        console.error("LOGIN_ERROR", error);

        return NextResponse.json(
            {
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}
