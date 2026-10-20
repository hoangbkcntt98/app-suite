"use client";

import { useMemo, useState } from "react";
import type { GrammarPattern } from "@video/lib/dashboard";
import type { VideoRecord } from "@video/lib/video";
import { findPatternVideo } from "@video/lib/patternVideo";
import PatternVideoButton from "@video/components/PatternVideoButton";
import tableStyles from "@video/app/patterns/page.module.css";
import styles from "./PatternFilters.module.css";

type SortKey = "id" | "pattern" | "status" | "updated" | "scheduled";
type SortDir = "asc" | "desc";

export type RowData = GrammarPattern & {
  scheduledPublishAt?: string | null;
};

function cmpStr(a: string | null | undefined, b: string | null | undefined, dir: SortDir) {
  const av = a ?? "";
  const bv = b ?? "";
  return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
}
function cmpDate(a: string | null | undefined, b: string | null | undefined, dir: SortDir) {
  const nullVal = dir === "asc" ? Infinity : -Infinity;
  const av = a ? Date.parse(a) : nullVal;
  const bv = b ? Date.parse(b) : nullVal;
  return dir === "asc" ? av - bv : bv - av;
}

function applyFilter(
  rows: RowData[],
  patternQ: string,
  statusQ: string,
  updatedFrom: string,
  updatedTo: string,
  scheduledFrom: string,
  scheduledTo: string,
  sortKey: SortKey,
  sortDir: SortDir,
): RowData[] {
  const pq = patternQ.trim().toLowerCase();
  const ufMs = updatedFrom ? Date.parse(updatedFrom) : null;
  const utMs = updatedTo ? Date.parse(updatedTo) + 86399999 : null;
  const sfMs = scheduledFrom ? Date.parse(scheduledFrom) : null;
  const stMs = scheduledTo ? Date.parse(scheduledTo) + 86399999 : null;

  const filtered = rows.filter((row) => {
    if (pq && !row.pattern.toLowerCase().includes(pq)) return false;
    if (statusQ && row.processingStatus !== statusQ) return false;
    if (ufMs !== null || utMs !== null) {
      const ms = row.updatedAt ? Date.parse(row.updatedAt) : null;
      if (ufMs !== null && (ms === null || ms < ufMs)) return false;
      if (utMs !== null && (ms === null || ms > utMs)) return false;
    }
    if (sfMs !== null || stMs !== null) {
      const ms = row.scheduledPublishAt ? Date.parse(row.scheduledPublishAt) : null;
      if (sfMs !== null && (ms === null || ms < sfMs)) return false;
      if (stMs !== null && (ms === null || ms > stMs)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "id":        return sortDir === "asc" ? a.id - b.id : b.id - a.id;
      case "pattern":   return cmpStr(a.pattern, b.pattern, sortDir);
      case "status":    return cmpStr(a.processingStatus, b.processingStatus, sortDir);
      case "updated":   return cmpDate(a.updatedAt, b.updatedAt, sortDir);
      case "scheduled": return cmpDate(a.scheduledPublishAt, b.scheduledPublishAt, sortDir);
      default:          return 0;
    }
  });
}

const DEFAULT_SORT: SortKey = "id";
const DEFAULT_DIR: SortDir = "asc";
const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "id",        label: "ID" },
  { key: "pattern",   label: "Pattern" },
  { key: "status",    label: "Status" },
  { key: "updated",   label: "Updated" },
  { key: "scheduled", label: "Schedule" },
];

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

