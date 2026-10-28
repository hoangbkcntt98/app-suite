import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Creator",
  description: "JLPT N1 video pipeline dashboard.",
};

export default function VideoCreatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="video-creator-shell">{children}</div>;
}
