"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WordCreator.module.css";

const basePath = process.env.NEXT_PUBLIC_VIDEO_CREATOR_BASE_PATH || "";
const endpoint = `${basePath}/api/word-creator/template-gif`;
type AssetInfo = { available: boolean; uploaded?: boolean; size?: number; updatedAt?: string; error?: string };

export default function WordCreatorMascotUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [asset, setAsset] = useState<AssetInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch(`${endpoint}?info=1`, { cache: "no-store" });
    const body = await response.json() as AssetInfo;
    if (!response.ok) throw new Error(body.error || "Không đọc được GIF template.");
    setAsset(body);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`${endpoint}?info=1`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as AssetInfo;
        if (!response.ok) throw new Error(body.error || "Không đọc được GIF template.");
        if (!cancelled) setAsset(body);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Không đọc được GIF template.");
      });
    return () => { cancelled = true; };
  }, []);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(endpoint, { method: "POST", body: form });
      const body = await response.json() as AssetInfo;
      if (!response.ok) throw new Error(body.error || "Không upload được GIF.");
      await refresh();
      setMessage("Đã cập nhật spinning-bear.gif. Video tạo mới sẽ dùng GIF này.");
      if (inputRef.current) inputRef.current.value = "";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không upload được GIF.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.assetPanel} aria-labelledby="word-creator-mascot-heading">
    <div className={styles.assetPreview}>
      {asset?.available ? (
        <img src={`${endpoint}?v=${encodeURIComponent(asset.updatedAt || "current")}`} alt="Mascot GIF hiện tại" />
      ) : <span>Chưa có GIF</span>}
    </div>
    <div className={styles.assetDetails}>
      <h2 id="word-creator-mascot-heading">Mascot template</h2>
      <p className={styles.hint}>Upload GIF sẽ thay mascot ở video WordCreator tạo sau này. GIF tối đa 15 MB, kích thước tối đa 2048×2048.</p>
      <div className={styles.assetControls}>
        <input ref={inputRef} type="file" accept="image/gif,.gif" aria-label="Chọn spinning-bear.gif" disabled={busy} />
        <button type="button" onClick={() => void upload()} disabled={busy}>
          {busy ? "Đang upload..." : "Upload GIF"}
        </button>
      </div>
      {asset?.available ? <small>{asset.uploaded ? "GIF đã upload" : "Đang dùng GIF template mặc định"} · {Math.round((asset.size || 0) / 1024)} KB</small> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
    </div>
  </section>;
}
