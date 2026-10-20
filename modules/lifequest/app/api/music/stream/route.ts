import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads", "music");

function getUserMusicDir(userId: string) {
  return path.join(UPLOAD_ROOT, userId);
}

function getSafeTrackId(trackId: string | null) {
  if (!trackId) return null;

  const [ownerId, ...fileNameParts] = trackId.split("/");
  const fileName = fileNameParts.join("/");

  if (
    !ownerId ||
    ownerId !== path.basename(ownerId) ||
    !fileName ||
    fileName !== path.basename(fileName)
  ) {
    return null;
  }

  return {
    ownerId,
    fileName,
  };
}

function getContentType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".aac") return "audio/aac";
  if (ext === ".ac3") return "audio/ac3";
  if (ext === ".aif" || ext === ".aifc" || ext === ".aiff") {
    return "audio/aiff";
  }
  if (ext === ".amr") return "audio/amr";
  if (ext === ".au") return "audio/basic";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".m4a" || ext === ".m4b" || ext === ".mp4") return "audio/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".oga" || ext === ".ogg") return "audio/ogg";
  if (ext === ".opus") return "audio/opus";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".weba" || ext === ".webm") return "audio/webm";
  if (ext === ".wma") return "audio/x-ms-wma";

  return "application/octet-stream";
}

function nodeStreamToWeb(stream: NodeJS.ReadableStream) {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>;
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const trackRef =
      getSafeTrackId(request.nextUrl.searchParams.get("id")) ??
      (() => {
        const fileName = request.nextUrl.searchParams.get("file");

        if (!fileName || fileName !== path.basename(fileName)) return null;

        return {
          ownerId: authUser.userId,
          fileName,
        };
      })();

    if (!trackRef) {
      return NextResponse.json(
        { message: "Invalid track id." },
        { status: 400 }
      );
    }

    const filePath = path.join(
      getUserMusicDir(trackRef.ownerId),
      trackRef.fileName
    );
    const fileInfo = await stat(filePath);
    const range = request.headers.get("range");
    const contentType = getContentType(trackRef.fileName);

    if (!range) {
      const stream = createReadStream(filePath);

      return new Response(nodeStreamToWeb(stream), {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(fileInfo.size),
          "Content-Type": contentType,
        },
      });
    }

    const match = range.match(/bytes=(\d*)-(\d*)/);

    if (!match) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileInfo.size}`,
        },
      });
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2]
      ? Math.min(Number(match[2]), fileInfo.size - 1)
      : fileInfo.size - 1;

    if (start >= fileInfo.size || end >= fileInfo.size || start > end) {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileInfo.size}`,
        },
      });
    }

    const stream = createReadStream(filePath, { start, end });

    return new Response(nodeStreamToWeb(stream), {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileInfo.size}`,
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ message: "Track not found." }, { status: 404 });
    }

    console.error("MUSIC_STREAM_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}
