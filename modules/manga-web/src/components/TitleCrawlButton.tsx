"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiPath, appPath } from "@manga/lib/paths";

export default function TitleCrawlButton({
  titleId,
  titleHref,
  isDone,
  initialStatus,
  initialChapterCount,
  initialCrawledChapterCount,
  className,
}: {
  titleId: number;
  titleHref: string;
  isDone: boolean;
  initialStatus: string;
  initialChapterCount: number;
  initialCrawledChapterCount: number;
  className?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [chapterCount, setChapterCount] = useState(initialChapterCount);
  const [crawledChapterCount, setCrawledChapterCount] = useState(
    initialCrawledChapterCount
  );
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);

  const refreshProgress = useCallback(async () => {
    const response = await fetch(apiPath(`/api/titles/${titleId}/crawl`), {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Could not load crawl progress");
    }

    setStatus(data.status);
    setChapterCount(data.chapterCount);
    setCrawledChapterCount(data.crawledChapterCount);

    if (data.status === "failed") {
      setMessage(data.error || "Crawl failed");
    } else if (data.status === "no_chapters") {
      setMessage("");
    }

    return data.status as string;
  }, [titleId]);

  useEffect(() => {
    if (status !== "crawling") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshProgress()
        .then((nextStatus) => {
          if (nextStatus === "no_changes" || nextStatus === "no_chapters") {
            window.alert(
              nextStatus === "no_chapters"
                ? "チャプターが見つかりませんでした。"
                : "新しいチャプターはありません。"
            );
          }

          if (nextStatus !== "crawling") {
            router.refresh();
          }
        })
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : "Crawl failed");
        });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [refreshProgress, router, status]);

  async function crawl() {
    setStatus("crawling");
    setMessage("");

    try {
      const response = await fetch(apiPath(`/api/titles/${titleId}/crawl`), {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Crawl failed");
      }

      setChapterCount(data.chapterCount);
      setCrawledChapterCount(data.crawledChapterCount);
      setStatus(data.status);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Crawl failed");
    }
  }

  async function recrawlChapters() {
    setStatus("crawling");
    setMessage("Recrawling chapters...");

    try {
      const response = await fetch(apiPath(`/api/titles/${titleId}/chapters`), {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Chapter crawl failed");
      }

      setStatus(data.status);
    } catch (error) {
      setStatus("failed");
      setMessage(
        error instanceof Error ? error.message : "Chapter crawl failed"
      );
    }
  }

  async function deleteCrawledChapters() {
    const confirmed = window.confirm(
      "このタイトルのクロール済みチャプター、画像、AI翻訳、読書履歴を削除します。続行しますか？"
    );
    if (!confirmed) return;

    setDeleting(true);
    setMessage("Deleting crawled chapters...");

    try {
      const response = await fetch(apiPath(`/api/titles/${titleId}/chapters`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE_TITLE_CHAPTERS" }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Delete failed");
      }

      setStatus("idle");
      setChapterCount(0);
      setCrawledChapterCount(0);
      setMessage(data.message || "Deleted");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const crawling = status === "crawling";
  const busy = crawling || deleting;
  const canDelete = !deleting && chapterCount > 0;
  const done =
    status === "completed" ||
    status === "no_changes" ||
    status === "no_chapters" ||
    (status === "idle" && isDone);
  const progressPercent =
    chapterCount > 0
      ? Math.min(100, Math.round((crawledChapterCount / chapterCount) * 100))
      : 0;

  return (
    <div className={className}>
      <div className="title-action-icons">
        <Link
          aria-label="View title"
          className="title-view-button"
          href={appPath(titleHref)}
          title="View"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
            <circle cx="12" cy="12" r="2.75" />
          </svg>
        </Link>

        <button
          aria-label={done ? "Check for new chapters" : "Crawl title"}
          data-done={done}
          disabled={busy}
          onClick={crawl}
          title={done ? "Check for new chapters" : "Crawl title"}
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
        </button>

        <button
          aria-label="Recrawl chapters"
          disabled={busy}
          onClick={recrawlChapters}
          title="Recrawl chapters"
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5" />
            <path d="M4 17v-5h5" />
            <path d="M18.2 9A7 7 0 0 0 6.8 6.8L4 12" />
            <path d="M5.8 15A7 7 0 0 0 17.2 17.2L20 12" />
          </svg>
        </button>

        <button
          aria-label="Delete crawled chapters"
          data-danger="true"
          disabled={!canDelete}
          onClick={deleteCrawledChapters}
          title="Delete crawled chapters"
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M6 7l1 14h10l1-14" />
            <path d="M9 7V4h6v3" />
          </svg>
        </button>
      </div>

      {crawling && (
        <div
          aria-label={`Crawl progress ${crawledChapterCount} of ${chapterCount}`}
          className="crawl-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={chapterCount}
          aria-valuenow={crawledChapterCount}
        >
          <div className="crawl-progress-track">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="crawl-progress-label">
            {crawledChapterCount}/{chapterCount}
          </span>
        </div>
      )}
      {message && <small title={message}>{message}</small>}
    </div>
  );
}
