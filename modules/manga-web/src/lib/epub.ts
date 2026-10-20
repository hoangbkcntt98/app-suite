import type { Archiver, ArchiverOptions } from "archiver";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { pool } from "@manga/lib/db";

const require = createRequire(import.meta.url);
const createArchive = require("archiver") as (
  format: "zip",
  options?: ArchiverOptions
) => Archiver;

type MangaRow = {
  id: string;
  title: string;
};

type PageRow = {
  chapter_id: string;
  chapter_name: string;
  position: number;
  src: string;
  local_path: string | null;
  content_type: string | null;
};

type ChapterRow = {
  id: string;
  name: string;
};

export type EpubChapterBatch = {
  chapterIds: string[];
  chapterCount: number;
  firstChapterName: string;
  lastChapterName: string;
};

type EpubPage = {
  id: string;
  chapterId: string;
  chapterName: string;
  imageFile: string;
  imageMediaType: string;
  pageFile: string;
};

export type EpubBuildResult = {
  directory: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  title: string;
};

type EpubBuildOptions = {
  chapterIds: string[];
  partNumber: number;
  totalParts: number;
  onProgress?: (processed: number, total: number) => Promise<void> | void;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeFileNameBase(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || "manga").slice(0, 120);
}

export function safeEpubFileName(value: string) {
  return `${safeFileNameBase(value)}.epub`;
}

function imageType(contentType: string | null, src: string) {
  const type = contentType?.split(";")[0].trim().toLowerCase();
  if (type === "image/png") return { extension: "png", mediaType: type };
  if (type === "image/gif") return { extension: "gif", mediaType: type };
  if (type === "image/webp") return { extension: "webp", mediaType: type };
  if (type === "image/avif") return { extension: "avif", mediaType: type };

  let pathname = src.toLowerCase();
  try {
    pathname = new URL(src).pathname.toLowerCase();
  } catch {
    // A local or legacy relative source can still be identified by its suffix.
  }
  if (pathname.endsWith(".png")) {
    return { extension: "png", mediaType: "image/png" };
  }
  if (pathname.endsWith(".gif")) {
    return { extension: "gif", mediaType: "image/gif" };
  }
  if (pathname.endsWith(".webp")) {
    return { extension: "webp", mediaType: "image/webp" };
  }

  return { extension: "jpg", mediaType: "image/jpeg" };
}

function pageXhtml(title: string, page: EpubPage) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja">
  <head>
    <title>${escapeXml(title)} - ${escapeXml(page.chapterName)}</title>
    <meta name="viewport" content="width=device-width, height=device-height"/>
    <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
  </head>
  <body><div class="page"><img src="../${page.imageFile}" alt="${escapeXml(page.chapterName)}"/></div></body>
</html>`;
}

function navigationXhtml(title: string, pages: EpubPage[]) {
  const chapters = new Map<string, EpubPage>();
  for (const page of pages) {
    if (!chapters.has(page.chapterId)) chapters.set(page.chapterId, page);
  }
  const items = Array.from(chapters.values())
    .map(
      (page) =>
        `<li><a href="pages/${page.pageFile}">${escapeXml(page.chapterName)}</a></li>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
  <head><title>${escapeXml(title)}</title></head>
  <body><nav epub:type="toc" id="toc"><h1>${escapeXml(title)}</h1><ol>${items}</ol></nav></body>
</html>`;
}

function packageOpf(
  manga: MangaRow,
  pages: EpubPage[],
  displayTitle: string,
  partNumber: number
) {
  const imageManifest = pages
    .map(
      (page) =>
        `<item id="img-${page.id}" href="${page.imageFile}" media-type="${page.imageMediaType}"/>`
    )
    .join("\n    ");
  const pageManifest = pages
    .map(
      (page) =>
        `<item id="page-${page.id}" href="pages/${page.pageFile}" media-type="application/xhtml+xml"/>`
    )
    .join("\n    ");
  const spine = pages
    .map((page) => `<itemref idref="page-${page.id}"/>`)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">manga-rw-${manga.id}-part-${partNumber}</dc:identifier>
    <dc:title>${escapeXml(displayTitle)}</dc:title>
    <dc:language>ja</dc:language>
    <dc:creator>MangaRw</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">none</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    ${imageManifest}
    ${pageManifest}
  </manifest>
  <spine page-progression-direction="rtl">${spine}</spine>
</package>`;
}

async function loadMangaPages(titleId: string, chapterIds: string[]) {
  const [mangaResult, pageResult] = await Promise.all([
    pool.query<MangaRow>("SELECT id, title FROM manga_titles WHERE id = $1", [
      titleId,
    ]),
    pool.query<PageRow>(
      `SELECT
         c.id AS chapter_id,
         c.name AS chapter_name,
         i.position,
         i.src,
         i.local_path,
         i.content_type
       FROM manga_chapters c
       JOIN manga_titles m ON m.id = c.manga_title_id
       JOIN crawler_sites s ON s.site_key = m.site_key
       JOIN chapter_images i ON i.chapter_id = c.id
       WHERE c.manga_title_id = $1
         AND c.id = ANY($2::bigint[])
         AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)
       ORDER BY (c.chapter_number IS NULL) ASC, c.chapter_number ASC, c.id ASC, i.position ASC`,
      [titleId, chapterIds]
    ),
  ]);

  const manga = mangaResult.rows[0];
  if (!manga) throw new Error("Title not found");
  if (pageResult.rows.length === 0) {
    throw new Error("No crawled chapter images available");
  }
  return { manga, pages: pageResult.rows };
}

