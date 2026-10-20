import { rm } from "fs/promises";
import { after } from "next/server";
import { getCurrentUser } from "@manga/lib/auth";
import { pool } from "@manga/lib/db";
import { buildEpubFile, getEpubChapterBatches } from "@manga/lib/epub";
import {
  uploadEpubToGoogleDrive,
  validateGoogleDriveDestination,
} from "@manga/lib/googleDrive";

type JobRow = {
  status: string;
  phase: string;
  total_count: number;
  processed_count: number;
  file_name: string | null;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  drive_web_content_link: string | null;
  file_size: string | null;
  current_page_count: number;
  current_page_total: number;
  exported_files: ExportedFile[];
  error: string | null;
};

type ExportedFile = {
  chapterCount: number;
  downloadUrl: string;
  fileId: string;
  fileName: string;
  fileSize: number | null;
  firstChapterName: string;
  lastChapterName: string;
  partNumber: number;
  viewUrl: string;
};

const runningExports = new Set<string>();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "EPUB export failed";
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return cause?.code ? `${error.message}: ${cause.code}` : error.message;
}

function exportedFiles(job: JobRow | null): ExportedFile[] {
  const value = job?.exported_files;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ExportedFile[]) : [];
  } catch {
    return [];
  }
}

function jobResponse(job: JobRow | null) {
  return Response.json({
    ok: true,
    status: job?.status ?? "idle",
    phase: job?.phase ?? "idle",
    totalCount: job?.total_count ?? 0,
    processedCount: job?.processed_count ?? 0,
    fileName: job?.file_name ?? null,
    driveFileId: job?.drive_file_id ?? null,
    viewUrl: job?.drive_web_view_link ?? null,
    downloadUrl: job?.drive_web_content_link ?? null,
    fileSize: job?.file_size ? Number(job.file_size) : null,
    currentPageCount: job?.current_page_count ?? 0,
    currentPageTotal: job?.current_page_total ?? 0,
    files: exportedFiles(job),
    error: job?.error ?? null,
  });
}

async function getJob(titleId: string) {
  const result = await pool.query<JobRow>(
    `SELECT
       status,
       phase,
       total_count,
       processed_count,
       file_name,
       drive_file_id,
       drive_web_view_link,
       drive_web_content_link,
       file_size::text,
       current_page_count,
       current_page_total,
       exported_files,
       error
     FROM manga_epub_export_jobs
     WHERE manga_title_id = $1`,
    [titleId]
  );
  const job = result.rows[0] ?? null;

  if (job?.status === "running" && !runningExports.has(titleId)) {
    const interrupted = "EPUB export was interrupted. Please start it again.";
    await pool.query(
      `UPDATE manga_epub_export_jobs
       SET status = 'failed',
           phase = 'failed',
           error = $2,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE manga_title_id = $1`,
      [titleId, interrupted]
    );
    return { ...job, status: "failed", phase: "failed", error: interrupted };
  }

  return job;
}

