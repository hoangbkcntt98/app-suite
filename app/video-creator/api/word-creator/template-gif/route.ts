import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { currentWordCreatorMascotPath, wordCreatorMascotUploadPath } from "@video/lib/wordCreator/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const MAX_GIF_BYTES = 15 * 1024 * 1024;
const MAX_GIF_DIMENSION = 2048;

export async function GET(request: NextRequest) {
  const filePath = await currentWordCreatorMascotPath();
  if (request.nextUrl.searchParams.get("info") === "1") {
    if (!filePath) return NextResponse.json({ available: false });
    const stat = await fs.stat(filePath);
    return NextResponse.json({
      available: true,
      uploaded: filePath === wordCreatorMascotUploadPath(),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!filePath) return NextResponse.json({ error: "Chưa có spinning-bear.gif." }, { status: 404 });
  const bytes = await fs.readFile(filePath);
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  let temporaryPath = "";
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_GIF_BYTES + 1024 * 1024) {
      return NextResponse.json({ error: "GIF không được vượt quá 15 MB." }, { status: 413 });
    }
    const form = await request.formData();
    const entry = form.get("file");
    if (!(entry instanceof File) || entry.size === 0) {
      return NextResponse.json({ error: "Chọn file GIF trước khi upload." }, { status: 400 });
    }
    if (entry.size > MAX_GIF_BYTES) {
      return NextResponse.json({ error: "GIF không được vượt quá 15 MB." }, { status: 413 });
    }
    const bytes = Buffer.from(await entry.arrayBuffer());
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (bytes.length < 10 || (signature !== "GIF87a" && signature !== "GIF89a")) {
      return NextResponse.json({ error: "File phải là GIF hợp lệ." }, { status: 400 });
    }
    const width = bytes.readUInt16LE(6);
    const height = bytes.readUInt16LE(8);
    if (!width || !height || width > MAX_GIF_DIMENSION || height > MAX_GIF_DIMENSION) {
      return NextResponse.json({ error: "Kích thước GIF phải từ 1 đến 2048 px mỗi chiều." }, { status: 400 });
    }

    const targetPath = wordCreatorMascotUploadPath();
    const directory = path.dirname(targetPath);
    await fs.mkdir(directory, { recursive: true });
    temporaryPath = path.join(directory, `.spinning-bear-${Date.now()}-${Math.random().toString(36).slice(2)}.gif`);
    await fs.writeFile(temporaryPath, bytes, { mode: 0o640 });
    const probe = await execFileAsync(process.env.VIDEO_FFPROBE_PATH || "ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
      "-of", "json", temporaryPath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const streams = (JSON.parse(probe.stdout) as { streams?: Array<{ codec_name?: string; width?: number; height?: number }> }).streams;
    const stream = streams?.[0];
    if (stream?.codec_name !== "gif" || !stream.width || !stream.height
      || stream.width > MAX_GIF_DIMENSION || stream.height > MAX_GIF_DIMENSION) {
      throw new Error("ffprobe không nhận được GIF hợp lệ.");
    }
    await fs.rename(temporaryPath, targetPath);
    temporaryPath = "";
    return NextResponse.json({ ok: true, size: bytes.length, updatedAt: new Date().toISOString() }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không upload được spinning-bear.gif." },
      { status: 500 },
    );
  } finally {
    if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}
