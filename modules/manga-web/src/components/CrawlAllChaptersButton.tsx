"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiPath } from "@manga/lib/paths";

type CrawlStatus =
  | "idle"
  | "crawling"
  | "completed"
  | "no_changes"
  | "no_chapters"
  | "failed";

export default function CrawlAllChaptersButton({
  className,
  initialCrawledCount,
  initialStatus,
  initialTotalCount,
  titleId,
}: {
  className?: string;
  initialCrawledCount: number;
  initialStatus: string;
  initialTotalCount: number;
  titleId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<CrawlStatus>(
    initialStatus === "crawling" ? "crawling" : "idle"
  );
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [crawledCount, setCrawledCount] = useState(initialCrawledCount);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status !== "crawling") return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(apiPath(`/api/titles/${titleId}/crawl`), {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Could not load crawl progress");
        }

        setTotalCount(data.chapterCount ?? 0);
        setCrawledCount(data.crawledChapterCount ?? 0);
        setStatus(data.status);

        if (data.status === "failed") {
          setMessage(data.error || "Crawl failed");
        }

        if (data.status !== "crawling") {
          router.refresh();
        }
      } catch (error) {
        setStatus("failed");
        setMessage(error instanceof Error ? error.message : "Crawl failed");
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [router, status, titleId]);

  async function crawlAll() {
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

      setTotalCount(data.chapterCount ?? totalCount);
      setCrawledCount(data.crawledChapterCount ?? crawledCount);
      setStatus(data.status);
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Crawl failed");
    }
  }

  const crawling = status === "crawling";
  const done =
    totalCount > 0 &&
    crawledCount >= totalCount &&
    (status === "completed" || status === "no_changes" || status === "idle");

  return (
    <div className={className}>
      <button
        data-done={done}
        disabled={crawling}
        onClick={crawlAll}
        type="button"
      >
        {crawling ? `Crawling ${crawledCount}/${totalCount}` : "Crawl all"}
      </button>
      {message ? <small title={message}>{message}</small> : null}
    </div>
  );
}
