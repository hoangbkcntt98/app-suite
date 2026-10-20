import { appPath } from "@manga/lib/paths";
import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "@manga/components/SiteHeader";
import { getCurrentUser } from "@manga/lib/auth";
import { pool } from "@manga/lib/db";
import styles from "../library.module.css";

type HistoryItem = {
  manga_id: string;
  title: string;
  src: string | null;
  chapter_id: string;
  chapter_name: string;
  last_read_at: Date;
};

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect(appPath("/login"));

  const result = await pool.query<HistoryItem>(
    `SELECT
       m.id AS manga_id,
       m.title,
       m.src,
       c.id AS chapter_id,
       c.name AS chapter_name,
       h.last_read_at
     FROM reading_history h
     JOIN manga_titles m ON m.id = h.manga_title_id
     JOIN manga_chapters c ON c.id = h.chapter_id
     ORDER BY h.last_read_at DESC`
  );

  return (
    <main className={styles.page}>
      <SiteHeader />
      <div className={styles.container}>
        <h1>Reading History</h1>
        {result.rows.length ? (
          <div className={styles.grid}>
            {result.rows.map((item) => (
              <Link
                className={styles.card}
                href={appPath(`/read/${item.chapter_id}`)}
                key={item.manga_id}
              >
                {item.src ? (
                  <img alt={item.title} src={item.src} />
                ) : (
                  <div className={styles.placeholder}>No image</div>
                )}
                <div className={styles.body}>
                  <h2>{item.title}</h2>
                  <p>Đang đọc: {item.chapter_name}</p>
                  <p>
                    {new Date(item.last_read_at).toLocaleString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                    })}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Chưa có lịch sử đọc.</div>
        )}
      </div>
    </main>
  );
}
