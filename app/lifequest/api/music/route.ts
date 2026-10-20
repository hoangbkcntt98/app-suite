import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import Busboy from "busboy";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookie } from "@lifequest/lib/auth";
import { apiPath } from "@lifequest/lib/paths";
import { prisma } from "@lifequest/lib/prisma";

export const runtime = "nodejs";

const UPLOAD_ROOT = process.env.LIFEQUEST_UPLOAD_ROOT || "/home/opc/lifequest/public/uploads/music";
const MAX_FILE_SIZE = 350 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "audio/aac",
  "audio/ac3",
  "audio/aiff",
  "audio/amr",
  "audio/basic",
  "audio/flac",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/ogg",
  "audio/opus",
  "audio/vnd.wave",
  "audio/wav",
  "audio/webm",
  "audio/x-aac",
  "audio/x-aiff",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-ms-wma",
  "audio/x-wav",
  "audio/x-wma",
]);
const ALLOWED_EXTENSIONS = new Set([
  ".aac",
  ".ac3",
  ".aif",
  ".aifc",
  ".aiff",
  ".amr",
  ".au",
  ".flac",
  ".m4a",
  ".m4b",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".weba",
  ".webm",
  ".wma",
]);

type MusicTrack = {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: string;
  uploadedBy: {
    id: string;
    email: string;
  };
  canManage: boolean;
};

type UploadResult = {
  fileName: string;
};

function sanitizeFileName(name: string) {
  const ext = path.extname(name).toLowerCase();
  const baseName = path
    .basename(name, ext)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${baseName || "track"}-${Date.now()}${ext || ".mp3"}`;
}

function getUserMusicDir(userId: string) {
  return path.join(UPLOAD_ROOT, userId);
}

function getTrackId(userId: string, fileName: string) {
  return `${userId}/${fileName}`;
}

function getTrackUrl(trackId: string) {
  return apiPath(`/api/music/stream?id=${encodeURIComponent(trackId)}`);
}

function getSafeFileName(fileName: string | null) {
  if (!fileName || fileName !== path.basename(fileName)) {
    return null;
  }

  return fileName;
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
    id: getTrackId(ownerId, fileName),
  };
}

function sanitizeRename(name: string, currentFileName: string) {
  const currentExt = path.extname(currentFileName).toLowerCase();
  const requestedExt = path.extname(name).toLowerCase();
  const ext = requestedExt || currentExt || ".mp3";
  const baseName = path
    .basename(name, requestedExt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${baseName || "track"}${ext}`;
}

function isAllowedAudioFile(mimeType: string, fileName: string) {
  if (mimeType.startsWith("audio/")) return true;

  const ext = path.extname(fileName).toLowerCase();

  return ALLOWED_TYPES.has(mimeType) || ALLOWED_EXTENSIONS.has(ext);
}

