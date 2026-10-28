"use client";

import { appPath } from "@manga/lib/paths";
import { useRouter } from "next/navigation";

type ChapterOption = {
  id: string;
  name: string;
};

export default function ChapterSelect({
  chapters,
  className,
  currentChapterId,
}: {
  chapters: ChapterOption[];
  className?: string;
  currentChapterId: string;
}) {
  const router = useRouter();

  return (
    <select
      aria-label="Select chapter"
      className={className}
      value={currentChapterId}
      onChange={(event) => router.push(appPath(`/read/${event.target.value}`))}
    >
      {chapters.map((chapter) => (
        <option key={chapter.id} value={chapter.id}>
          {chapter.name}
        </option>
      ))}
    </select>
  );
}
