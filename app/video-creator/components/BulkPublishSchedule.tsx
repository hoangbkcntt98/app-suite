"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BulkPublishSettings, PublishJob, PublishPreview } from "@video/lib/bulkPublish";
import styles from "./BulkPublishSchedule.module.css";

const endpoint = `${process.env.NEXT_PUBLIC_VIDEO_CREATOR_BASE_PATH || ""}/api/patterns/publish-schedule`;
type ScheduleState = { eligibleCount: number; missingCaption: number; jobs: PublishJob[] };
const labels: Record<string, string> = {
  queued: "Chờ đăng", running: "Đang đăng", success: "Đã đăng", failed: "Lỗi - cần kiểm tra",
  cancelled: "Đã hủy", skipped: "Đã đăng / có lịch khác", missed: "Lỡ ngày đăng",
};

export function defaultPublishSettings(now = new Date()): BulkPublishSettings {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now.getTime() + 15 * 60_000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    startDate: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`, timezone: "Asia/Tokyo", videosPerDay: 1, count: 1,
  };
}

function formatDate(date: string, timezone: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone, dateStyle: "short", timeStyle: "short",
  }).format(new Date(date));
}

async function api<T>(method = "GET", body?: object): Promise<T> {
  const response = await fetch(endpoint, {
    method, cache: "no-store", headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => { throw new Error(`Không đọc được phản hồi HTTP ${response.status}.`); });
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result as T;
}

export default function BulkPublishSchedule() {
  const [state, setState] = useState<ScheduleState | null>(null);
  const [settings, setSettings] = useState<BulkPublishSettings | null>(null);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const requestId = useRef("");

  const refresh = useCallback(async () => {
    const result = await api<ScheduleState>();
    setState(result);
    setSettings((current) => current || { ...defaultPublishSettings(), count: Math.min(1000, Math.max(1, result.eligibleCount)) });
  }, []);

  useEffect(() => {
    let active = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await api<ScheduleState>();
        if (active) {
          setState(result);
          setSettings((current) => current || { ...defaultPublishSettings(), count: Math.min(1000, Math.max(1, result.eligibleCount)) });
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Không tải được lịch."); }
      finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  function change<K extends keyof BulkPublishSettings>(key: K, value: BulkPublishSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : null);
    setPreview(null);
    requestId.current = "";
    setMessage("");
    setError("");
  }

  async function act(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không xử lý được lịch."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function showPreview() {
    setPreview(null);
    const result = await api<{ preview: PublishPreview }>("POST", { action: "preview", settings });
    requestId.current = crypto.randomUUID();
    setPreview(result.preview);
  }

  async function schedule() {
    if (!preview) return;
    const first = preview.items[0];
    const last = preview.items[preview.items.length - 1];
    if (!window.confirm(
      `Cho phép tự động đăng công khai ${preview.items.length} video lên Facebook?\n` +
      `${preview.settings.videosPerDay} video/ngày, từ ${formatDate(first.scheduledFor, preview.settings.timezone)} ` +
      `đến ${formatDate(last.scheduledFor, preview.settings.timezone)} (${preview.settings.timezone}).\n` +
      "Server cần chạy khi đến giờ. Chỉ các mục chưa bắt đầu mới có thể hủy.",
    )) return;
    await api("POST", {
      action: "schedule", settings: preview.settings, previewHash: preview.hash,
      requestId: requestId.current, confirmPublish: true,
    });
    setPreview(null);
    requestId.current = "";
    setMessage(`Đã lưu lịch cho ${preview.items.length} video. Chưa đăng ngay; chờ giờ đã chọn.`);
    await refresh();
  }

  const pendingBatches = Array.from(new Set(
    (state?.jobs || []).filter((job) => job.status === "queued" && !job.runId).map((job) => job.batchId),
  ));

  return (
    <section className={styles.panel} aria-labelledby="bulk-publish-heading">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>FACEBOOK / VIDEO CÓ SẴN</p>
          <h2 id="bulk-publish-heading">Lên lịch đăng hàng loạt</h2>
          <p>Chọn video chưa đăng theo ID pattern tăng dần. Bỏ qua video đã đăng hoặc đã có lịch.</p>
        </div>
        <strong>{state ? `${state.eligibleCount} video sẵn sàng` : "Đang tải..."}</strong>
      </div>
      {state?.missingCaption ? <p>{state.missingCaption} video thiếu caption; thêm caption trong trình xem video trước khi lên lịch.</p> : null}
      {settings ? (
        <form onSubmit={(event) => { event.preventDefault(); void act(showPreview); }}>
          <fieldset className={styles.fields} disabled={busy}>
            <label>Ngày bắt đầu<input required type="date" value={settings.startDate} onChange={(e) => change("startDate", e.target.value)} /></label>
            <label>Giờ đăng<input required type="time" value={settings.time} onChange={(e) => change("time", e.target.value)} /></label>
            <label>Múi giờ<input required list="publish-timezones" value={settings.timezone} onChange={(e) => change("timezone", e.target.value)} /></label>
            <datalist id="publish-timezones"><option value="Asia/Tokyo" /><option value="Asia/Ho_Chi_Minh" /><option value="UTC" /></datalist>
            <label>Video / ngày<input required type="number" min={1} max={20} value={settings.videosPerDay} onChange={(e) => change("videosPerDay", Number(e.target.value))} /></label>
            <label>Tổng video<input required type="number" min={1} max={Math.min(1000, state?.eligibleCount || 1000)} value={settings.count} onChange={(e) => change("count", Number(e.target.value))} /></label>
          </fieldset>
          <div className={styles.actions}>
            <button type="submit" disabled={busy || !state?.eligibleCount}>Xem trước lịch</button>
            <button type="button" disabled={busy} onClick={() => void act(refresh)}>Tải lại</button>
            {busy ? <span role="status">Đang xử lý...</span> : null}
          </div>
        </form>
      ) : <button type="button" disabled={busy} onClick={() => void act(refresh)}>Tải lại</button>}
      <p className={styles.note}>Lịch lưu trong DB, tiếp tục sau restart. Server cần chạy; worker bận sẽ đăng trễ trong cùng ngày.
        Ngày đã lỡ sẽ bỏ qua, không đăng dồn. Nhiều video/ngày dùng cùng giờ, xử lý lần lượt. Không đăng YouTube.</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {message ? <p role="status" className={styles.success}>{message}</p> : null}
      {preview ? (
        <div className={styles.preview}>
          <h3>Xem trước: {preview.items.length} video / {preview.settings.timezone}</h3>
          <p>Caption và tiêu đề được chốt khi xác nhận. Chưa có lịch nào được kích hoạt.</p>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Pattern</th><th>Thời gian đăng</th><th>Video</th></tr></thead>
              <tbody>{preview.items.map((item) => (
                <tr key={item.relativePath}>
                  <td>#{item.patternId} {item.patternName}</td>
                  <td>{formatDate(item.scheduledFor, preview.settings.timezone)}</td>
                  <td className={styles.path}>{item.relativePath}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <button className={styles.confirm} type="button" disabled={busy} onClick={() => void act(schedule)}>
            Xác nhận lịch đăng Facebook
          </button>
        </div>
      ) : null}
      <details className={styles.history}>
        <summary>Lịch đã lưu ({state?.jobs.length || 0} mục gần nhất)</summary>
        <p>Lỗi không tự thử lại. Kiểm tra Facebook trước khi đăng thủ công để tránh trùng video.</p>
        <div className={styles.actions}>{pendingBatches.map((batchId) => (
          <button type="button" key={batchId} disabled={busy} onClick={() => void act(async () => {
            if (!window.confirm(`Hủy các video chưa bắt đầu trong lịch ${batchId.slice(0, 8)}? Video đang đăng hoặc đã đăng không bị ảnh hưởng.`)) return;
            const result = await api<{ cancelledCount: number }>("DELETE", { batchId, confirmCancel: true });
            setMessage(`Đã hủy ${result.cancelledCount} mục chưa bắt đầu.`);
            setPreview(null);
            requestId.current = "";
            await refresh();
          })}>Hủy lịch {batchId.slice(0, 8)}</button>
        ))}</div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Pattern / Lịch</th><th>Thời gian</th><th>Trạng thái</th></tr></thead>
            <tbody>{state?.jobs.map((job) => (
              <tr key={job.id}>
                <td>#{job.patternId} {job.patternName}<small>{job.batchId.slice(0, 8)}</small></td>
                <td>{formatDate(job.scheduledFor, job.timezone)}<small>{job.timezone}</small></td>
                <td>{labels[job.status] || job.status}{job.runId ? <small>Run #{job.runId}</small> : null}
                  {job.error ? <small className={styles.error}>{job.error}</small> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
