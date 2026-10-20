"use client";

import PatternVideoButton from "@video/components/PatternVideoButton";
import type { VideoRecord } from "@video/lib/video";
import { findPatternVideo } from "@video/lib/patternVideo";
import type { RowData } from "@video/components/PatternFilters";
import styles from "@video/app/patterns/page.module.css";

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatSchedule(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function PatternTable({
  rows,
  videos,
}: {
  rows: RowData[];
  videos: VideoRecord[];
}) {
  if (rows.length === 0) {
    return (
      <div className={styles.tableWrap}>
        <table>
          <tbody>
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#8fa4c2", padding: "32px 16px" }}>
                Không có pattern nào khớp với bộ lọc.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Grammar Patterns</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Schedule</th>
            <th>Facebook / Video</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pattern) => {
            const video = findPatternVideo(pattern, videos);
            const facebookVideoId = pattern.facebookVideoId?.trim() || video?.facebookVideoId?.trim();
            const publishedAt = pattern.publishedAt || video?.publishedAt;
            const scheduledPublishAt = pattern.scheduledPublishAt || video?.scheduledPublishAt;
            return (
              <tr key={pattern.id}>
                <td>#{pattern.id}</td>
                <td>{pattern.pattern}</td>
                <td>
                  <span className={`${styles.status} ${styles[pattern.processingStatus] || ""}`}>
                    {formatStatus(pattern.processingStatus)}
                  </span>
                </td>
                <td>{pattern.updatedAt ? new Date(pattern.updatedAt).toLocaleString("en-US") : "—"}</td>
                <td title={scheduledPublishAt ? "Asia/Tokyo" : undefined}>
                  {scheduledPublishAt ? formatSchedule(scheduledPublishAt) : "—"}
                </td>
                <td>
                  {video ? (
                    <PatternVideoButton
                      patternId={pattern.id}
                      patternName={pattern.pattern}
                      initialVideo={video}
                      videoPath={video.relativePath}
                    />
                  ) : (
                    <small className={styles.facebookMeta}>Không có file video local.</small>
                  )}
                  {facebookVideoId ? (
                    <a
                      className={styles.facebookLink}
                      href={`https://www.facebook.com/watch/?v=${encodeURIComponent(facebookVideoId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Xem trên Facebook"
                      title="Xem trên Facebook"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.6 1.7-1.6h1.6V3.8c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4V10H8v3h2.6v8h2.9Z" />
                      </svg>
                    </a>
                  ) : null}
                  {publishedAt ? (
                    <small className={styles.facebookMeta}>
                      Published: {new Date(publishedAt).toLocaleString("en-US")}
                    </small>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
