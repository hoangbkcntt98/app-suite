"use client";

import { useEffect, useRef, useState } from "react";
import type { WordCreatorSource } from "@video/lib/wordCreator/index";
import VideoModal from "./VideoModal";
import KanjiUploadButton from "./KanjiUploadButton";
import styles from "./KanjiList.module.css";
import tableStyles from "@video/patterns/page.module.css";

type SocialLink = { platform: "YouTube" | "Facebook"; url: string };

function statusClass(status: string) {
  if (status === "video_generated" || status === "publish_facebook_ok" || status === "publish_youtube_ok") {
    return tableStyles.ok ?? "";
  }
  if (status === "failed") return tableStyles.error ?? "";
  return "";
}

export default function KanjiList({
  sources,
  selectedSources,
  onToggleSource,
  onTogglePage,
  disabled = false,
}: {
  sources: WordCreatorSource[];
  selectedSources: string[];
  onToggleSource: (source: string) => void;
  onTogglePage: () => void;
  disabled?: boolean;
}) {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [socialLink, setSocialLink] = useState<SocialLink | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selected = new Set(selectedSources);
  const allSelected = sources.length > 0 && sources.every((item) => selected.has(item.source));
  const someSelected = sources.some((item) => selected.has(item.source));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <>
      <div className={tableStyles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={onTogglePage}
                  disabled={disabled || sources.length === 0}
                  aria-label="Chọn tất cả Kanji trong trang"
                />
              </th>
              <th>Kanji</th>
              <th>Từ vựng mẫu</th>
              <th>Số từ</th>
              <th>Trạng thái</th>
              <th>Cập nhật</th>
              <th>Video</th>
              <th>Upload</th>
              <th>YouTube</th>
              <th>Facebook</th>
            </tr>
          </thead>
          <tbody>
            {sources.length ? sources.map((item) => (
              <tr key={item.source}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(item.source)}
                    onChange={() => onToggleSource(item.source)}
                    disabled={disabled}
                    aria-label={`Chọn ${item.source}`}
                  />
                </td>
                <td><strong style={{ fontSize: "20px" }}>{item.source}</strong></td>
                <td>{item.vocabulary || "—"}</td>
                <td>{item.note_count}</td>
                <td>
                  <span className={`${tableStyles.status} ${statusClass(item.status)}`}>
                    {item.status ? item.status.replaceAll("_", " ") : "Chưa tạo"}
                  </span>
                </td>
                <td style={{ fontSize: "12px", color: "#aebfd6" }}>
                  {item.updated_at ? new Date(item.updated_at).toLocaleString("vi-VN") : "—"}
                </td>
                <td>
                  {item.video_path ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setVideoPath(item.video_path)}
                      aria-label={`Xem video ${item.source}`}
                    >
                      ▶ Xem
                    </button>
                  ) : (
                    <span style={{ color: "#8fa4c2", fontSize: "12px" }}>Chưa có</span>
                  )}
                </td>
                <td>
                  <KanjiUploadButton source={item.source} videoPath={item.video_path} />
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={!item.youtube_video_id}
                    onClick={() => item.youtube_video_id && setSocialLink({
                      platform: "YouTube",
                      url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.youtube_video_id)}`,
                    })}
                    aria-label={item.youtube_video_id ? `Mở link YouTube ${item.source}` : `Chưa đăng YouTube ${item.source}`}
                    title={item.youtube_video_id ? "Xem link YouTube" : "Chưa đăng YouTube"}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" /></svg>
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.iconButton}
                    disabled={!item.facebook_video_id}
                    onClick={() => item.facebook_video_id && setSocialLink({
                      platform: "Facebook",
                      url: `https://www.facebook.com/reel/${encodeURIComponent(item.facebook_video_id)}`,
                    })}
                    aria-label={item.facebook_video_id ? `Mở link Facebook ${item.source}` : `Chưa đăng Facebook ${item.source}`}
                    title={item.facebook_video_id ? "Xem link Facebook" : "Chưa đăng Facebook"}
                  >
                    <span className={styles.facebookIcon} aria-hidden="true">f</span>
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "#8fa4c2", padding: "32px 16px" }}>
                  Không có Kanji trong trang này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <VideoModal isOpen={videoPath !== null} videoPath={videoPath} onClose={() => setVideoPath(null)} />
      {socialLink ? (
        <div className={styles.linkBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSocialLink(null);
        }}>
          <section className={styles.linkDialog} role="dialog" aria-modal="true" aria-labelledby="kanji-social-link-title">
            <header className={styles.linkHeader}>
              <h2 id="kanji-social-link-title">{socialLink.platform} link</h2>
              <button type="button" onClick={() => setSocialLink(null)} aria-label="Đóng link">Đóng</button>
            </header>
            <a className={styles.linkUrl} href={socialLink.url} target="_blank" rel="noreferrer">{socialLink.url}</a>
          </section>
        </div>
      ) : null}
    </>
  );
}
