"use client";

import { useMemo, useState } from "react";
import type { WordCreatorQuestion } from "@video/lib/wordCreator/index";
import filterStyles from "./PatternFilters.module.css";
import tableStyles from "@video/app/patterns/page.module.css";

type SortKey = "id" | "kanji" | "source" | "status" | "updated";
type SortDir = "asc" | "desc";

const DEFAULT_SORT: SortKey = "updated";
const DEFAULT_DIR: SortDir = "desc";

const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "id",      label: "ID" },
  { key: "kanji",   label: "Kanji" },
  { key: "source",  label: "Source" },
  { key: "status",  label: "Status" },
  { key: "updated", label: "Updated" },
];

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
  rows: WordCreatorQuestion[],
  kanjiQ: string,
  sourceQ: string,
  statusQ: string,
  updatedFrom: string,
  updatedTo: string,
  sortKey: SortKey,
  sortDir: SortDir,
): WordCreatorQuestion[] {
  const kq = kanjiQ.trim().toLowerCase();
  const sq = sourceQ.trim().toLowerCase();
  const ufMs = updatedFrom ? Date.parse(updatedFrom) : null;
  const utMs = updatedTo ? Date.parse(updatedTo) + 86399999 : null;

  const filtered = rows.filter((row) => {
    if (kq && !row.required_vocabulary.toLowerCase().includes(kq)) return false;
    if (sq && !row.source.toLowerCase().includes(sq)) return false;
    if (statusQ && (row.status ?? "") !== statusQ) return false;
    if (ufMs !== null || utMs !== null) {
      const ms = row.updated_at ? Date.parse(row.updated_at) : null;
      if (ufMs !== null && (ms === null || ms < ufMs)) return false;
      if (utMs !== null && (ms === null || ms > utMs)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "id":      return sortDir === "asc" ? a.id - b.id : b.id - a.id;
      case "kanji":   return cmpStr(a.required_vocabulary, b.required_vocabulary, sortDir);
      case "source":  return cmpStr(a.source, b.source, sortDir);
      case "status":  return cmpStr(a.status, b.status, sortDir);
      case "updated": return cmpDate(a.updated_at, b.updated_at, sortDir);
      default:        return 0;
    }
  });
}

function statusLabel(status: string | null): string {
  if (!status) return "—";
  return status.replaceAll("_", " ");
}

function statusClass(status: string | null): string {
  if (!status) return "";
  if (status === "video_generated") return tableStyles.video_generated ?? tableStyles.examples_generated ?? "";
  if (status === "publish_facebook_ok") return tableStyles.ok ?? "";
  if (status === "publish_youtube_ok") return tableStyles.ok ?? "";
  if (status === "failed") return tableStyles.error ?? "";
  return "";
}

export default function KanjiList({ questions }: { questions: WordCreatorQuestion[] }) {
  const [kanjiQ,      setKanjiQ]      = useState("");
  const [sourceQ,     setSourceQ]     = useState("");
  const [statusQ,     setStatusQ]     = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo,   setUpdatedTo]   = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR);

  const presentStatuses = useMemo(
    () => Array.from(new Set(questions.map((r) => r.status ?? ""))).sort(),
    [questions],
  );

  const filtered = useMemo(
    () => applyFilter(questions, kanjiQ, sourceQ, statusQ, updatedFrom, updatedTo, sortKey, sortDir),
    [questions, kanjiQ, sourceQ, statusQ, updatedFrom, updatedTo, sortKey, sortDir],
  );

  const dirty =
    Boolean(kanjiQ || sourceQ || statusQ || updatedFrom || updatedTo) ||
    sortKey !== DEFAULT_SORT || sortDir !== DEFAULT_DIR;

  function clear() {
    setKanjiQ(""); setSourceQ(""); setStatusQ("");
    setUpdatedFrom(""); setUpdatedTo("");
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
      <div className={filterStyles.bar} role="search" aria-label="Lọc và sắp xếp kanji">
        <div className={filterStyles.group}>
          <span className={filterStyles.label}>Kanji</span>
          <input
            className={filterStyles.input}
            type="text"
            placeholder="遭, 遭う..."
            value={kanjiQ}
            onChange={(e) => setKanjiQ(e.target.value)}
            aria-label="Tìm theo kanji"
          />
        </div>

        <div className={filterStyles.group}>
          <span className={filterStyles.label}>Source</span>
          <input
            className={filterStyles.input}
            type="text"
            placeholder="Tìm source..."
            value={sourceQ}
            onChange={(e) => setSourceQ(e.target.value)}
            aria-label="Tìm theo source"
          />
        </div>

        <div className={filterStyles.group}>
          <span className={filterStyles.label}>Status</span>
          <select
            className={filterStyles.select}
            value={statusQ}
            onChange={(e) => setStatusQ(e.target.value)}
            aria-label="Lọc theo status"
          >
            <option value="">— Tất cả —</option>
            {presentStatuses.map((s) => (
              <option key={s} value={s}>{s ? s.replaceAll("_", " ") : "(chưa có)"}</option>
            ))}
          </select>
        </div>

        <div className={filterStyles.sep} aria-hidden="true" />

        <div className={filterStyles.group}>
          <span className={filterStyles.label}>Updated từ</span>
          <input className={filterStyles.input} type="date" value={updatedFrom}
            onChange={(e) => setUpdatedFrom(e.target.value)} aria-label="Updated từ ngày" />
        </div>
        <div className={filterStyles.group}>
          <span className={filterStyles.label}>Updated đến</span>
          <input className={filterStyles.input} type="date" value={updatedTo}
            onChange={(e) => setUpdatedTo(e.target.value)} aria-label="Updated đến ngày" />
        </div>

        <div className={filterStyles.sep} aria-hidden="true" />

        <div className={filterStyles.group}>
          <span className={filterStyles.label}>Sắp xếp</span>
          <div className={filterStyles.sortGroup}>
            {SORT_KEYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={filterStyles.sortBtn}
                aria-pressed={sortKey === key}
                onClick={() => toggleSort(key)}
              >
                {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            ))}
          </div>
        </div>

        {dirty ? (
          <button type="button" className={filterStyles.clear} onClick={clear}>
            Xóa bộ lọc
          </button>
        ) : null}

        <span className={filterStyles.count}>
          {filtered.length} / {questions.length}
        </span>
      </div>

      <div className={tableStyles.tableWrap}>
        {filtered.length === 0 ? (
          <table>
            <tbody>
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#8fa4c2", padding: "32px 16px" }}>
                  Không có kanji nào khớp với bộ lọc.
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Kanji / Từ vựng</th>
                <th>Source</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Video</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id}>
                  <td>#{q.id}</td>
                  <td>
                    <strong style={{ fontSize: "18px" }}>{q.required_vocabulary}</strong>
                    {q.last_error ? (
                      <small style={{ display: "block", color: "#ffb7ba", marginTop: "4px", fontSize: "11px" }}>
                        {q.last_error}
                      </small>
                    ) : null}
                  </td>
                  <td style={{ color: "#8fa4c2", fontSize: "12px" }}>{q.source}</td>
                  <td>
                    <span className={`${tableStyles.status} ${statusClass(q.status)}`}>
                      {statusLabel(q.status)}
                    </span>
                  </td>
                  <td style={{ fontSize: "12px", color: "#aebfd6" }}>
                    {q.updated_at ? new Date(q.updated_at).toLocaleString("vi-VN") : "—"}
                  </td>
                  <td>
                    {q.video_path ? (
                      <span style={{ color: "#8cf0c8", fontSize: "12px" }}>✓ Có video</span>
                    ) : (
                      <span style={{ color: "#8fa4c2", fontSize: "12px" }}>Chưa có</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