async function runExport(titleId: string) {
  const exportedFiles: ExportedFile[] = [];
  try {
    await pool.query(
      `UPDATE manga_epub_export_jobs
       SET phase = 'validating_drive', updated_at = NOW()
       WHERE manga_title_id = $1`,
      [titleId]
    );
    await validateGoogleDriveDestination();

    const batches = await getEpubChapterBatches(titleId, 100);
    if (!batches.length) {
      throw new Error("No crawled chapter images available");
    }
    await pool.query(
      `UPDATE manga_epub_export_jobs
       SET phase = 'building',
           total_count = $2,
           processed_count = 0,
           current_page_count = 0,
           current_page_total = 0,
           updated_at = NOW()
       WHERE manga_title_id = $1`,
      [titleId, batches.length]
    );

    for (const [index, batch] of batches.entries()) {
      const partNumber = index + 1;
      let directory: string | null = null;
      try {
        const epub = await buildEpubFile(titleId, {
          chapterIds: batch.chapterIds,
          partNumber,
          totalParts: batches.length,
          onProgress: async (processed, total) => {
            await pool.query(
              `UPDATE manga_epub_export_jobs
               SET phase = 'building',
                   current_page_count = $2,
                   current_page_total = $3,
                   updated_at = NOW()
               WHERE manga_title_id = $1`,
              [titleId, processed, total]
            );
          },
        });
        directory = epub.directory;

        await pool.query(
          `UPDATE manga_epub_export_jobs
           SET phase = 'uploading',
               file_name = $2,
               current_page_count = $3,
               current_page_total = $3,
               updated_at = NOW()
           WHERE manga_title_id = $1`,
          [titleId, epub.fileName, epub.pageCount]
        );

        const driveFile = await uploadEpubToGoogleDrive(
          epub.filePath,
          epub.fileName
        );
        exportedFiles.push({
          chapterCount: batch.chapterCount,
          downloadUrl: driveFile.webContentLink,
          fileId: driveFile.id,
          fileName: driveFile.name,
          fileSize: driveFile.size,
          firstChapterName: batch.firstChapterName,
          lastChapterName: batch.lastChapterName,
          partNumber,
          viewUrl: driveFile.webViewLink,
        });

        await pool.query(
          `UPDATE manga_epub_export_jobs
           SET processed_count = $2,
               file_name = $3,
               drive_file_id = $4,
               drive_web_view_link = $5,
               drive_web_content_link = $6,
               file_size = COALESCE(file_size, 0) + COALESCE($7::bigint, 0),
               exported_files = $8::jsonb,
               current_page_count = 0,
               current_page_total = 0,
               error = NULL,
               updated_at = NOW()
           WHERE manga_title_id = $1`,
          [
            titleId,
            partNumber,
            driveFile.name,
            driveFile.id,
            driveFile.webViewLink,
            driveFile.webContentLink,
            driveFile.size,
            JSON.stringify(exportedFiles),
          ]
        );
      } finally {
        if (directory) await rm(directory, { force: true, recursive: true });
      }
    }

    await pool.query(
      `UPDATE manga_epub_export_jobs
       SET status = 'completed',
           phase = 'completed',
           processed_count = total_count,
           current_page_count = 0,
           current_page_total = 0,
           error = NULL,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE manga_title_id = $1`,
      [titleId]
    );
  } catch (error) {
    await pool.query(
      `UPDATE manga_epub_export_jobs
       SET status = 'failed',
           phase = 'failed',
           error = $2,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE manga_title_id = $1`,
      [titleId, errorMessage(error)]
    );
  } finally {
    runningExports.delete(titleId);
  }
}

async function requireUser() {
  return Boolean(await getCurrentUser());
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireUser())) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ ok: false, message: "Invalid title ID" }, { status: 400 });
  }

  return jobResponse(await getJob(id));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireUser())) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ ok: false, message: "Invalid title ID" }, { status: 400 });
  }

  const titleResult = await pool.query(
    `SELECT 1
     FROM manga_titles m
     JOIN crawler_sites s ON s.site_key = m.site_key
     WHERE m.id = $1
       AND EXISTS (
         SELECT 1
         FROM manga_chapters c
         JOIN chapter_images i ON i.chapter_id = c.id
         WHERE c.manga_title_id = m.id
           AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)
       )`,
    [id]
  );
  if (!titleResult.rowCount) {
    return Response.json(
      { ok: false, message: "Title has no crawled chapter images" },
      { status: 409 }
    );
  }

  const current = await getJob(id);
  if (current?.status === "running" && runningExports.has(id)) {
    return jobResponse(current);
  }

  await pool.query(
    `INSERT INTO manga_epub_export_jobs (
       manga_title_id,
       status,
       phase,
       total_count,
       processed_count,
       file_name,
       drive_file_id,
       drive_web_view_link,
       drive_web_content_link,
       file_size,
       current_page_count,
       current_page_total,
       exported_files,
       error,
       started_at,
       finished_at,
       updated_at
     )
     VALUES ($1, 'running', 'building', 0, 0, NULL, NULL, NULL, NULL, NULL, 0, 0, '[]'::jsonb, NULL, NOW(), NULL, NOW())
     ON CONFLICT (manga_title_id) DO UPDATE SET
       status = 'running',
       phase = 'building',
       total_count = 0,
       processed_count = 0,
       file_name = NULL,
       drive_file_id = NULL,
       drive_web_view_link = NULL,
       drive_web_content_link = NULL,
       file_size = NULL,
       current_page_count = 0,
       current_page_total = 0,
       exported_files = '[]'::jsonb,
       error = NULL,
       started_at = NOW(),
       finished_at = NULL,
       updated_at = NOW()`,
    [id]
  );

  runningExports.add(id);
  after(() => runExport(id));
  return jobResponse(await getJob(id));
}
