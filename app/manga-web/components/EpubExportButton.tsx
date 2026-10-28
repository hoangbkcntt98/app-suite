"use client";

import { useEffect, useState } from "react";
import { apiPath } from "@manga/lib/paths";

type ExportStatus = "idle" | "running" | "completed" | "failed";

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

type ExportJob = {
  status?: ExportStatus;
  phase?: string;
  totalCount?: number;
  processedCount?: number;
  currentPageCount?: number;
  currentPageTotal?: number;
  files?: ExportedFile[];
  viewUrl?: string | null;
  downloadUrl?: string | null;
  error?: string | null;
  message?: string;
};

async function readExportResponse(response: Response): Promise<ExportJob> {
  const text = await response.text();
  try {
    return JSON.parse(text) as ExportJob;
  } catch {
    throw new Error(
      response.ok
        ? "EPUB service returned an invalid response"
        : `EPUB service returned HTTP ${response.status}`
    );
  }
}

export default function EpubExportButton({ titleId }: { titleId: string }) {
  const [job, setJob] = useState<ExportJob>({ status: "idle" });
  const [loading, setLoading] = useState(true);
  const endpoint = apiPath(`/api/titles/${titleId}/epub`);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadInitialStatus() {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readExportResponse(response);
        if (!response.ok) {
          throw new Error(data.message || "Could not load EPUB status");
        }
        if (!cancelled) setJob(data);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setJob({
            status: "failed",
            error: error instanceof Error ? error.message : "EPUB export failed",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialStatus();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [endpoint]);

  useEffect(() => {
    if (job.status !== "running") return;
    let cancelled = false;

    async function pollStatus() {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const data = await readExportResponse(response);
        if (!response.ok) {
          throw new Error(data.message || "Could not load EPUB status");
        }
        if (!cancelled) setJob(data);
      } catch (error) {
        if (!cancelled) {
          setJob({
            status: "failed",
            error: error instanceof Error ? error.message : "EPUB export failed",
          });
        }
      }
    }

    const interval = window.setInterval(() => {
      void pollStatus();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [endpoint, job.status]);

  async function startExport() {
    setJob({ status: "running", phase: "building", processedCount: 0 });
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = await readExportResponse(response);
      if (!response.ok) throw new Error(data.message || "EPUB export failed");
      setJob(data);
    } catch (error) {
      setJob({
        status: "failed",
        error: error instanceof Error ? error.message : "EPUB export failed",
      });
    }
  }

  const running = job.status === "running";
  const currentPart = Math.min(
    (job.processedCount ?? 0) + 1,
    job.totalCount ?? 1
  );
  const progress =
    running && job.phase === "validating_drive"
      ? "Checking Drive..."
      : running && job.phase === "uploading"
      ? `Uploading part ${currentPart}/${job.totalCount ?? "?"}`
      : running && job.totalCount
        ? `Part ${currentPart}/${job.totalCount} - ${job.currentPageCount ?? 0}/${job.currentPageTotal ?? "?"} pages`
        : running
          ? "Preparing EPUB..."
          : job.status === "completed"
            ? "Export again"
            : "Export EPUB to Drive";
  const files =
    Array.isArray(job.files) && job.files.length
      ? job.files
      : job.status === "completed" && job.viewUrl
        ? [
            {
              chapterCount: 0,
              downloadUrl: job.downloadUrl || "",
              fileId: "legacy",
              fileName: "EPUB",
              fileSize: null,
              firstChapterName: "",
              lastChapterName: "",
              partNumber: 1,
              viewUrl: job.viewUrl,
            },
          ]
        : [];

  return (
    <div className="epubExport">
      <button disabled={loading || running} onClick={startExport} type="button">
        ↓　{loading ? "Loading..." : progress}
      </button>
      {files.length > 0 ? (
        <div className="epubExportLinks">
          {files.map((file) => (
            <div className="epubExportFile" key={file.fileId}>
              <a href={file.viewUrl} rel="noreferrer" target="_blank">
                Part {file.partNumber}
              </a>
              {file.downloadUrl ? (
                <a href={file.downloadUrl} rel="noreferrer" target="_blank">
                  ↓
                </a>
              ) : null}
              {file.chapterCount > 0 ? (
                <small>{file.chapterCount} chapters</small>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {job.error ? <small>{job.error}</small> : null}
    </div>
  );
}
