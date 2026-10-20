"use client";

import { useMemo, useState } from "react";

const placeholderSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#1b2340"/>
      <stop offset="55%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#0b1020"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" x2="1">
      <stop offset="0%" stop-color="#5ea3ff"/>
      <stop offset="100%" stop-color="#63d7a5"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <circle cx="300" cy="290" r="110" fill="rgba(94,163,255,0.12)" stroke="rgba(148,179,235,0.32)" stroke-width="6"/>
  <path d="M225 335c35-70 62-105 92-105 37 0 54 48 86 105" fill="none" stroke="url(#mark)" stroke-width="22" stroke-linecap="round"/>
  <rect x="130" y="470" width="340" height="22" rx="11" fill="rgba(255,255,255,0.18)"/>
  <rect x="170" y="520" width="260" height="18" rx="9" fill="rgba(255,255,255,0.12)"/>
  <text x="300" y="620" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="800" fill="#dce7ff">MangaRw</text>
</svg>`;

export default function TitleCoverImage({
  alt,
  className,
  src,
}: {
  alt: string;
  className?: string;
  src: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const placeholderSrc = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(placeholderSvg)}`,
    []
  );
  const imageSrc = !src || failed ? placeholderSrc : src;

  return (
    <img
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      src={imageSrc}
      style={{
        width: "100%",
        aspectRatio: "3 / 4",
        objectFit: "cover",
        display: "block",
      }}
    />
  );
}
