import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@lifequest/lib/prisma";
import { signToken } from "@lifequest/lib/auth";

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const parsed = registerSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    message: "Invalid email or password. Password must be at least 6 characters.",
                },
                { status: 400 }
            );
        }

        const { email, password } = parsed.data;

        const existingUser = await prisma.user.findUnique({
            where: {
                email,
            },
        });

        if (existingUser) {
            return NextResponse.json(
                {
                    message: "Email already exists.",
                },
                { status: 409 }
            );
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
            },
           select: {
               id: true,
               email: true,
               createdAt: true,
           },
       });

        const token = signToken({
            userId: user.id,
            email: user.email,
        });

        const response = NextResponse.json(
            {
                message: "Register successful.",
                user,
            },
            { status: 201 }
        );

        response.cookies.set("lifequest_token", token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.LIFEQUEST_COOKIE_SECURE === "true",
            path: "/lifequest",
            maxAge: 60 * 60 * 24 * 7,
        });

        return response;
    } catch (error) {
        console.error("REGISTER_ERROR", error);

        return NextResponse.json(
            {
                message: "Internal server error.",
            },
            { status: 500 }
        );
    }
}
