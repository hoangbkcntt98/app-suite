import { appPath } from "@manga/lib/paths";
import { databaseDialect, pool } from "@manga/lib/db";
import { reconcileStoppedCrawlers } from "@manga/lib/crawler";
import CrawlButton from "@manga/components/CrawlButton";
import HomeHeaderActions from "@manga/components/HomeHeaderActions";
import SiteRegistry from "@manga/components/SiteRegistry";
import SiteSwitcher from "@manga/components/SiteSwitcher";
import TitleCoverImage from "@manga/components/TitleCoverImage";
import TitleCrawlButton from "@manga/components/TitleCrawlButton";
import { getCurrentUser } from "@manga/lib/auth";
import { imageStorageRoot } from "@manga/lib/imageStorage";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

type MangaTitle = {
  id: number;
  title: string;
  href: string;
  src: string | null;
  updated_at: string;
  chapter_count: number;
  crawled_chapter_count: number;
  images_crawled_at: string | null;
  crawl_status: string;
  last_read_chapter_id: string | null;
  last_read_chapter_name: string | null;
  last_read_at: string | null;
};

type HomeProps = {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    filter?: string | string[];
    chapters?: string | string[];
    site?: string | string[];
    sort?: string | string[];
  }>;
};

type CrawlerSite = {
  site_key: string;
  crawl_status: string;
  crawl_error: string | null;
  last_crawled_at: string | null;
  store_images_locally: boolean;
  local_image_storage_path: string | null;
  title_count: number;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 24;
const MAX_VISIBLE_PAGES = 7;
const VIETNAMESE_SEARCH_GROUPS = [
  ["a", "áàảãạăắằẳẵặâấầẩẫậ"],
  ["e", "éèẻẽẹêếềểễệ"],
  ["i", "íìỉĩị"],
  ["o", "óòỏõọôốồổỗộơớờởỡợ"],
  ["u", "úùủũụưứừửữự"],
  ["y", "ýỳỷỹỵ"],
  ["d", "đ"],
] as const;
const VIETNAMESE_ACCENTED_CHARS = VIETNAMESE_SEARCH_GROUPS.map(
  ([, chars]) => chars
).join("");
const VIETNAMESE_ASCII_CHARS = VIETNAMESE_SEARCH_GROUPS.map(([base, chars]) =>
  base.repeat(chars.length)
).join("");

function getPageNumber(page: string | string[] | undefined) {
  const rawPage = Array.isArray(page) ? page[0] : page;
  const parsedPage = Number(rawPage ?? 1);

  return Number.isFinite(parsedPage) && parsedPage > 0
    ? Math.floor(parsedPage)
    : 1;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

type ChapterSort = "chapters_asc" | "chapters_desc";

export default async function Home({ searchParams }: HomeProps) {
  const { page, q, filter, chapters, site, sort } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(appPath("/login"));
  await reconcileStoppedCrawlers();
  const rawSite = Array.isArray(site) ? site[0] : site;
  const selectedSite = rawSite?.trim() ?? "";
  const sitesResult = await pool.query<CrawlerSite>(
    `SELECT
       s.site_key,
       s.crawl_status,
       s.crawl_error,
       s.last_crawled_at,
       s.store_images_locally,
       s.local_image_storage_path,
       COUNT(m.id)::int AS title_count
     FROM crawler_sites s
     LEFT JOIN manga_titles m ON m.site_key = s.site_key
     GROUP BY s.id
     ORDER BY s.created_at`
  );
  const sites = sitesResult.rows;
  const activeSite = sites.find((item) => item.site_key === selectedSite);

  if (!selectedSite || !activeSite) {
    return (
      <SiteRegistry
        defaultImageStoragePath={imageStorageRoot}
        initialSites={sites}
      />
    );
  }

  const currentPage = getPageNumber(page);
  const rawQuery = Array.isArray(q) ? q[0] : q;
  const rawFilter = Array.isArray(filter) ? filter[0] : filter;
  const rawChapters = Array.isArray(chapters) ? chapters[0] : chapters;
  const rawSort = Array.isArray(sort) ? sort[0] : sort;
  const crawledOnly = rawFilter === "crawled";
  const hasChaptersOnly = rawChapters === "has";
  const chapterSort: ChapterSort =
    rawSort === "chapters_asc" ? "chapters_asc" : "chapters_desc";
  const chapterOrder = chapterSort === "chapters_asc" ? "ASC" : "DESC";
  const query = rawQuery?.trim() ?? "";
  const searchPattern = `%${query}%`;
  const normalizedSearchPattern = `%${normalizeSearchText(query)}%`;
  const titleSearchCondition =
    databaseDialect === "mysql"
      ? `($2 = '' OR LOWER(m.title) LIKE LOWER($3))`
      : `(
          $2 = ''
          OR m.title ILIKE $3
          OR translate(lower(m.title), $4, $5) LIKE $6
        )`;
  const countResult = await pool.query<{ total: number }>(
    `SELECT COUNT(DISTINCT m.id)::int AS total
     FROM manga_titles m
     LEFT JOIN manga_details d ON d.manga_title_id = m.id
     WHERE m.site_key = $1
       AND ${titleSearchCondition}
       AND ($7::boolean = false OR d.images_crawled_at IS NOT NULL)
       AND ($8::boolean = false OR EXISTS (
         SELECT 1
         FROM manga_chapters existing_c
         WHERE existing_c.manga_title_id = m.id
       ))`,
    [
      selectedSite,
      query,
      searchPattern,
      VIETNAMESE_ACCENTED_CHARS,
      VIETNAMESE_ASCII_CHARS,
      normalizedSearchPattern,
      crawledOnly,
      hasChaptersOnly,
    ]
  );
  const totalItems = countResult.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const result = await pool.query<MangaTitle>(
    `
      SELECT
        m.id,
        m.title,
        m.href,
        m.src,
        m.updated_at,
        d.images_crawled_at,
        COALESCE(d.crawl_status, 'idle') AS crawl_status,
        COUNT(c.id)::int AS chapter_count,
        SUM(CASE
          WHEN c.id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM chapter_images i
            WHERE i.chapter_id = c.id
              AND (
                s.store_images_locally = FALSE
                OR i.local_path IS NOT NULL
              )
          ) THEN 1 ELSE 0
        END)::int AS crawled_chapter_count,
        (
          SELECT h.chapter_id::text
          FROM reading_history h
          WHERE h.manga_title_id = m.id
          ORDER BY h.last_read_at DESC
          LIMIT 1
        ) AS last_read_chapter_id,
        (
          SELECT rc.name
          FROM reading_history h
          JOIN manga_chapters rc ON rc.id = h.chapter_id
          WHERE h.manga_title_id = m.id
          ORDER BY h.last_read_at DESC
          LIMIT 1
        ) AS last_read_chapter_name,
        (
          SELECT h.last_read_at::text
          FROM reading_history h
          WHERE h.manga_title_id = m.id
          ORDER BY h.last_read_at DESC
          LIMIT 1
        ) AS last_read_at
      FROM manga_titles m
      JOIN crawler_sites s ON s.site_key = m.site_key
      LEFT JOIN manga_details d ON d.manga_title_id = m.id
      LEFT JOIN manga_chapters c ON c.manga_title_id = m.id
      WHERE m.site_key = $1
        AND ${titleSearchCondition}
        AND ($7::boolean = false OR d.images_crawled_at IS NOT NULL)
        AND ($8::boolean = false OR EXISTS (
          SELECT 1 FROM manga_chapters existing_c
          WHERE existing_c.manga_title_id = m.id
        ))
      GROUP BY m.id, s.store_images_locally, d.images_crawled_at, d.crawl_status
      ORDER BY chapter_count ${chapterOrder}, m.updated_at DESC
      LIMIT $9 OFFSET $10
    `,
    [
      selectedSite,
      query,
      searchPattern,
      VIETNAMESE_ACCENTED_CHARS,
      VIETNAMESE_ASCII_CHARS,
      normalizedSearchPattern,
      crawledOnly,
      hasChaptersOnly,
      PAGE_SIZE,
      offset,
    ]
  );

  const canGoPrevious = safePage > 1;
  const canGoNext = safePage < totalPages;

  const firstVisiblePage = Math.max(
    1,
    Math.min(
      safePage - Math.floor(MAX_VISIBLE_PAGES / 2),
      totalPages - MAX_VISIBLE_PAGES + 1
    )
  );
  const visiblePageCount = Math.min(MAX_VISIBLE_PAGES, totalPages);
  const pageNumbers = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index
  );

  const pageHref = (pageNumber: number) => {
    const params = new URLSearchParams();
    params.set("site", selectedSite);
    if (query) {
      params.set("q", query);
    }
    if (crawledOnly) {
      params.set("filter", "crawled");
    }
    if (hasChaptersOnly) {
      params.set("chapters", "has");
    }
    if (chapterSort !== "chapters_desc") {
      params.set("sort", chapterSort);
    }
    params.set("page", String(pageNumber));
    return appPath(`/?${params.toString()}`);
  };

  const listHref = ({
    nextCrawledOnly = crawledOnly,
    nextHasChaptersOnly = hasChaptersOnly,
    nextSort = chapterSort,
  }: {
    nextCrawledOnly?: boolean;
    nextHasChaptersOnly?: boolean;
    nextSort?: ChapterSort;
  }) => {
    const params = new URLSearchParams();
    params.set("site", selectedSite);
    if (query) {
      params.set("q", query);
    }
    if (nextCrawledOnly) {
      params.set("filter", "crawled");
    }
    if (nextHasChaptersOnly) {
      params.set("chapters", "has");
    }
    if (nextSort !== "chapters_desc") {
      params.set("sort", nextSort);
    }
    return appPath(`/?${params.toString()}`);
  };

  return (
    <main
      className={styles.page}
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(39, 55, 92, 0.34), transparent 42%), linear-gradient(180deg, #0b1020 0%, #090d18 100%)",
        color: "#e8edf7",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <header
        className={styles.header}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          backdropFilter: "blur(14px)",
          background: "rgba(7, 10, 20, 0.82)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div
          className={styles.headerInner}
          style={{
            maxWidth: 1440,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            gap: 24,
            position: "relative",
          }}
        >
          <Link
            className={styles.logo}
            href={appPath(`/?site=${encodeURIComponent(selectedSite)}`)}
            style={{
              textDecoration: "none",
              color: "#fff",
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: -0.6,
            }}
          >
            Manga<span style={{ color: "#5ea3ff" }}>Rw</span>
          </Link>

          <nav
            className={styles.desktopNav}
            style={{ display: "flex", gap: 22, flexWrap: "wrap", fontSize: 15 }}
          >
            <Link href="#" style={{ color: "#93b7ff", textDecoration: "none", fontWeight: 700 }}>
              漫画リスト
            </Link>
            <Link href={appPath("/")} style={{ color: "#c5cbe0", textDecoration: "none" }}>
              サイト
            </Link>
            <Link href={appPath("/")} style={{ color: "#c5cbe0", textDecoration: "none" }}>
              Config regist
            </Link>
            <Link href="#" style={{ color: "#c5cbe0", textDecoration: "none" }}>
              ジャンル
            </Link>
            <Link href={appPath("/favorites")} style={{ color: "#c5cbe0", textDecoration: "none" }}>
              しおり
            </Link>
            <Link href={appPath("/history")} style={{ color: "#c5cbe0", textDecoration: "none" }}>
              読書履歴
            </Link>
            <Link href={appPath("/flashcards")} style={{ color: "#c5cbe0", textDecoration: "none" }}>
              Flash Cards
            </Link>
          </nav>

          <HomeHeaderActions
            crawledOnly={crawledOnly}
            hasChaptersOnly={hasChaptersOnly}
            initialQuery={query}
            siteKey={selectedSite}
            sort={chapterSort}
            username={user?.username ?? null}
          />
        </div>
      </header>

      <div
        className={styles.content}
        style={{ maxWidth: 1440, margin: "0 auto", padding: "20px 24px 40px" }}
      >
        <section className={styles.heading} style={{ marginBottom: 20 }}>
          <h1
            className={styles.title}
            style={{ fontSize: 28, margin: 0, fontWeight: 900, letterSpacing: -0.4 }}
          >
            {selectedSite} · 漫画を閲覧{" "}
            <span style={{ color: "#8ea1c9", fontWeight: 700 }}>{totalItems} タイトル</span>
          </h1>
          {query && (
            <p className={styles.searchSummary}>
              「{query}」の検索結果
              <Link href={appPath(`/?site=${encodeURIComponent(selectedSite)}`)}>
                クリア
              </Link>
            </p>
          )}
          <p className={styles.resultSummary} style={{ margin: "10px 0 0", color: "#8ea1c9" }}>
            Showing {result.rows.length} of {totalItems} items on page {safePage} of {totalPages}
          </p>
        </section>

        <section
          className={styles.listToolbar}
          style={{
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(10, 15, 29, 0.9)",
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
            padding: 16,
            marginBottom: 22,
          }}
        >
          <SiteSwitcher
            className={styles.siteSwitcher}
            currentSiteKey={selectedSite}
            crawledOnly={crawledOnly}
            hasChaptersOnly={hasChaptersOnly}
            query={query}
            sort={chapterSort}
            sites={sites}
          />
          <div className={styles.toolbarControls}>
            <div className={styles.controlGroup} aria-label="Filter titles">
              <span>Filter</span>
              <Link
                aria-current={!crawledOnly ? "page" : undefined}
                className={`${styles.toolbarLink} ${
                  !crawledOnly ? styles.toolbarLinkActive : ""
                }`}
                href={listHref({ nextCrawledOnly: false })}
              >
                All
              </Link>
              <Link
                aria-current={crawledOnly ? "page" : undefined}
                className={`${styles.toolbarLink} ${
                  crawledOnly ? styles.toolbarLinkActive : ""
                }`}
                href={listHref({ nextCrawledOnly: true })}
              >
                Crawled
              </Link>
              <Link
                aria-current={hasChaptersOnly ? "page" : undefined}
                className={`${styles.toolbarLink} ${
                  hasChaptersOnly ? styles.toolbarLinkActive : ""
                }`}
                href={listHref({
                  nextHasChaptersOnly: !hasChaptersOnly,
                })}
              >
                Chapters &gt; 0
              </Link>
            </div>
            <div className={styles.controlGroup} aria-label="Sort by chapter">
              <span>Sort chapters</span>
              <Link
                aria-current={chapterSort === "chapters_desc" ? "page" : undefined}
                className={`${styles.toolbarLink} ${
                  chapterSort === "chapters_desc"
                    ? styles.toolbarLinkActive
                    : ""
                }`}
                href={listHref({ nextSort: "chapters_desc" })}
              >
                ↓ 多い順
              </Link>
              <Link
                aria-current={chapterSort === "chapters_asc" ? "page" : undefined}
                className={`${styles.toolbarLink} ${
                  chapterSort === "chapters_asc"
                    ? styles.toolbarLinkActive
                    : ""
                }`}
                href={listHref({ nextSort: "chapters_asc" })}
              >
                ↑ 少ない順
              </Link>
            </div>
            <div className={styles.logControls}>
              <CrawlButton compact showStart={false} siteKey={selectedSite} />
            </div>
          </div>
        </section>

        <section
          className={styles.mangaGrid}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
            gap: 14,
          }}
        >
          {result.rows.map((item) => (
            <article
              className={styles.mangaLink}
              key={item.id}
              style={{
                display: "block",
                color: "inherit",
              }}
            >
              <div
                className={styles.mangaCard}
                style={{
                  borderRadius: 18,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.24)",
                  transition: "transform 160ms ease, border-color 160ms ease",
                }}
              >
                <Link className={styles.cardLink} href={appPath(`/manga/${item.id}`)}>
                  <div className={styles.cover} style={{ position: "relative" }}>
                    <TitleCoverImage
                      alt={item.title}
                      className={styles.coverImage}
                      src={item.src}
                    />

                    <span
                      className={styles.status}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        borderRadius: 999,
                        background: item.images_crawled_at
                          ? "linear-gradient(180deg, #24bf7a 0%, #1d9f66 100%)"
                          : "linear-gradient(180deg, #e9a23b 0%, #c77c14 100%)",
                        color: "white",
                        fontSize: 12,
                        fontWeight: 800,
                        padding: "5px 10px",
                        boxShadow: item.images_crawled_at
                          ? "0 8px 18px rgba(29, 159, 102, 0.25)"
                          : "0 8px 18px rgba(199, 124, 20, 0.25)",
                      }}
                    >
                      {item.images_crawled_at ? "Crawled" : "更新中"}
                    </span>
                  </div>

                  <div className={styles.cardBody} style={{ padding: "14px 14px 12px" }}>
                    <h3
                      className={styles.mangaTitle}
                      style={{
                        margin: 0,
                        fontSize: 15,
                        lineHeight: 1.45,
                        fontWeight: 800,
                        color: "#f3f6fb",
                        minHeight: 22,
                        height: 22,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
                    </h3>

                    <p
                      className={styles.updatedAt}
                      style={{ margin: "8px 0 0", fontSize: 12, color: "#8ea1c9" }}
                    >
                      {new Date(item.updated_at).toLocaleDateString("ja-JP", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                    <p className={styles.chapterCount}>
                      {item.chapter_count} chapters
                    </p>
                  </div>
                </Link>

                {item.last_read_chapter_id ? (
                  <Link
                    className={styles.lastReadLink}
                    href={appPath(`/read/${item.last_read_chapter_id}`)}
                    title={
                      item.last_read_at
                        ? `Last read: ${new Date(
                            item.last_read_at
                          ).toLocaleString("ja-JP")}`
                        : undefined
                    }
                  >
                    続き: {item.last_read_chapter_name ?? "前回のチャプター"}
                  </Link>
                ) : (
                  <span className={styles.lastReadLink}>未読</span>
                )}

                <TitleCrawlButton
                  className={styles.titleCrawlAction}
                  initialChapterCount={item.chapter_count}
                  initialCrawledChapterCount={item.crawled_chapter_count}
                  initialStatus={item.crawl_status}
                  isDone={item.images_crawled_at !== null}
                  titleId={item.id}
                  titleHref={`/manga/${item.id}`}
                />
              </div>
            </article>
          ))}
        </section>

        <nav
          className={styles.pagination}
          aria-label="Pagination"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 24,
          }}
        >
          <Link
            href={pageHref(Math.max(1, safePage - 1))}
            aria-disabled={!canGoPrevious}
            style={paginationButtonStyle(!canGoPrevious)}
          >
            Previous
          </Link>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {firstVisiblePage > 1 && (
              <>
                <Link href={pageHref(1)} style={paginationButtonStyle(false)}>
                  1
                </Link>
                {firstVisiblePage > 2 && <span style={paginationEllipsisStyle}>...</span>}
              </>
            )}

            {pageNumbers.map((pageNumber) => (
              <Link
                key={pageNumber}
                href={pageHref(pageNumber)}
                aria-current={pageNumber === safePage ? "page" : undefined}
                style={paginationButtonStyle(false, pageNumber === safePage)}
              >
                {pageNumber}
              </Link>
            ))}

            {firstVisiblePage + visiblePageCount - 1 < totalPages && (
              <>
                {firstVisiblePage + visiblePageCount < totalPages && (
                  <span style={paginationEllipsisStyle}>...</span>
                )}
                <Link href={pageHref(totalPages)} style={paginationButtonStyle(false)}>
                  {totalPages}
                </Link>
              </>
            )}
          </div>

          <Link
            href={pageHref(Math.min(totalPages, safePage + 1))}
            aria-disabled={!canGoNext}
            style={paginationButtonStyle(!canGoNext)}
          >
            Next
          </Link>
        </nav>
      </div>
    </main>
  );
}

function paginationButtonStyle(disabled: boolean, active = false): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: active ? "1px solid rgba(94,163,255,0.4)" : "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(37, 64, 118, 0.8)" : "rgba(255,255,255,0.04)",
    color: "#eef3ff",
    textDecoration: "none",
    opacity: disabled ? 0.45 : 1,
    pointerEvents: disabled ? "none" : "auto",
    fontWeight: active ? 800 : 600,
    minWidth: 56,
    textAlign: "center",
  };
}

const paginationEllipsisStyle: React.CSSProperties = {
  minWidth: 32,
  display: "grid",
  placeItems: "center",
  color: "#8ea1c9",
};
