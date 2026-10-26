"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GrammarPattern } from "@video/lib/dashboard";

type Props = { patterns: GrammarPattern[] };
const basePath = process.env.NEXT_PUBLIC_VIDEO_CREATOR_BASE_PATH || "";

export default function DashboardControls({ patterns }: Props) {
  const router = useRouter();
  const [patternId, setPatternId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [router]);

  async function start(action: "create_next" | "generate_pattern") {
    setBusy(true);
    setMessage("");
    try {
      const selected = patterns.find((item) => String(item.id) === patternId);
      if (action !== "create_next" && !selected) throw new Error("Select a grammar pattern first.");
      const response = await fetch(`${basePath}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, patternId: selected?.id, patternName: selected?.pattern })
      });
      const body = await response.json() as { error?: string; run?: { id: number } };
      if (!response.ok) throw new Error(body.error || "Could not start pipeline.");
      setMessage(`Created pipeline run #${body.run?.id}. Page refreshes every 8 seconds.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "An error occurred.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="createPanel">
      <div>
        <p className="eyebrow">JLPT N1 Pipeline</p>
        <h1>Create Japanese Learning Video</h1>
        <p>App-suite Python job handles content, images, TTS, and MP4 rendering. Publishing stays separate.</p>
      </div>
      
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => start("create_next")}
        >
          {busy ? "Running..." : "Create Next Pattern"}
        </button>
        
        <select
          value={patternId}
          disabled={busy || !patterns.length}
          onChange={(e) => setPatternId(e.target.value)}
          aria-label="Grammar Patterns"
        >
          <option value="">Select Existing Pattern</option>
          {patterns.map((item) => (
            <option key={item.id} value={item.id}>
              #{item.id} · {item.pattern} · {item.processingStatus}
            </option>
          ))}
        </select>
        
        <button disabled={busy || !patterns.length} onClick={() => start("generate_pattern")}>
          Recreate Selected Pattern
        </button>
      </div>
      
      {message && <p className="runMessage" role="status">{message}</p>}
    </section>
  );
}
