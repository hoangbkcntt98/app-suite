import { appPath } from "@manga/lib/paths";
import Link from "next/link";
import { getCurrentUser } from "@manga/lib/auth";
import LogoutButton from "./LogoutButton";
import styles from "./SiteHeader.module.css";

export default async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.logo} href={appPath("/")}>
          Manga<span>Rw</span>
        </Link>

        <nav className={styles.nav}>
          <Link href={appPath("/")}>漫画リスト</Link>
          <Link href="#">ジャンル</Link>
          <Link href={appPath("/favorites")}>しおり</Link>
          <Link href={appPath("/history")}>読書履歴</Link>
          <Link href={appPath("/flashcards")}>Flash Cards</Link>
        </nav>

        <div className={styles.search}>⌕　マンガの名前を入力...</div>

        {user ? (
          <div className={styles.account}>
            <span>{user.username}</span>
            <LogoutButton className={styles.logoutButton} />
          </div>
        ) : null}

        <div className={styles.mobileActions} aria-hidden="true">
          <span>⌕</span>
          <span>☰</span>
        </div>
      </div>
    </header>
  );
}
