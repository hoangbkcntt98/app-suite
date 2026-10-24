import Link from "next/link";
import "./globals.css";

const apps = [
  {
    id: "01",
    name: "Manga Web",
    category: "ĐỌC & KHÁM PHÁ",
    description: "Thư viện truyện, lịch sử đọc và công cụ dịch.",
    href: "/manga-web",
    tone: "manga",
    mark: "漫",
    action: "Mở thư viện",
  },
  {
    id: "02",
    name: "LifeQuest",
    category: "MỤC TIÊU & THÓI QUEN",
    description: "Biến việc cần làm thành hành trình tiến bộ mỗi ngày.",
    href: "/lifequest",
    tone: "quest",
    mark: "✳",
    action: "Xem hành trình",
  },
  {
    id: "03",
    name: "Video Creator",
    category: "SÁNG TẠO VIDEO",
    description: "Lên lịch, dựng nội dung và quản lý video.",
    href: "/video-creator",
    tone: "video",
    mark: "▶",
    action: "Mở studio",
  },
];

export default function Home() {
  return (
    <main className="hub-shell">
      <div className="hub-content">
        <header className="topbar">
          <Link className="wordmark" href="/" aria-label="Northstar - Trang chủ">
            <span className="wordmark-star">N</span>
            <span>NORTHSTAR</span>
          </Link>
          <span className="topbar-note">KHÔNG GIAN CỦA BẠN</span>
        </header>

        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow">MỌI THỨ BẠN CẦN, Ở ĐÚNG CHỖ</p>
            <h1>
              Một nơi cho
              <br />
              <em>mọi dự định.</em>
            </h1>
            <p className="intro-description">
              Đọc điều hay. Tiến gần mục tiêu. Tạo nên điều mới.
            </p>
          </div>
          <div className="orbit" aria-hidden="true">
            <span className="orbit-core">N</span>
            <span className="orbit-label orbit-label-a">ĐỌC</span>
            <span className="orbit-label orbit-label-b">TIẾN</span>
            <span className="orbit-label orbit-label-c">TẠO</span>
          </div>
        </section>

        <section className="apps-section" aria-labelledby="apps-heading">
          <div className="section-heading">
            <div>
              <p className="section-kicker">BẮT ĐẦU TỪ ĐÂY</p>
              <h2 id="apps-heading">Không gian của bạn</h2>
            </div>
            <span>03 ỨNG DỤNG</span>
          </div>
          <div className="app-grid">
            {apps.map((app) => (
              <Link
                href={app.href}
                className={`app-card ${app.tone}`}
                key={app.id}
                aria-label={`${app.action}: ${app.name}`}
              >
                <div className="card-topline">
                  <span>{app.id} <i>/</i> {app.category}</span>
                  <span className="card-mark" aria-hidden="true">{app.mark}</span>
                </div>
                <div className="card-copy">
                  <h3>{app.name}</h3>
                  <p>{app.description}</p>
                </div>
                <span className="card-link">
                  {app.action}<span aria-hidden="true">↗</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <footer className="footer">
          <span>ĐỌC · TIẾN BỘ · SÁNG TẠO</span>
          <span className="footer-mark">NORTHSTAR / 2026</span>
        </footer>
      </div>
    </main>
  );
}
