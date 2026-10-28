"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiPath } from "@manga/lib/paths";

export default function ChapterCrawlButton({
  chapterId,
  isDone,
  className,
}: {
  chapterId: string;
  isDone: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!loading) return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(
          apiPath(`/api/chapters/${chapterId}/crawl`),
          {
            cache: "no-store",
          }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Crawl failed");

        if (data.status === "completed") {
          setMessage(`${data.imageCount} ảnh`);
          setLoading(false);
          router.refresh();
        } else if (data.status === "failed") {
          throw new Error(data.error || "Crawl failed");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Crawl failed");
        setLoading(false);
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [chapterId, loading, router]);

  async function crawl() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        apiPath(`/api/chapters/${chapterId}/crawl`),
        {
          method: "POST",
        }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Crawl failed");
      }

      setMessage(data.message || "Crawler started");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Crawl failed");
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <button
        data-done={isDone}
        disabled={loading || isDone}
        onClick={crawl}
        type="button"
      >
        {loading ? "Đang crawl..." : isDone ? "Crawl Done" : "Crawl"}
      </button>
      {message && <small title={message}>{message}</small>}
    </div>
  );
}
