"use client";

import { useEffect, useState } from "react";
import PipelineScheduleSettings from "@video/components/PipelineScheduleSettings";
import styles from "@video/patterns/page.module.css";

export default function AutomationSettingsButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button type="button" className={styles.automationButton} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 5.2v-2.4l-2-.6a7.5 7.5 0 0 0-.7-1.7l1-1.8-1.7-1.7-1.8 1a7.5 7.5 0 0 0-1.7-.7l-.6-2h-2.4l-.6 2a7.5 7.5 0 0 0-1.7.7l-1.8-1L6.3 6.7l1 1.8a7.5 7.5 0 0 0-.7 1.7l-2 .6v2.4l2 .6a7.5 7.5 0 0 0 .7 1.7l-1 1.8 1.7 1.7 1.8-1a7.5 7.5 0 0 0 1.7.7l.6 2h2.4l.6-2a7.5 7.5 0 0 0 1.7-.7l1.8 1 1.7-1.7-1-1.8a7.5 7.5 0 0 0 .7-1.7l2-.6Z" />
        </svg>
        Automation
      </button>
      {open ? (
        <div className={styles.modalBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className={styles.automationModal} role="dialog" aria-modal="true" aria-labelledby="automation-title">
            <header className={styles.modalHeader}>
              <div>
                <p className="eyebrow">GRAMMAR_PATTERNS</p>
                <h2 id="automation-title">Automation Settings</h2>
              </div>
              <button type="button" className={styles.modalClose} aria-label="Close automation settings" onClick={() => setOpen(false)}>×</button>
            </header>
            <PipelineScheduleSettings mode="daily" />
            <PipelineScheduleSettings mode="interval" />
          </section>
        </div>
      ) : null}
    </>
  );
}
