import { appPath } from "@video/lib/paths";
import Link from "next/link";
import AppSwitcher from "@video/components/AppSwitcher";
import LogoutButton from "@video/components/LogoutButton";
import WordCreator from "@video/components/WordCreator";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default function WordCreatorPage() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><span className={styles.mark}>VC</span><div><strong>Video Creator</strong><small>WordCreator · Anki AI notes</small></div></div>
      <nav className={styles.actions}><Link href={appPath("/")}>Dashboard</Link><Link href={appPath("/studio")}>Video Studio</Link><Link href={appPath("/library")}>Library</Link><AppSwitcher /><LogoutButton /></nav>
    </header>
    <section className={styles.content}>
      <div className={styles.heading}><div><p className="eyebrow">WORDCREATOR</p><h1>Tạo câu hỏi đọc Kanji</h1><p>Lấy RequiredVocabulary từ database anki, gọi AI tạo đáp án, sinh file HTML từ template.html.</p></div><span className={styles.badge}>ANKI + AI</span></div>
      <WordCreator />
    </section>
  </main>;
}
