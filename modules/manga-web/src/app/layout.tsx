import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manga Web",
  description: "Manga crawler and reading library.",
  icons: {
    icon: "/manga-web/images/logo.png",
    shortcut: "/manga-web/images/logo.png",
    apple: "/manga-web/images/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
