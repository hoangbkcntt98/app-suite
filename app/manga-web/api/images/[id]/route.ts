import { createReadStream } from "fs";
import { realpath, stat } from "fs/promises";
import { sep } from "path";
import { Readable } from "stream";
import { pool } from "@manga/lib/db";
import { imageStorageRoot, resolveImageStorageRoot } from "@manga/lib/imageStorage";

type ImageRow = {
  local_path: string;
  content_type: string | null;
  local_image_storage_path: string | null;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ message: "Invalid image ID" }, { status: 400 });
  }

  const result = await pool.query<ImageRow>(
    `SELECT
       i.local_path,
       i.content_type,
       s.local_image_storage_path
     FROM chapter_images i
     JOIN manga_chapters c ON c.id = i.chapter_id
     JOIN manga_titles m ON m.id = c.manga_title_id
     JOIN crawler_sites s ON s.site_key = m.site_key
     WHERE i.id = $1 AND i.local_path IS NOT NULL`,
    [id]
  );
  const image = result.rows[0];
  if (!image) {
    return Response.json({ message: "Local image not found" }, { status: 404 });
  }

  try {
    const [defaultRootPath, imagePath] = await Promise.all([
      realpath(imageStorageRoot),
      realpath(image.local_path),
    ]);
    const configuredRootPath = image.local_image_storage_path
      ? await realpath(resolveImageStorageRoot(image.local_image_storage_path)).catch(
          () => null
        )
      : null;
    const allowedRoots = Array.from(
      new Set(
        [defaultRootPath, configuredRootPath].filter(
          (rootPath): rootPath is string => Boolean(rootPath)
        )
      )
    );
    if (!allowedRoots.some((rootPath) => imagePath.startsWith(`${rootPath}${sep}`))) {
      return Response.json({ message: "Invalid image path" }, { status: 403 });
    }

    const file = await stat(imagePath);
    return new Response(
      Readable.toWeb(createReadStream(imagePath)) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
          "Content-Length": String(file.size),
          "Content-Type": image.content_type || "application/octet-stream",
        },
      }
    );
  } catch {
    return Response.json({ message: "Local image file missing" }, { status: 404 });
  }
}
