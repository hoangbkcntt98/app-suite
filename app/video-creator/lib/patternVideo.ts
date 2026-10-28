export type PatternVideoIdentity = {
  id: number;
  pattern: string;
  safeFileName?: string | null;
  videoPath?: string | null;
};

// Keep in sync with Python pipeline.make_safe_name.
export function grammarVideoFileName(pattern: PatternVideoIdentity) {
  return pattern.pattern.replace(/^[〜～]+/u, "")
    .replace(/[/／\s.,!?:;"']+/gu, "_")
    .replace(/_+/g, "_").replace(/^_|_$/g, "") || String(pattern.id);
}

export function findPatternVideo<T extends { relativePath: string; title: string }>(
  pattern: PatternVideoIdentity,
  videos: T[],
): T | null {
  const names = new Set([pattern.pattern, pattern.safeFileName, grammarVideoFileName(pattern)]);
  return videos.find((video) => {
    const name = video.relativePath.split("/").pop()?.replace(/(?:_video)?\.mp4$/i, "");
    return video.relativePath === pattern.videoPath
      || pattern.videoPath?.endsWith(`/${video.relativePath}`)
      || names.has(name) || video.title === pattern.pattern;
  }) ?? null;
}
