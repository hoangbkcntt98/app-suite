"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@video/app/patterns/page.module.css";

const basePath = process.env.NEXT_PUBLIC_VIDEO_CREATOR_BASE_PATH || "";

export default function ResetPatternStatuses() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function reset() {
    if (inFlight.current) return;
    if (!window.confirm("Reset tất cả pattern không có file video và chưa đăng video về pending, kể cả video_generated? Trạng thái xử lý, lỗi, khóa và đường dẫn video đã mất sẽ được xóa. Video còn tồn tại hoặc đã đăng/lên lịch được giữ nguyên; không xóa nội dung hoặc file.")) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(`${basePath}/api/patterns/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmReset: true }),
      });
      const body = await response.json().catch(() => {
        throw new Error(`API không trả JSON (HTTP ${response.status}). Tải lại danh sách để kiểm tra trạng thái.`);
      }) as { resetCount?: number; error?: string };
      if (!response.ok) throw new Error(body.error || "Không reset được status.");
      if (typeof body.resetCount !== "number") throw new Error("Thiếu kết quả reset. Tải lại danh sách để kiểm tra.");
      setMessage(body.resetCount ? `Đã reset ${body.resetCount} pattern về pending.` : "Không có pattern cần reset.");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Không reset được status.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.resetControls}>
      <button type="button" className={styles.resetButton} disabled={busy} onClick={() => void reset()}>
        {busy ? "Resetting..." : "Reset statuses without video"}
      </button>
      <p>Reset mọi status, kể cả video_generated, nếu file video không còn và chưa đăng/lên lịch. Đường dẫn cũ không được tính là video.</p>
      {message ? <p role={failed ? "alert" : "status"} className={failed ? styles.error : styles.resetSuccess}>{message}</p> : null}
    </div>
  );
}
