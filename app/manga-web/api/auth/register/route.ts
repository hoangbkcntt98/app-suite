import {
  createSession,
  createUser,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "@manga/lib/auth";

type RegisterBody = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as RegisterBody;
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";

  if (!validateUsername(username)) {
    return Response.json(
      {
        ok: false,
        message:
          "Username must be 3-32 chars and contain only a-z, 0-9, _ or -.",
      },
      { status: 400 }
    );
  }

  if (!validatePassword(password)) {
    return Response.json(
      { ok: false, message: "Password must be 8-128 characters." },
      { status: 400 }
    );
  }

  try {
    const user = await createUser(username, password);
    await createSession(user.id);
    return Response.json({ ok: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (
      code === "23505" ||
      code === "ER_DUP_ENTRY" ||
      message.toLowerCase().includes("duplicate")
    ) {
      return Response.json(
        { ok: false, message: "Username is already registered." },
        { status: 409 }
      );
    }

    console.error("Register failed", error);
    return Response.json(
      { ok: false, message: "Registration failed." },
      { status: 500 }
    );
  }
}
