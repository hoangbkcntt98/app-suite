import { appPath } from "@manga/lib/paths";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import BulkTranslateButton from "@manga/components/BulkTranslateButton";
import ChapterCrawlButton from "@manga/components/ChapterCrawlButton";
import CrawlAllChaptersButton from "@manga/components/CrawlAllChaptersButton";
import EpubExportButton from "@manga/components/EpubExportButton";
import FavoriteButton from "@manga/components/FavoriteButton";
import SiteHeader from "@manga/components/SiteHeader";
import { getCurrentUser } from "@manga/lib/auth";
import { pool } from "@manga/lib/db";
import styles from "./page.module.css";

type Manga = {
  id: string;
  site_key: string;
  title: string;
  href: string;
  src: string | null;
  description: string | null;
  store_images_locally: boolean;
};

type Chapter = {
  id: string;
  name: string;
  chapter_number: string | null;
  source_published_at: string | null;
  crawled_at: Date | null;
  image_count: number;
};

type LastReadChapter = {
  id: string;
  name: string;
  last_read_at: Date;
};

type AiTranslationStats = {
  total_images: number;
  translated_images: number;
};

export const dynamic = "force-dynamic";

export default async function MangaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(appPath("/login"));

  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const [
    mangaResult,
    chapterResult,
    favoriteResult,
    historyResult,
    aiStatsResult,
  ] =
    await Promise.all([
      pool.query<Manga>(
        `SELECT
           m.id,
           m.site_key,
           m.title,
           m.href,
           m.src,
           d.description,
           s.store_images_locally
         FROM manga_titles m
         JOIN crawler_sites s ON s.site_key = m.site_key
         LEFT JOIN manga_details d ON d.manga_title_id = m.id
         WHERE m.id = $1`,
        [id]
      ),
      pool.query<Chapter>(
        `SELECT
           c.id,
           c.name,
           c.chapter_number,
           c.source_published_at,
           c.crawled_at,
           SUM(CASE
             WHEN i.id IS NOT NULL
              AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)
             THEN 1 ELSE 0
           END)::int AS image_count
         FROM manga_chapters c
         JOIN manga_titles m ON m.id = c.manga_title_id
         JOIN crawler_sites s ON s.site_key = m.site_key
         LEFT JOIN chapter_images i ON i.chapter_id = c.id
         WHERE c.manga_title_id = $1
         GROUP BY c.id, s.store_images_locally
         ORDER BY (c.chapter_number IS NULL) ASC, c.chapter_number ASC, c.id ASC`,
        [id]
      ),
      pool.query(
        "SELECT 1 FROM manga_favorites WHERE manga_title_id = $1",
        [id]
      ),
      pool.query<LastReadChapter>(
        `SELECT
           c.id,
           c.name,
           h.last_read_at
         FROM reading_history h
         JOIN manga_chapters c ON c.id = h.chapter_id
         WHERE h.manga_title_id = $1
         LIMIT 1`,
        [id]
      ),
      pool.query<AiTranslationStats>(
        `SELECT
           COUNT(i.id)::int AS total_images,
           COUNT(r.id)::int AS translated_images
         FROM manga_titles m
         JOIN crawler_sites s ON s.site_key = m.site_key
         LEFT JOIN manga_chapters c ON c.manga_title_id = m.id
         LEFT JOIN chapter_images i ON i.chapter_id = c.id
           AND (s.store_images_locally = FALSE OR i.local_path IS NOT NULL)
         LEFT JOIN manga_ai_responses r ON r.image_id = i.id
           AND r.action = 'translate'
         WHERE m.id = $1`,
        [id]
      ),
    ]);

  const manga = mangaResult.rows[0];
  if (!manga) notFound();

  const chapters = chapterResult.rows;
  const readableChapters = chapters.filter((chapter) => chapter.image_count > 0);
  const firstChapter = readableChapters[0] ?? chapters[0];
  const lastReadChapter = historyResult.rows[0] ?? null;
  const aiStats = aiStatsResult.rows[0] ?? {
    total_images: 0,
    translated_images: 0,
  };
  const readTarget = lastReadChapter ?? firstChapter;

  return (
    <main className={styles.page}>
      <SiteHeader />

      <div className={styles.container}>
        <div className={styles.breadcrumbs}>
          <Link href={appPath(`/?site=${encodeURIComponent(manga.site_key)}`)}>
            ホーム
          </Link>
          <span>›</span>
          <span>{manga.title}</span>
        </div>

        <section className={styles.panel}>
          <div className={styles.hero}>
            <div className={styles.coverColumn}>
              {manga.src ? (
                <img className={styles.cover} src={manga.src} alt={manga.title} />
              ) : (
                <div className={styles.coverFallback}>No image</div>
              )}

              {readTarget && (
                <div className={styles.bookActions}>
                  <Link
                    className={styles.readButton}
                    href={appPath(`/read/${readTarget.id}`)}
                  >
                    ◉　{lastReadChapter ? "続きを読む" : "今すぐ読む"}
                  </Link>
                  {lastReadChapter ? (
                    <div className={styles.continueNote}>
                      前回: {lastReadChapter.name}
                    </div>
                  ) : null}
                  {readableChapters.length > 0 && (
                    <div className={styles.epubButton}>
                      <EpubExportButton titleId={manga.id} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.info}>
              <h1>{manga.title} Raw Free</h1>
              <p className={styles.subtitle}>{manga.title}</p>
              <div className={styles.stats}>
                <span>{chapters.length} チャプター</span>
                <span>{readableChapters.length} 読める</span>
              </div>
              <FavoriteButton
                className={styles.favoriteButton}
                initialFavorite={Boolean(favoriteResult.rowCount)}
                mangaId={manga.id}
              />
              <p className={styles.description}>
                {manga.description || "作品情報はクロール後に表示されます。"}
              </p>
            </div>
          </div>

          <div className={styles.chapterSection}>
            <div className={styles.chapterHeading}>
              <h2>▣　チャプター</h2>
              <div className={styles.chapterHeadingActions}>
                <CrawlAllChaptersButton
                  className={styles.crawlAllAction}
                  initialCrawledCount={readableChapters.length}
                  initialStatus="idle"
                  initialTotalCount={chapters.length}
                  titleId={manga.id}
                />
                <BulkTranslateButton
                  className={styles.bulkTranslateAction}
                  initialTotalCount={aiStats.total_images}
                  initialTranslatedCount={aiStats.translated_images}
                  titleId={manga.id}
                />
                <span>{chapters.length} 件</span>
              </div>
            </div>

            {chapters.length > 0 ? (
              <div className={styles.chapterList}>
                {chapters.map((chapter) => {
                  return (
                    <div className={styles.chapterRow} key={chapter.id}>
                      <span className={styles.chapterNumber}>
                        {chapter.chapter_number ?? "–"}
                      </span>
                      <div className={styles.chapterTitle}>
                        {chapter.image_count > 0 ? (
                          <Link
                            className={styles.chapterLink}
                            href={appPath(`/read/${chapter.id}`)}
                          >
                            {chapter.name}
                          </Link>
                        ) : (
                          <strong>{chapter.name}</strong>
                        )}
                        {chapter.crawled_at && (
                          <small>
                            Crawled:{" "}
                            {new Date(chapter.crawled_at).toLocaleString(
                              "vi-VN",
                              {
                                timeZone: "Asia/Ho_Chi_Minh",
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              }
                            )}
                          </small>
                        )}
                      </div>
                      <span className={styles.chapterDate}>
                        {chapter.source_published_at ?? ""}
                      </span>
                      <span className={styles.imageCount}>
                        {chapter.image_count > 0
                          ? `${chapter.image_count} pages`
                          : "chưa có ảnh"}
                      </span>
                      <ChapterCrawlButton
                        chapterId={chapter.id}
                        className={styles.crawlAction}
                        isDone={
                          chapter.image_count > 0 && chapter.crawled_at !== null
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.empty}>
                Chưa có chapter. Hãy chạy crawler để tải dữ liệu.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