export default function PatternFilters({
  rows,
  videos,
}: {
  rows: RowData[];
  videos: VideoRecord[];
}) {
  const [patternQ,      setPatternQ]      = useState("");
  const [statusQ,       setStatusQ]       = useState("");
  const [updatedFrom,   setUpdatedFrom]   = useState("");
  const [updatedTo,     setUpdatedTo]     = useState("");
  const [scheduledFrom, setScheduledFrom] = useState("");
  const [scheduledTo,   setScheduledTo]   = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR);

  const presentStatuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.processingStatus))).sort(),
    [rows],
  );

  const filtered = useMemo(
    () => applyFilter(rows, patternQ, statusQ, updatedFrom, updatedTo, scheduledFrom, scheduledTo, sortKey, sortDir),
    [rows, patternQ, statusQ, updatedFrom, updatedTo, scheduledFrom, scheduledTo, sortKey, sortDir],
  );

  const dirty =
    Boolean(patternQ || statusQ || updatedFrom || updatedTo || scheduledFrom || scheduledTo) ||
    sortKey !== DEFAULT_SORT || sortDir !== DEFAULT_DIR;

  function clear() {
    setPatternQ(""); setStatusQ("");
    setUpdatedFrom(""); setUpdatedTo("");
    setScheduledFrom(""); setScheduledTo("");
    setSortKey(DEFAULT_SORT); setSortDir(DEFAULT_DIR);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <>
      <div className={styles.bar} role="search" aria-label="Lọc và sắp xếp patterns">
        <div className={styles.group}>
          <span className={styles.label}>Pattern</span>
          <input
            className={styles.input}
            type="text"
            placeholder="Tìm pattern…"
            value={patternQ}
            onChange={(e) => setPatternQ(e.target.value)}
            aria-label="Tìm theo pattern"
          />
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Status</span>
          <select
            className={styles.select}
            value={statusQ}
            onChange={(e) => setStatusQ(e.target.value)}
            aria-label="Lọc theo status"
          >
            <option value="">— Tất cả —</option>
            {presentStatuses.map((s) => (
              <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
            ))}
          </select>
        </div>

        <div className={styles.sep} aria-hidden="true" />

        <div className={styles.group}>
          <span className={styles.label}>Updated từ</span>
          <input className={styles.input} type="date" value={updatedFrom}
            onChange={(e) => setUpdatedFrom(e.target.value)} aria-label="Updated từ ngày" />
        </div>
        <div className={styles.group}>
          <span className={styles.label}>Updated đến</span>
          <input className={styles.input} type="date" value={updatedTo}
            onChange={(e) => setUpdatedTo(e.target.value)} aria-label="Updated đến ngày" />
        </div>

        <div className={styles.sep} aria-hidden="true" />

        <div className={styles.group}>
          <span className={styles.label}>Schedule từ</span>
          <input className={styles.input} type="date" value={scheduledFrom}
            onChange={(e) => setScheduledFrom(e.target.value)} aria-label="Schedule từ ngày" />
        </div>
        <div className={styles.group}>
          <span className={styles.label}>Schedule đến</span>
          <input className={styles.input} type="date" value={scheduledTo}
            onChange={(e) => setScheduledTo(e.target.value)} aria-label="Schedule đến ngày" />
        </div>

        <div className={styles.sep} aria-hidden="true" />

        <div className={styles.group}>
          <span className={styles.label}>Sắp xếp</span>
          <div className={styles.sortGroup}>
            {SORT_KEYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={styles.sortBtn}
                aria-pressed={sortKey === key}
                onClick={() => toggleSort(key)}
              >
                {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            ))}
          </div>
        </div>

        {dirty ? (
          <button type="button" className={styles.clear} onClick={clear}>
            Xóa bộ lọc
          </button>
        ) : null}

        <span className={styles.count}>
          {filtered.length} / {rows.length}
        </span>
      </div>

      <div className={tableStyles.tableWrap}>
        {filtered.length === 0 ? (
          <table>
            <tbody>
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#8fa4c2", padding: "32px 16px" }}>
                  Không có pattern nào khớp với bộ lọc.
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
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
              {filtered.map((pattern) => {
                const video = findPatternVideo(pattern, videos);
                const facebookVideoId = pattern.facebookVideoId?.trim() || video?.facebookVideoId?.trim();
                const publishedAt = pattern.publishedAt || video?.publishedAt;
                const scheduledPublishAt = pattern.scheduledPublishAt || video?.scheduledPublishAt;
                return (
                  <tr key={pattern.id}>
                    <td>#{pattern.id}</td>
                    <td>{pattern.pattern}</td>
                    <td>
                      <span className={`${tableStyles.status} ${tableStyles[pattern.processingStatus] || ""}`}>
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
                        <small className={tableStyles.facebookMeta}>Không có file video local.</small>
                      )}
                      {facebookVideoId ? (
                        <a
                          className={tableStyles.facebookLink}
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
                        <small className={tableStyles.facebookMeta}>
                          Published: {new Date(publishedAt).toLocaleString("en-US")}
                        </small>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
