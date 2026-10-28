import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import MoveToTopButton from "@lifequest/components/MoveToTopButton";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LifeQuest",
  description: "Level up your real-life habits with daily quests.",
  icons: {
    icon: "/lifequest/images/logo.png",
    shortcut: "/lifequest/images/logo.png",
    apple: "/lifequest/images/logo.png",
  },
};

export default function LifeQuestLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`lifequest-shell ${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
    >
      {children}
      <MoveToTopButton />
    </div>
  );
}
