import Link from "next/link";
import "./globals.css";

const apps = [
  {
    id: "01",
    name: "Manga Web",
    type: "READING LIBRARY",
    description:
      "Kho truyện, lịch sử đọc và công cụ dịch — tiếp tục đúng chương đang dang dở.",
    href: "/manga-web",
    tone: "manga",
    mark: "漫",
    action: "Mở thư viện",
  },
  {
    id: "02",
    name: "LifeQuest",
    type: "PERSONAL QUEST",
    description:
      "Biến việc cần làm thành nhiệm vụ, theo dõi tiến độ và giữ nhịp mỗi ngày.",
    href: "/lifequest",
    tone: "quest",
    mark: "✳",
    action: "Vào hành trình",
  },
  {
    id: "03",
    name: "Video Creator",
    type: "CREATIVE STUDIO",
    description:
      "Lên lịch, dựng nội dung và quản lý video trong cùng một quy trình sáng tạo.",
    href: "/video-creator",
    tone: "video",
    mark: "▶",
    action: "Mở studio",
  },
  {
    id: "04",
    name: "Little Agents Village",
    type: "AGENT SIMULATION",
    description:
      "Quan sát đội agent tí hon phối hợp qua một sprint phần mềm mô phỏng.",
    href: "/little-agents-village",
    tone: "agents",
    mark: "✿",
    action: "Vào ngôi làng",
  },
];

export default function Home() {
  return (
    <main className="hub-shell canvas">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="Northstar home">
          <span className="wordmark-star">N</span>
          <span>NORTHSTAR</span>
        </Link>
        <div className="topbar-note">
          <span className="live-dot" />
          <span>KHÔNG GIAN CỦA BẠN</span>
        </div>
      </header>

      <section className="intro">
        <div className="intro-copy">
          <p className="eyebrow">ONE WORKSPACE · FOUR WORLDS</p>
          <h1>
            Mỗi thứ
            <br />
            <em>đúng chỗ.</em>
          </h1>
          <p className="intro-description">
            Đọc một chút. Tiến thêm một bước. Tạo nên điều gì đó.
            <br className="desktop-break" /> Tất cả bắt đầu từ đây.
          </p>
        </div>
        <div className="orbit" aria-hidden="true">
          <span className="orbit-core">N</span>
          <span className="orbit-label orbit-label-a">READ</span>
          <span className="orbit-label orbit-label-b">GROW</span>
          <span className="orbit-label orbit-label-c">MAKE</span>
        </div>
      </section>

      <section className="apps-section" aria-labelledby="apps-heading">
        <div className="section-heading">
          <h2 id="apps-heading">Chọn điểm đến</h2>
          <span>04 MODULES</span>
        </div>
        <div className="app-grid">
          {apps.map((app) => (
            <article className={`app-card ${app.tone}`} key={app.id}>
              <div className="card-topline">
                <span>{app.id} / {app.type}</span>
                <span className="card-arrow" aria-hidden="true">↗</span>
              </div>
              <div className="app-mark" aria-hidden="true">{app.mark}</div>
              <div className="card-copy">
                <h3>{app.name}</h3>
                <p>{app.description}</p>
              </div>
              <Link href={app.href} className="card-link">
                {app.action}<span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>FOUR TOOLS. ONE PLACE TO BEGIN.</span>
        <span className="footer-mark">NORTHSTAR / 2026</span>
      </footer>
    </main>
  );
}
