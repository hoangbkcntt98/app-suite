import { stat, readFile } from "node:fs/promises";
import path from "node:path";

const allowedRoots = [
  path.resolve(process.cwd()),
  "/var/web-data",
];

function resolveVideoPath(input: string) {
  const candidate = path.resolve(input.startsWith("/") ? input : path.join(process.cwd(), input));
  return allowedRoots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))
    ? candidate
    : null;
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("path");
  if (!requested) return new Response("Missing video path", { status: 400 });

  const filePath = resolveVideoPath(requested);
  if (!filePath) return new Response("Invalid video path", { status: 403 });
  if (path.extname(filePath).toLowerCase() !== ".mp4") {
    return new Response("Unsupported video format", { status: 415 });
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) return new Response("Video not found", { status: 404 });
    const body = await readFile(filePath);
    return new Response(body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Video not found", { status: 404 });
  }
}
