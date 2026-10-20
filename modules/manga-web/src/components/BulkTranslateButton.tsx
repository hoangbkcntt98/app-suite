"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiPath } from "@manga/lib/paths";

type BulkStatus = "idle" | "running" | "completed" | "failed" | "stopped";

type AiModelOption = {
  label: string;
  model: string;
  provider: "openclaw" | "bedrock";
};

type AiConfigResponse = {
  defaultSelection?: Pick<AiModelOption, "model" | "provider">;
  models?: AiModelOption[];
};

function selectedAiRequest(
  models: AiModelOption[],
  selectedIndex: number,
  openClawModel: string
) {
  const selected = models[selectedIndex] ?? models[0];
  const customModel = openClawModel.trim();
  return {
    provider: selected?.provider,
    ...(selected?.provider === "openclaw"
      ? { model: customModel || selected.model }
      : { model: selected?.model }),
  };
}

function bulkStatusUrl(
  titleId: string,
  models: AiModelOption[],
  selectedIndex: number,
  openClawModel: string
) {
  const selection = selectedAiRequest(
    models,
    selectedIndex,
    openClawModel
  );
  const search = new URLSearchParams();
  if (selection.provider) search.set("provider", selection.provider);
  if (selection.model) search.set("model", selection.model);
  return `${apiPath(`/api/titles/${titleId}/bulk-translate`)}?${search}`;
}

