import { appPath } from "@manga/lib/paths";
import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "@manga/components/SiteHeader";
import { getCurrentUser } from "@manga/lib/auth";
import { pool } from "@manga/lib/db";
import styles from "../library.module.css";

type Favorite = {
  id: string;
  title: string;
  src: string | null;
  chapter_count: number;
};

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect(appPath("/login"));

  const result = await pool.query<Favorite>(
    `SELECT
       m.id,
       m.title,
       m.src,
       COUNT(c.id)::int AS chapter_count
     FROM manga_favorites f
     JOIN manga_titles m ON m.id = f.manga_title_id
     LEFT JOIN manga_chapters c ON c.manga_title_id = m.id
     GROUP BY m.id, f.created_at
     ORDER BY f.created_at DESC`
  );

  return (
    <main className={styles.page}>
      <SiteHeader />
      <div className={styles.container}>
        <h1>Favorite Titles</h1>
        {result.rows.length ? (
          <div className={styles.grid}>
            {result.rows.map((item) => (
              <Link className={styles.card} href={appPath(`/manga/${item.id}`)} key={item.id}>
                {item.src ? (
                  <img alt={item.title} src={item.src} />
                ) : (
                  <div className={styles.placeholder}>No image</div>
                )}
                <div className={styles.body}>
                  <h2>{item.title}</h2>
                  <p>{item.chapter_count} chapters</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Chưa có title yêu thích.</div>
        )}
      </div>
    </main>
  );
}
