"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AppSelect from "@/components/AppSelect";
import { apiPath, appPath } from "@manga/lib/paths";
import ThemeToggle from "./ThemeToggle";
import styles from "./HomeHeaderActions.module.css";

export default function HomeHeaderActions({
  initialQuery,
  crawledOnly,
  hasChaptersOnly,
  siteKey,
  sort,
  username,
}: {
  initialQuery: string;
  crawledOnly: boolean;
  hasChaptersOnly: boolean;
  siteKey: string;
  sort: string;
  username: string | null;
}) {
  const router = useRouter();
  const [mobilePanel, setMobilePanel] = useState<"search" | "menu" | null>(null);

  function togglePanel(panel: "search" | "menu") {
    setMobilePanel((current) => (current === panel ? null : panel));
  }

  async function logout() {
    await fetch(apiPath("/api/auth/logout"), { method: "POST" });
    router.replace(appPath("/login"));
    router.refresh();
  }

  return (
    <div className={styles.actions}>
      <form action={appPath("/")} className={styles.desktopSearch} method="get">
        <input name="site" type="hidden" value={siteKey} />
        {crawledOnly ? <input name="filter" type="hidden" value="crawled" /> : null}
        {hasChaptersOnly ? (
          <input name="chapters" type="hidden" value="has" />
        ) : null}
        {sort !== "chapters_desc" ? (
          <input name="sort" type="hidden" value={sort} />
        ) : null}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          aria-label="Search manga"
          defaultValue={initialQuery}
          name="q"
          placeholder="マンガの名前を入力..."
          type="search"
        />
      </form>

      <ThemeToggle />
      <AppSelect current="manga-web" />

      <div className={styles.desktopProfile}>
        {username ? <span>{username}</span> : null}
        <button onClick={logout} type="button">
          Logout
        </button>
      </div>

      <div className={styles.mobileActions}>
        <button
          aria-expanded={mobilePanel === "search"}
          aria-label="Search"
          className={styles.iconButton}
          onClick={() => togglePanel("search")}
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
        <button
          aria-expanded={mobilePanel === "menu"}
          aria-label="Open menu"
          className={styles.iconButton}
          onClick={() => togglePanel("menu")}
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {mobilePanel === "search" && (
        <form action={appPath("/")} className={styles.mobileSearch} method="get">
          <input name="site" type="hidden" value={siteKey} />
          {crawledOnly ? <input name="filter" type="hidden" value="crawled" /> : null}
          {hasChaptersOnly ? (
            <input name="chapters" type="hidden" value="has" />
          ) : null}
          {sort !== "chapters_desc" ? (
            <input name="sort" type="hidden" value={sort} />
          ) : null}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            autoFocus
            aria-label="Search manga"
            defaultValue={initialQuery}
            name="q"
            placeholder="マンガの名前を入力..."
            type="search"
          />
        </form>
      )}

      {mobilePanel === "menu" && (
        <nav className={styles.mobileMenu} aria-label="Mobile navigation">
          <Link href={appPath("/")} onClick={() => setMobilePanel(null)}>
            サイト
          </Link>
          <Link href={appPath("/")} onClick={() => setMobilePanel(null)}>
            Config regist
          </Link>
          <Link
            href={appPath(`/?site=${encodeURIComponent(siteKey)}`)}
            onClick={() => setMobilePanel(null)}
          >
            漫画リスト
          </Link>
          <Link href="#" onClick={() => setMobilePanel(null)}>
            ジャンル
          </Link>
          <Link href={appPath("/favorites")} onClick={() => setMobilePanel(null)}>
            しおり
          </Link>
          <Link href={appPath("/history")} onClick={() => setMobilePanel(null)}>
            読書履歴
          </Link>
          <Link href={appPath("/flashcards")} onClick={() => setMobilePanel(null)}>
            Flash Cards
          </Link>
          <button onClick={logout} type="button">
            Logout
          </button>
        </nav>
      )}
    </div>
  );
}
