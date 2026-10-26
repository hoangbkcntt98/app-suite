"use client";

import { useEffect, useState } from "react";
import type { WordCreatorJob } from "@video/lib/wordCreator/jobs";
import type { WordCreatorSource } from "@video/lib/wordCreator/index";
import KanjiList from "./KanjiList";
import PipelineScheduleSettings from "./PipelineScheduleSettings";
import WordCreatorMascotUpload from "./WordCreatorMascotUpload";
import styles from "./WordCreator.module.css";

const basePath = process.env.NEXT_PUBLIC_VIDEO_CREATOR_BASE_PATH || "";


async function readJson<T>(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (response.status === 504) {
      throw new Error("Gateway hết thời gian chờ (HTTP 504). Tác vụ đã nhận vẫn chạy nền; không cần tạo lại.");
    }
    throw new Error(`API trả về HTML thay vì JSON (HTTP ${response.status}).`);
  }
}

async function loadQuestions(signal?: AbortSignal) {
  const response = await fetch(`${basePath}/api/word-creator`, { cache: "no-store", signal });
  const body = await readJson<{ job?: WordCreatorJob | null; error?: string }>(response);
  if (!response.ok) throw new Error(body.error || "Không đọc được danh sách.");
  return body;
}

export default function WordCreator() {
  const [durationSeconds, setDurationSeconds] = useState("10");
  const [fps, setFps] = useState("25");
  const [autoFps, setAutoFps] = useState(true);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceOffset, setSourceOffset] = useState(0);
  const [sources, setSources] = useState<WordCreatorSource[]>([]);
  const [hasMoreSources, setHasMoreSources] = useState(false);
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const [sourcesError, setSourcesError] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<WordCreatorJob | null>(null);
  const [error, setError] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const activeJobId = job && (job.status === "queued" || job.status === "running") ? job.id : null;
  const busy = loading || submitting || activeJobId !== null;
  const message = job
    ? job.status === "queued" ? "Đã nhận tác vụ. Đang chờ tạo video..."
      : job.status === "running"
        ? `Đang xử lý ${job.processed}/${job.total} record, đã tạo ${job.generated} video.${job.current_source ? ` Source: ${job.current_source}` : ""}`
        : `Đã tạo ${job.generated}/${job.total} video.${job.error ? ` Lỗi: ${job.error}` : ""}${job.errors.length ? ` Lỗi: ${job.errors.map((item) => `${item.source}: ${item.error}`).join(" | ")}` : ""}`
    : "";

  useEffect(() => {
    const controller = new AbortController();
    void loadQuestions(controller.signal).then((body) => {
      if (controller.signal.aborted) return;
      setJob(body.job || null);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Không đọc được danh sách.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setSourcesLoading(true);
      try {
        const response = await fetch(`${basePath}/api/word-creator?sources=1&q=${encodeURIComponent(sourceSearch)}&offset=${sourceOffset}`,
          { cache: "no-store", signal: controller.signal });
        const body = await readJson<{ sources?: WordCreatorSource[]; hasMore?: boolean; error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "Không đọc được Kanji từ Anki.");
        if (controller.signal.aborted) return;
        setSources(body.sources || []);
        setHasMoreSources(body.hasMore || false);
        setSourcesError("");
      } catch (err) {
        if (!controller.signal.aborted) setSourcesError(err instanceof Error ? err.message : "Không đọc được Kanji.");
      } finally {
        if (!controller.signal.aborted) setSourcesLoading(false);
      }
    };
    const timer = setTimeout(() => void load(), 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sourceSearch, sourceOffset, sourceRefresh]);

  useEffect(() => {
    if (!activeJobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let again = true;
      try {
        const response = await fetch(`${basePath}/api/word-creator?jobId=${encodeURIComponent(activeJobId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const body = await readJson<{ job?: WordCreatorJob; error?: string }>(response);
        if (!response.ok || !body.job) {
          if (response.status === 401 || response.status === 404) again = false;
          throw new Error(body.error || "Không đọc được tiến độ.");
        }
        if (controller.signal.aborted) return;
        setError("");
        const finished = body.job.status === "completed" || body.job.status === "failed";
        if (finished) {
          setSourceRefresh((current) => current + 1);
          again = false;
        }
        setJob(body.job);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Không đọc được tiến độ.");
      } finally {
        // Network/proxy errors retry polling, never resubmit the render request.
        if (again && !controller.signal.aborted) timer = setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [activeJobId]);

  async function generate() {
    if (selectedSources.length === 0) {
      setError("Chọn ít nhất một Kanji trong danh sách.");
      return;
    }
    const frameRate = Number(fps);
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 60) {
      setError("FPS phải là số nguyên từ 1 đến 60.");
      return;
    }
    setSubmitting(true); setError("");
    try {
      const response = await fetch(`${basePath}/api/word-creator`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: selectedSources, durationSeconds: Number(durationSeconds), fps: frameRate, autoFps }),
      });
      const body = await readJson<{ job?: WordCreatorJob; error?: string }>(response);
      if (!response.ok || !body.job) throw new Error(body.error || "Không tạo được WordCreator.");
      setJob(body.job);
      setSelectedSources([]);
    } catch (err) { setError(err instanceof Error ? err.message : "Không tạo được WordCreator."); }
    finally { setSubmitting(false); }
  }

  function toggleSource(source: string) {
    if (selectedSources.includes(source)) {
      setSelectedSources(selectedSources.filter((item) => item !== source));
      setError("");
      return;
    }
    if (selectedSources.length >= 100) {
      setError("Chọn tối đa 100 Kanji cho mỗi lần tạo.");
      return;
    }
    setSelectedSources([...selectedSources, source]);
    setError("");
  }

  function toggleCurrentPage() {
    const pageSources = sources.map((item) => item.source);
    const allSelected = pageSources.length > 0 && pageSources.every((item) => selectedSources.includes(item));
    if (allSelected) {
      setSelectedSources((current) => current.filter((item) => !pageSources.includes(item)));
      setError("");
      return;
    }
    const missing = pageSources.filter((item) => !selectedSources.includes(item));
    if (selectedSources.length + missing.length > 100) {
      setError("Chọn tối đa 100 Kanji cho mỗi lần tạo.");
      return;
    }
    setSelectedSources((current) => [...current, ...missing]);
    setError("");
  }

  return <div className={styles.layout}>
    <section className={styles.panel}>
      <WordCreatorMascotUpload />
      <div className={styles.fields}>
        <label>Tìm Kanji / từ vựng<input value={sourceSearch} onChange={(event) => { setSourceSearch(event.target.value); setSourceOffset(0); }} placeholder="遭, 遭う..." disabled={busy} /></label>
        <label>Thời lượng video (giây)<input type="number" min="1" max="300" step="1" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} disabled={busy} /></label>
        <label>FPS<input type="number" min="1" max="60" step="1" value={fps} onChange={(event) => setFps(event.target.value)} disabled={busy} /></label>
        <label>Tự động khớp FPS theo GIF<input type="checkbox" checked={autoFps} onChange={(event) => setAutoFps(event.target.checked)} disabled={busy} /></label>
        <button type="button" className="primary" onClick={() => void generate()} disabled={busy || selectedSources.length === 0}>
          {busy ? "Đang tạo..." : `Force Create (${selectedSources.length})`}
        </button>
      </div>
      <div className={styles.sourcePages}>
        <button type="button" disabled={busy || sourcesLoading || sourceOffset === 0} onClick={() => setSourceOffset(Math.max(0, sourceOffset - 100))}>Kanji trước</button>
        <span>{sourcesLoading ? "Đang tải Kanji..." : `Trang ${sourceOffset / 100 + 1} · ${sources.length} Kanji · Đã chọn ${selectedSources.length}/100`}</span>
        <button type="button" disabled={busy || sourcesLoading || !hasMoreSources} onClick={() => setSourceOffset(sourceOffset + 100)}>Kanji tiếp</button>
      </div>
      {sourcesError ? <p className={styles.error}>{sourcesError}</p> : null}
      <p className={styles.hint}>FPS mặc định 25. Bật tự động: chọn FPS khớp thời lượng frame GIF (tối đa 60); không có GIF giữ FPS đã nhập. Tắt để dùng FPS cố định. Card và log hiển thị FPS thực tế.</p>
      <p className={styles.hint}>Nguồn: public.anki_kanji. File lưu trong WORD_CREATOR_OUTPUT_DIR hoặc DATA_DIR/word-creator.</p>
      {activeJobId ? <p className={styles.hint}>Video chạy nền. Có thể tải lại trang để xem tiến độ.</p> : null}
      {message ? <p role="status" className={job?.status === "failed" || job?.errors.length ? styles.error : styles.success}>{message}</p> : null}{error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actionButtons}>
        <button type="button" onClick={() => setShowSchedule(true)}>Schedule Setting</button>
        <button type="button" onClick={() => setShowLog(true)} disabled={!job?.logs?.length}>
          Xem log {job?.logs?.length ? `(${job.logs.length})` : ""}
        </button>
      </div>
    </section>
    <section style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "20px" }}>Danh sách Kanji</h2>
        <span style={{ color: "#8fa4c2", fontSize: "13px" }}>{sourcesLoading ? "Đang tải..." : `${sources.length} mục`}</span>
      </div>
      <KanjiList
        sources={sources}
        selectedSources={selectedSources}
        onToggleSource={toggleSource}
        onTogglePage={toggleCurrentPage}
        disabled={busy}
      />
    </section>
    {showLog ? (
      <div className={styles.logBackdrop} role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowLog(false);
      }}>
        <section className={styles.logDialog} role="dialog" aria-modal="true" aria-labelledby="word-creator-log-title">
          <header className={styles.logHeader}>
            <h2 id="word-creator-log-title">Log tạo video</h2>
            <button type="button" onClick={() => setShowLog(false)} aria-label="Đóng log">Đóng</button>
          </header>
          <p className={styles.hint}>200 dòng gần nhất · Log lưu trong DB, cập nhật cùng tiến độ.</p>
          <pre className={styles.log} role="log" aria-label="Log tạo video">{job?.logs?.length
            ? job.logs.map((line) => `[${new Date(line.created_at).toLocaleString("vi-VN")}] ${line.level.toUpperCase()}${line.source ? ` [${line.source}]` : ""} ${line.message}`).join("\n")
            : "Chưa có log cho tác vụ này."}</pre>
        </section>
      </div>
    ) : null}
    {showSchedule ? (
      <div className={styles.logBackdrop} role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowSchedule(false);
      }}>
        <section className={`${styles.logDialog} ${styles.scheduleDialog}`} role="dialog" aria-modal="true" aria-labelledby="word-creator-schedule-title">
          <header className={styles.logHeader}>
            <h2 id="word-creator-schedule-title">WordCreator Schedule Settings</h2>
            <button type="button" onClick={() => setShowSchedule(false)} aria-label="Đóng schedule settings">Đóng</button>
          </header>
          <div className={styles.scheduleList}>
            <PipelineScheduleSettings mode="daily" kind="kanji" />
            <PipelineScheduleSettings mode="interval" kind="kanji" />
          </div>
        </section>
      </div>
    ) : null}
  </div>;
}
