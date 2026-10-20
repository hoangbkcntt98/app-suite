"use client";

import { useEffect } from "react";
import { apiPath } from "@manga/lib/paths";

export default function ReadingHistoryTracker({
  chapterId,
}: {
  chapterId: string;
}) {
  useEffect(() => {
    void fetch(apiPath(`/api/history/${chapterId}`), { method: "POST" });
  }, [chapterId]);

  return null;
}
