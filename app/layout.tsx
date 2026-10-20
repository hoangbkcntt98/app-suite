import type { Metadata } from "next";
import "./base.css";

export const metadata: Metadata = {
  title: "Northstar | Workspace",
  description: "Một không gian chung cho manga, mục tiêu và video.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