async function listTracks(currentUserId: string): Promise<MusicTrack[]> {
  try {
    const ownerDirs = (await readdir(UPLOAD_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const users = await prisma.user.findMany({
      where: {
        id: {
          in: ownerDirs,
        },
      },
      select: {
        id: true,
        email: true,
      },
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    const tracksByOwner = await Promise.all(
      ownerDirs.map(async (ownerId) => {
        const userDir = getUserMusicDir(ownerId);
        const entries = await readdir(userDir, { withFileTypes: true });

        return Promise.all(
          entries
            .filter((entry) => entry.isFile())
            .map(async (entry) => {
              const filePath = path.join(userDir, entry.name);
              const info = await stat(filePath);
              const id = getTrackId(ownerId, entry.name);
              const uploader = userById.get(ownerId);

              return {
                id,
                name: entry.name,
                url: getTrackUrl(id),
                size: info.size,
                uploadedAt: info.birthtime.toISOString(),
                uploadedBy: {
                  id: ownerId,
                  email: uploader?.email ?? "Unknown user",
                },
                canManage: ownerId === currentUserId,
              };
            })
        );
      })
    );
    const tracks = tracksByOwner.flat();

    return tracks.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const trackRef =
      getSafeTrackId(request.nextUrl.searchParams.get("id")) ??
      (() => {
        const legacyFileName = getSafeFileName(
          request.nextUrl.searchParams.get("file")
        );

        return legacyFileName
          ? {
              ownerId: authUser.userId,
              fileName: legacyFileName,
              id: getTrackId(authUser.userId, legacyFileName),
            }
          : null;
      })();

    if (!trackRef) {
      return NextResponse.json(
        { message: "Invalid track id." },
        { status: 400 }
      );
    }

    if (trackRef.ownerId !== authUser.userId) {
      return NextResponse.json(
        { message: "Only the uploader can rename this track." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { name?: string }
      | null;
    const nextName = body?.name?.trim();

    if (!nextName) {
      return NextResponse.json(
        { message: "Track name is required." },
        { status: 400 }
      );
    }

    const userDir = getUserMusicDir(trackRef.ownerId);
    const nextFileName = sanitizeRename(nextName, trackRef.fileName);

    if (nextFileName !== trackRef.fileName) {
      const nextFilePath = path.join(userDir, nextFileName);
      const targetExists = await stat(nextFilePath)
        .then(() => true)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
          }

          throw error;
        });

      if (targetExists) {
        return NextResponse.json(
          { message: "A track with that name already exists." },
          { status: 409 }
        );
      }

      await rename(
        path.join(userDir, trackRef.fileName),
        nextFilePath
      );
    }

    const tracks = await listTracks(authUser.userId);
    const nextTrackId = getTrackId(trackRef.ownerId, nextFileName);

    return NextResponse.json({
      track: tracks.find((track) => track.id === nextTrackId),
      tracks,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ message: "Track not found." }, { status: 404 });
    }

    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return NextResponse.json(
        { message: "A track with that name already exists." },
        { status: 409 }
      );
    }

    console.error("MUSIC_RENAME_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}

async function parseStreamingUpload(
  request: NextRequest,
  userId: string
): Promise<UploadResult> {
  if (!request.body) {
    throw new Error("Please upload an audio file.");
  }

  const contentLength = Number(request.headers.get("content-length") || 0);

  if (contentLength > MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD) {
    throw new Error("Audio file must be 350MB or smaller.");
  }

  const userDir = getUserMusicDir(userId);
  await mkdir(userDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(request.headers.entries());
    const busboy = Busboy({
      headers,
      limits: {
        files: 1,
        fileSize: MAX_FILE_SIZE,
      },
    });

    let fileFound = false;
    let savedFileName = "";
    let savedFilePath = "";
    let uploadTask: Promise<void> | null = null;
    let uploadError: Error | null = null;

    function fail(error: Error) {
      uploadError = error;
    }

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file") {
        file.resume();
        return;
      }

      fileFound = true;

      const originalFileName = info.filename || "";
      if (!isAllowedAudioFile(info.mimeType, originalFileName)) {
        fail(new Error("Unsupported audio format."));
        file.resume();
        return;
      }

      savedFileName = sanitizeFileName(originalFileName);
      savedFilePath = path.join(userDir, savedFileName);

      file.on("limit", () => {
        fail(new Error("Audio file must be 350MB or smaller."));
      });

      uploadTask = pipeline(
        file,
        createWriteStream(savedFilePath, {
          flags: "wx",
        })
      ).catch(async (error) => {
        if (savedFilePath) {
          await unlink(savedFilePath).catch(() => undefined);
        }

        throw error;
      });
    });

    busboy.on("error", (error) => {
      reject(error);
    });

    busboy.on("finish", async () => {
      try {
        if (uploadError) {
          if (savedFilePath) {
            await unlink(savedFilePath).catch(() => undefined);
          }

          throw uploadError;
        }

        if (!fileFound || !uploadTask || !savedFileName) {
          throw new Error("Please upload an audio file.");
        }

        await uploadTask;

        resolve({
          fileName: savedFileName,
        });
      } catch (error) {
        reject(error);
      }
    });

    Readable.fromWeb(
      request.body as unknown as NodeReadableStream<Uint8Array>
    ).pipe(busboy);
  });
}

export async function GET() {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const tracks = await listTracks(authUser.userId);

    return NextResponse.json({ tracks });
  } catch (error) {
    console.error("MUSIC_LIST_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const { fileName } = await parseStreamingUpload(request, authUser.userId);
    const tracks = await listTracks(authUser.userId);
    const trackId = getTrackId(authUser.userId, fileName);

    return NextResponse.json({
      track: tracks.find((track) => track.id === trackId),
      tracks,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error.";

    if (
      message === "Please upload an audio file." ||
      message === "Unsupported audio format."
    ) {
      return NextResponse.json({ message }, { status: 400 });
    }

    if (message === "Audio file must be 350MB or smaller.") {
      return NextResponse.json({ message }, { status: 413 });
    }

    console.error("MUSIC_UPLOAD_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authUser = await getCurrentUserFromCookie();

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }

    const trackRef =
      getSafeTrackId(request.nextUrl.searchParams.get("id")) ??
      (() => {
        const legacyFileName = getSafeFileName(
          request.nextUrl.searchParams.get("file")
        );

        return legacyFileName
          ? {
              ownerId: authUser.userId,
              fileName: legacyFileName,
              id: getTrackId(authUser.userId, legacyFileName),
            }
          : null;
      })();

    if (!trackRef) {
      return NextResponse.json(
        { message: "Invalid track id." },
        { status: 400 }
      );
    }

    if (trackRef.ownerId !== authUser.userId) {
      return NextResponse.json(
        { message: "Only the uploader can delete this track." },
        { status: 403 }
      );
    }

    await unlink(path.join(getUserMusicDir(trackRef.ownerId), trackRef.fileName));

    const tracks = await listTracks(authUser.userId);

    return NextResponse.json({ tracks });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ message: "Track not found." }, { status: 404 });
    }

    console.error("MUSIC_DELETE_ERROR", error);

    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}
