export type ImageAiProvider = "openclaw";

export type ImageAiSelection = {
  provider: ImageAiProvider;
  model: string;
};

export type ImageAiModelOption = ImageAiSelection & {
  label: string;
};

function parseModels(value: string | undefined) {
  return Array.from(
    new Set(
      (value || "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
    )
  );
}

export function getImageAiModelOptions(): ImageAiModelOption[] {
  const defaultModel = process.env.MANGA_OPENCLAW_MODEL?.trim() || "openclaw";
  const models = parseModels(process.env.MANGA_OPENCLAW_MODELS);
  if (!models.length) models.push(defaultModel);
  if (!models.includes(defaultModel)) models.unshift(defaultModel);

  return models.map((model) => ({
    provider: "openclaw",
    model,
    label: `OpenClaw - ${model}`,
  }));
}

export function getDefaultImageAiSelection(): ImageAiSelection {
  const model = process.env.MANGA_OPENCLAW_MODEL?.trim() || "openclaw";
  return { provider: "openclaw", model };
}

export function resolveImageAiSelection(
  provider?: string,
  model?: string
): ImageAiSelection {
  if (provider && provider !== "openclaw") {
    throw new Error("AI provider or model is not configured.");
  }

  const selectedModel =
    model?.trim() || process.env.MANGA_OPENCLAW_MODEL?.trim() || "openclaw";
  if (
    selectedModel.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(selectedModel)
  ) {
    throw new Error("OpenClaw model name is invalid.");
  }

  return { provider: "openclaw", model: selectedModel };
}
