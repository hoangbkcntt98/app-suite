"use client";

import { useEffect, useState } from "react";
import styles from "./KanjiList.module.css";

const basePath = process.env.NEXT_PUBLIC_VIDEO_CREATOR_BASE_PATH || "";
type VideoDetails = { title: string; caption: string };
type UploadRun = { id: number; status: string };

export default function KanjiUploadButton({ source, videoPath }: { source: string; videoPath: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(source);
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState("private");
  const [audience, setAudience] = useState("");
  const [synthetic, setSynthetic] = useState("");
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open || !videoPath) return;
    let cancelled = false;
    Promise.all([
      fetch(`${basePath}/api/videos?path=${encodeURIComponent(videoPath)}`, { cache: "no-store" }),
      fetch(`${basePath}/api/youtube`, { cache: "no-store" }),
    ]).then(async ([videoResponse, configResponse]) => {
      const videoBody = await videoResponse.json() as { video?: VideoDetails; error?: string };
      const config = await configResponse.json() as { configured?: boolean };
      if (!videoResponse.ok || !videoBody.video) throw new Error(videoBody.error || "Không đọc được nội dung video.");
      if (cancelled) return;
      setTitle(videoBody.video.title || source);
      setCaption(videoBody.video.caption || "");
      setYoutubeConfigured(config.configured === true);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Không tải được thông tin video.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, source, videoPath]);

  async function upload(platform: "facebook" | "youtube") {
    if (!videoPath || busy) return;
    if (platform === "facebook" && !caption.trim()) {
      setError("Nhập caption trước khi đăng Facebook.");
      return;
    }
    if (platform === "youtube" && (!audience || !synthetic)) {
      setError("Chọn đối tượng người xem và khai báo nội dung tổng hợp.");
      return;
    }
    const platformName = platform === "facebook" ? "Facebook" : "YouTube";
    if (!window.confirm(`Xác nhận đăng video ${title} lên ${platformName}?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${basePath}/api/${platform === "facebook" ? "videos" : "youtube"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(platform === "facebook"
          ? { action: "publish", path: videoPath, title, caption, confirmPublish: true }
          : {
              path: videoPath, title, description: caption, privacy,
              madeForKids: audience === "yes", containsSyntheticMedia: synthetic === "yes", confirmUpload: true,
            }),
      });
      const body = await response.json() as { error?: string; run?: UploadRun };
      if (!response.ok || !body.run) throw new Error(body.error || `Không khởi động được upload ${platformName}.`);
      setMessage(`Đã tạo upload run #${body.run.id} trên ${platformName}. Theo dõi tiến trình ở Run History.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Upload ${platformName} thất bại.`);
    } finally {
      setBusy(false);
    }
  }

  if (!videoPath) {
    return <button type="button" className={styles.iconButton} disabled aria-label={`Chưa có video để upload ${source}`} title="Chưa có video">↑</button>;
  }

  return <>
    <button type="button" className={styles.iconButton} onClick={() => {
      setLoading(true);
      setError("");
      setOpen(true);
      setMessage("");
    }} aria-label={`Upload video ${source}`} title="Đăng video">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M4 15v5h16v-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open ? <div className={styles.linkBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) setOpen(false);
    }}>
      <section className={styles.uploadDialog} role="dialog" aria-modal="true" aria-labelledby="kanji-upload-title">
        <header className={styles.linkHeader}>
          <h2 id="kanji-upload-title">Đăng video · {source}</h2>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Đóng upload">Đóng</button>
        </header>
        {loading ? <p role="status">Đang tải thông tin video...</p> : <>
          <label className={styles.uploadField}>Tiêu đề
            <input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
          </label>
          <label className={styles.uploadField}>Caption / mô tả
            <textarea value={caption} rows={5} maxLength={5000} onChange={(event) => setCaption(event.target.value)} disabled={busy} />
          </label>
          <div className={styles.uploadOptions}>
            <label>Visibility YouTube
              <select value={privacy} onChange={(event) => setPrivacy(event.target.value)} disabled={busy}>
                <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
              </select>
            </label>
            <label>Made for kids?
              <select value={audience} onChange={(event) => setAudience(event.target.value)} disabled={busy}>
                <option value="">Chọn</option><option value="no">No</option><option value="yes">Yes</option>
              </select>
            </label>
            <label>Synthetic media?
              <select value={synthetic} onChange={(event) => setSynthetic(event.target.value)} disabled={busy}>
                <option value="">Chọn</option><option value="no">No</option><option value="yes">Yes</option>
              </select>
            </label>
          </div>
          <div className={styles.uploadActions}>
            <button type="button" disabled={busy || !caption.trim()} onClick={() => void upload("facebook")}>f&nbsp; Facebook</button>
            <button type="button" disabled={busy || !youtubeConfigured || !title.trim() || !audience || !synthetic} onClick={() => void upload("youtube")}>
              ▶ YouTube
            </button>
          </div>
          {!youtubeConfigured ? <p className={styles.uploadHint}>YouTube chưa cấu hình; nút upload YouTube bị khóa.</p> : null}
          <p className={styles.uploadHint}>Mỗi nút đăng trực tiếp lên nền tảng tương ứng. Kiểm tra caption và cài đặt trước khi xác nhận.</p>
        </>}
        {error ? <p className={styles.uploadError} role="alert">{error}</p> : null}
        {message ? <p className={styles.uploadHint} role="status">{message}</p> : null}
      </section>
    </div> : null}
  </>;
}
