export async function POST() {
  return Response.json(
    { ok: false, message: "Registration is temporarily disabled." },
    { status: 403 }
  );
}