export default function BulkTranslateButton({
  className,
  initialTotalCount,
  initialTranslatedCount,
  titleId,
}: {
  className?: string;
  initialTotalCount: number;
  initialTranslatedCount: number;
  titleId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<BulkStatus>("idle");
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [processedCount, setProcessedCount] = useState(initialTranslatedCount);
  const [translatedCount, setTranslatedCount] = useState(
    initialTranslatedCount
  );
  const [failedCount, setFailedCount] = useState(0);
  const [message, setMessage] = useState("");
  const [resetting, setResetting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiModels, setAiModels] = useState<AiModelOption[]>([
    { label: "OpenClaw - openclaw", model: "openclaw", provider: "openclaw" },
  ]);
  const [selectedAiModel, setSelectedAiModel] = useState(0);
  const [openClawModel, setOpenClawModel] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAiConfig() {
      try {
        const response = await fetch(apiPath("/api/ai/config"), {
          cache: "no-store",
        });
        const data = (await response.json()) as AiConfigResponse;
        if (!response.ok || !data.models?.length || cancelled) return;

        setAiModels(data.models);
        const defaultIndex = data.models.findIndex(
          (option) =>
            option.provider === data.defaultSelection?.provider &&
            option.model === data.defaultSelection?.model
        );
        setSelectedAiModel(defaultIndex >= 0 ? defaultIndex : 0);
      } catch {
        // Keep the OpenClaw fallback when config loading fails.
      }
    }

    void loadAiConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setStatus("idle");
      setTotalCount(initialTotalCount);
      setProcessedCount(initialTranslatedCount);
      setTranslatedCount(initialTranslatedCount);
      setFailedCount(0);
      setMessage("");

      try {
        const response = await fetch(
          bulkStatusUrl(
            titleId,
            aiModels,
            selectedAiModel,
            openClawModel
          ),
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Could not load translate progress");
        }
        if (cancelled) return;

        setStatus(data.status ?? "idle");
        setTotalCount(data.totalCount ?? initialTotalCount);
        setProcessedCount(data.processedCount ?? initialTranslatedCount);
        setTranslatedCount(data.translatedCount ?? initialTranslatedCount);
        setFailedCount(data.failedCount ?? 0);
        setMessage(data.failedCount && data.error ? data.error : "");
        if (data.status === "running" && data.provider && data.model) {
          const modelIndex = aiModels.findIndex(
            (option) =>
              option.provider === data.provider && option.model === data.model
          );
          if (modelIndex >= 0) {
            setSelectedAiModel(modelIndex);
            setOpenClawModel("");
          } else if (data.provider === "openclaw") {
            const openClawIndex = aiModels.findIndex(
              (option) => option.provider === "openclaw"
            );
            if (openClawIndex >= 0) setSelectedAiModel(openClawIndex);
            setOpenClawModel(data.model);
          }
        }
      } catch (error) {
        if (cancelled) return;
        setStatus("failed");
        setMessage(
          error instanceof Error ? error.message : "Bulk translate failed"
        );
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [
    aiModels,
    initialTotalCount,
    initialTranslatedCount,
    openClawModel,
    selectedAiModel,
    titleId,
  ]);

  useEffect(() => {
    if (status !== "running") return;
    let cancelled = false;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(
          bulkStatusUrl(
            titleId,
            aiModels,
            selectedAiModel,
            openClawModel
          ),
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "Could not load translate progress");
        }
        if (cancelled) return;

        setStatus(data.status);
        setTotalCount(data.totalCount ?? 0);
        setProcessedCount(data.processedCount ?? 0);
        setTranslatedCount(data.translatedCount ?? 0);
        setFailedCount(data.failedCount ?? 0);

        if (data.status === "failed" || (data.failedCount && data.error)) {
          setMessage(data.error || "Bulk translate failed");
        }

        if (data.status !== "running") {
          router.refresh();
        }
      } catch (error) {
        if (cancelled) return;
        setStatus("failed");
        setMessage(
          error instanceof Error ? error.message : "Bulk translate failed"
        );
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [aiModels, openClawModel, router, selectedAiModel, status, titleId]);

  async function startBulkTranslate() {
    setStatus("running");
    setMessage("");
    setProcessedCount(translatedCount);
    setFailedCount(0);

    try {
      const response = await fetch(
        apiPath(`/api/titles/${titleId}/bulk-translate`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            selectedAiRequest(aiModels, selectedAiModel, openClawModel)
          ),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Bulk translate failed");
      }

      setTotalCount(data.totalCount ?? totalCount);
      setProcessedCount(data.processedCount ?? 0);
      setTranslatedCount(data.translatedCount ?? translatedCount);
      setFailedCount(data.failedCount ?? 0);
      setMessage(data.failedCount && data.error ? data.error : "");
      setStatus(data.status === "running" ? "running" : "running");
    } catch (error) {
      setStatus("failed");
      setMessage(
        error instanceof Error ? error.message : "Bulk translate failed"
      );
    }
  }

  async function stopBulkTranslate() {
    setMessage("Stopping...");

    try {
      const response = await fetch(
        apiPath(`/api/titles/${titleId}/bulk-translate`),
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Stop translate failed");
      }

      setStatus(data.status ?? "stopped");
      setTotalCount(data.totalCount ?? totalCount);
      setProcessedCount(data.processedCount ?? translatedCount);
      setTranslatedCount(data.translatedCount ?? translatedCount);
      setFailedCount(data.failedCount ?? 0);
      setMessage(data.error || "Stopped by user");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Stop translate failed"
      );
    }
  }

  async function resetTranslations() {
    const confirmed = window.confirm(
      "このタイトルのAI画像翻訳をすべて削除します。続行しますか？"
    );
    if (!confirmed) return;

    setResetting(true);
    setMessage("Resetting translations...");

    try {
      const response = await fetch(
        apiPath(`/api/titles/${titleId}/bulk-translate`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reset",
            confirmation: "RESET_TITLE_TRANSLATIONS",
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Reset translations failed");
      }

      setStatus("idle");
      setTotalCount(data.totalCount ?? totalCount);
      setProcessedCount(0);
      setTranslatedCount(0);
      setFailedCount(0);
      setMessage(
        `${data.deletedCount ?? 0} translation${
          data.deletedCount === 1 ? "" : "s"
        } deleted`
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Reset translations failed"
      );
    } finally {
      setResetting(false);
    }
  }

  const running = status === "running";
  const done = totalCount > 0 && translatedCount >= totalCount;
  const selectedModel = aiModels[selectedAiModel] ?? aiModels[0];
  const activeModel =
    selectedModel?.provider === "openclaw"
      ? openClawModel.trim() || selectedModel.model
      : selectedModel?.model;
  const modelSummary = selectedModel
    ? `${selectedModel.provider === "openclaw" ? "OpenClaw" : "Amazon Bedrock"} - ${activeModel}`
    : "AI model unavailable";

  return (
    <div className={className}>
      <div className="bulkTranslateButtons">
        <button
          data-done={done}
          disabled={running || totalCount === 0}
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          {running
            ? `Translating ${processedCount}/${totalCount}`
            : "Bulk Translate"}
        </button>
        {running && (
          <button
            data-variant="stop"
            onClick={stopBulkTranslate}
            type="button"
          >
            Stop
          </button>
        )}
        <button
          data-variant="reset"
          disabled={running || resetting || translatedCount === 0}
          onClick={resetTranslations}
          type="button"
        >
          {resetting ? "Resetting..." : "Reset translations"}
        </button>
      </div>
      <small className="bulkTranslateModelSummary">Model: {modelSummary}</small>
      <small className="bulkTranslateStatus">
        {message ||
          `${translatedCount}/${totalCount} translated${
            failedCount ? `, ${failedCount} failed` : ""
          }`}
      </small>
      {settingsOpen ? (
        <div
          className="bulkTranslateModalBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            aria-labelledby="bulk-translate-settings-title"
            aria-modal="true"
            className="bulkTranslateModal"
            role="dialog"
          >
            <div className="bulkTranslateModalHeader">
              <div>
                <h2 id="bulk-translate-settings-title">Bulk Translate</h2>
                <p>Select the AI model for this translation job.</p>
              </div>
              <button
                aria-label="Close bulk translation settings"
                data-variant="modal-close"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                &times;
              </button>
            </div>

            <div className="bulkTranslateModelControls">
              <label>
                <span>AI model</span>
                <select
                  aria-label="Bulk translation AI model"
                  autoFocus
                  onChange={(event) => {
                    const nextIndex = Number(event.target.value);
                    const nextSelection = aiModels[nextIndex];
                    setSelectedAiModel(nextIndex);
                    if (nextSelection?.provider === "openclaw") {
                      setOpenClawModel("");
                    }
                  }}
                  value={selectedAiModel}
                >
                  {aiModels.map((option, index) => (
                    <option
                      key={`${option.provider}-${option.model}`}
                      value={index}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedModel?.provider === "openclaw" ? (
                <label>
                  <span>OpenClaw model (optional)</span>
                  <input
                    aria-label="Bulk translation custom OpenClaw model"
                    maxLength={200}
                    onChange={(event) => setOpenClawModel(event.target.value)}
                    placeholder={`Default: ${selectedModel.model}`}
                    type="text"
                    value={openClawModel}
                  />
                </label>
              ) : null}
            </div>

            <div className="bulkTranslateModalActions">
              <button
                data-variant="cancel"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  void startBulkTranslate();
                }}
                type="button"
              >
                Start translation
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
