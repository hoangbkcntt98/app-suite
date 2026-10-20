import type { Metadata } from "next";
import "@manga/app/globals.css";

export const metadata: Metadata = {
  title: "Manga Web",
  description: "Manga crawler and reading library.",
  icons: {
    icon: "/manga-web/images/logo.png",
    shortcut: "/manga-web/images/logo.png",
    apple: "/manga-web/images/logo.png",
  },
};

export default function MangaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="manga-web-shell">{children}</div>;
}
