"use client";

import { appPath } from "@manga/lib/paths";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiPath } from "@manga/lib/paths";

const NO_CHAPTERS_MESSAGE = "No chapters found for full title crawl";
const NO_CHAPTERS_ALERT =
  "チャプターが見つかりませんでした。タイトル一覧は表示できます。";

export default function CrawlButton({
  compact = false,
  showStart = true,
  siteKey,
}: {
  compact?: boolean;
  showStart?: boolean;
  siteKey: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [log, setLog] = useState("");
  const [clearing, setClearing] = useState(false);
  const warningShownRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(
          apiPath(`/api/sites/${encodeURIComponent(siteKey)}`),
          { cache: "no-store" }
        );
        const data = await response.json();

        const noChaptersWarning = data.site?.crawl_error?.includes(
          NO_CHAPTERS_MESSAGE
        );
        if (data.site?.crawl_status === "failed" && noChaptersWarning) {
          if (!warningShownRef.current) {
            window.alert(NO_CHAPTERS_ALERT);
            warningShownRef.current = true;
          }
          return;
        }

        if (response.status === 404) {
          router.replace(appPath("/"));
          router.refresh();
        }
      } catch {
        // A temporary polling failure should not interrupt the title list.
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [router, siteKey]);

  async function startCrawl() {
    setMessage("Starting crawler...");

    const res = await fetch(
      apiPath(`/api/sites/${encodeURIComponent(siteKey)}/crawl`),
      {
        method: "POST",
      }
    );

    const data = await res.json();
    setMessage(data.message || "Done");
  }

  async function loadLog() {
    const res = await fetch(apiPath("/api/crawl"));
    const data = await res.json();
    setLog(data.log || "");
  }

  async function clearCrawledData() {
    const confirmed = window.confirm(
      "すべてのチャプター、画像、翻訳、読書履歴を削除します。タイトル一覧は残ります。続行しますか？"
    );
    if (!confirmed) return;

    setClearing(true);
    setMessage("クロール済みデータを削除しています...");

    try {
      const res = await fetch(apiPath("/api/crawl"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "CLEAR_CRAWLED_DATA" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Could not clear crawled data");
      }

      const deleted = data.deleted;
      setLog("");
      setMessage(
        `${data.message} Chapters: ${deleted.chapters}, Images: ${deleted.images}`
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not clear crawled data"
      );
    } finally {
      setClearing(false);
    }
  }

  return (
    <div style={{ marginBottom: compact ? 0 : 24 }}>
      {showStart ? (
        <button
          onClick={startCrawl}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #333",
            cursor: "pointer",
            marginRight: 8,
          }}
        >
          Crawl now
        </button>
      ) : null}

      <button
        aria-label="Load log"
        onClick={loadLog}
        title="Load log"
        style={{
          width: 40,
          height: 40,
          padding: 0,
          borderRadius: 8,
          border: "1px solid #333",
          cursor: "pointer",
          marginRight: 8,
          display: "inline-grid",
          placeItems: "center",
        }}
      >
        <svg
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            fill: "none",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: 1.8,
          }}
          viewBox="0 0 24 24"
        >
          <path d="M7 4h10" />
          <path d="M7 20h10" />
          <path d="M6 8h12" />
          <path d="M6 12h9" />
          <path d="M6 16h12" />
        </svg>
      </button>

      <button
        aria-label={clearing ? "Clearing crawled data" : "Clear crawled data"}
        disabled={clearing}
        onClick={clearCrawledData}
        title="Clear crawled data"
        style={{
          width: 40,
          height: 40,
          padding: 0,
          borderRadius: 8,
          border: "1px solid rgba(255, 91, 112, 0.55)",
          background: "rgba(128, 25, 42, 0.22)",
          color: "#ff9aaa",
          cursor: clearing ? "wait" : "pointer",
          display: "inline-grid",
          placeItems: "center",
        }}
      >
        <svg
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            fill: "none",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: 1.8,
          }}
          viewBox="0 0 24 24"
        >
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M6 7l1 14h10l1-14" />
          <path d="M9 7V4h6v3" />
        </svg>
      </button>

      {message && <p>{message}</p>}

      {log && (
        <pre
          style={{
            background: "#111",
            color: "#eee",
            padding: 16,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
            maxHeight: 300,
            overflow: "auto",
          }}
        >
          {log}
        </pre>
      )}
    </div>
  );
}
