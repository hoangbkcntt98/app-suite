import {
  createSession,
  findUserByUsername,
  normalizeUsername,
  verifyPassword,
} from "@manga/lib/auth";

type LoginBody = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginBody;
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";

  const user = await findUserByUsername(username);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !valid) {
    return Response.json(
      { ok: false, message: "Username or password is incorrect." },
      { status: 401 }
    );
  }

  await createSession(user.id);
  return Response.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
    },
  });
}