export async function getEpubChapterBatches(
  titleId: string,
  batchSize = 100
): Promise<EpubChapterBatch[]> {
  const result = await pool.query<ChapterRow>(
    `SELECT c.id, c.name
     FROM manga_chapters c
     JOIN manga_titles m ON m.id = c.manga_title_id
     JOIN crawler_sites s ON s.site_key = m.site_key
     WHERE c.manga_title_id = $1
       AND EXISTS (
         SELECT 1
         FROM chapter_images i
         WHERE i.chapter_id = c.id
           AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)
       )
     ORDER BY (c.chapter_number IS NULL) ASC, c.chapter_number ASC, c.id ASC`,
    [titleId]
  );

  const batches: EpubChapterBatch[] = [];
  for (let index = 0; index < result.rows.length; index += batchSize) {
    const chapters = result.rows.slice(index, index + batchSize);
    if (!chapters.length) continue;
    batches.push({
      chapterIds: chapters.map((chapter) => chapter.id),
      chapterCount: chapters.length,
      firstChapterName: chapters[0].name,
      lastChapterName: chapters[chapters.length - 1].name,
    });
  }
  return batches;
}

export async function buildEpubFile(
  titleId: string,
  options: EpubBuildOptions
): Promise<EpubBuildResult> {
  const { chapterIds, onProgress, partNumber, totalParts } = options;
  const { manga, pages } = await loadMangaPages(titleId, chapterIds);
  const directory = await mkdtemp(path.join(tmpdir(), `manga-epub-${titleId}-`));
  const partLabel =
    totalParts > 1
      ? ` - Part ${String(partNumber).padStart(3, "0")} of ${String(totalParts).padStart(3, "0")}`
      : "";
  const displayTitle = `${manga.title}${partLabel}`;
  const fileName =
    totalParts > 1
      ? `${safeFileNameBase(manga.title).slice(0, 90)}${partLabel}.epub`
      : safeEpubFileName(manga.title);
  const filePath = path.join(directory, fileName);
  const archive = createArchive("zip", { zlib: { level: 6 } });
  const output = createWriteStream(filePath);
  archive.pipe(output);

  const completed = new Promise<void>((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    archive.once("error", reject);
  });

  try {
    archive.append("application/epub+zip", { name: "mimetype", store: true });
    archive.append(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument.org:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
      { name: "META-INF/container.xml" }
    );
    archive.append(
      "html,body{margin:0;padding:0;background:#fff}.page{display:flex;align-items:center;justify-content:center;width:100vw;height:100vh}.page img{display:block;max-width:100%;max-height:100%;object-fit:contain}",
      { name: "OEBPS/styles/book.css" }
    );

    const epubPages: EpubPage[] = [];
    for (const [index, row] of pages.entries()) {
      let imageBuffer: Buffer<ArrayBufferLike>;
      let contentType = row.content_type;
      if (row.local_path) {
        imageBuffer = await readFile(row.local_path);
      } else {
        const response = await fetch(row.src, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          throw new Error(`Could not download image ${row.src}`);
        }
        contentType = response.headers.get("content-type");
        imageBuffer = Buffer.from(await response.arrayBuffer());
      }

      let type = imageType(contentType, row.src);
      if (type.mediaType === "image/webp" || type.mediaType === "image/avif") {
        try {
          imageBuffer = await sharp(imageBuffer, { failOn: "none" })
            .jpeg({ quality: 90, mozjpeg: true })
            .toBuffer();
          type = { extension: "jpg", mediaType: "image/jpeg" };
        } catch {
          await onProgress?.(index + 1, pages.length);
          continue;
        }
      }

      const pageId = String(epubPages.length + 1).padStart(6, "0");
      const page: EpubPage = {
        id: pageId,
        chapterId: row.chapter_id,
        chapterName: row.chapter_name,
        imageFile: `images/page-${pageId}.${type.extension}`,
        imageMediaType: type.mediaType,
        pageFile: `page-${pageId}.xhtml`,
      };
      epubPages.push(page);
      archive.append(imageBuffer, { name: `OEBPS/${page.imageFile}` });
      archive.append(pageXhtml(displayTitle, page), {
        name: `OEBPS/pages/${page.pageFile}`,
      });
      await onProgress?.(index + 1, pages.length);
    }

    archive.append(navigationXhtml(displayTitle, epubPages), {
      name: "OEBPS/nav.xhtml",
    });
    archive.append(packageOpf(manga, epubPages, displayTitle, partNumber), {
      name: "OEBPS/content.opf",
    });
    await archive.finalize();
    await completed;
  } catch (error) {
    archive.abort();
    output.destroy();
    await rm(directory, { force: true, recursive: true });
    throw error;
  }

  return {
    directory,
    fileName,
    filePath,
    pageCount: pages.length,
    title: manga.title,
  };
}
