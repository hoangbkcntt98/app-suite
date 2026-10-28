export type ImageAiProvider = "openclaw" | "bedrock";

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
  const openClawDefault = process.env.MANGA_OPENCLAW_MODEL || "openclaw";
  const openClawModels = parseModels(process.env.MANGA_OPENCLAW_MODELS);
  if (!openClawModels.length) openClawModels.push(openClawDefault);

  const bedrockDefault = process.env.MANGA_BEDROCK_DEFAULT_MODEL?.trim();
  const bedrockModels = parseModels(process.env.MANGA_BEDROCK_MODELS);
  if (bedrockDefault && !bedrockModels.includes(bedrockDefault)) {
    bedrockModels.unshift(bedrockDefault);
  }

  return [
    ...openClawModels.map((model) => ({
      provider: "openclaw" as const,
      model,
      label: `OpenClaw - ${model}`,
    })),
    ...bedrockModels.map((model) => ({
      provider: "bedrock" as const,
      model,
      label: `Amazon Bedrock - ${model}`,
    })),
  ];
}

export function getDefaultImageAiSelection(): ImageAiSelection {
  const options = getImageAiModelOptions();
  const configuredProvider = process.env.MANGA_AI_TRANSLATION_PROVIDER?.trim();
  const configuredModel =
    configuredProvider === "bedrock"
      ? process.env.MANGA_BEDROCK_DEFAULT_MODEL?.trim()
      : process.env.MANGA_OPENCLAW_MODEL?.trim();
  const configured = options.find(
    (option) =>
      option.provider === configuredProvider &&
      (!configuredModel || option.model === configuredModel)
  );

  const selection = configured ?? options[0];
  return { provider: selection.provider, model: selection.model };
}

export function resolveImageAiSelection(
  provider?: string,
  model?: string
): ImageAiSelection {
  const defaultSelection = getDefaultImageAiSelection();
  if (!provider && !model) return defaultSelection;

  const selectedProvider = provider || defaultSelection.provider;
  if (selectedProvider === "openclaw") {
    const selectedModel = model?.trim() || process.env.MANGA_OPENCLAW_MODEL || "openclaw";
    if (
      selectedModel.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(selectedModel)
    ) {
      throw new Error("OpenClaw model name is invalid.");
    }
    return { provider: "openclaw", model: selectedModel };
  }

  const selected = getImageAiModelOptions().find(
    (option) =>
      option.provider === "bedrock" &&
      option.model ===
        (model || process.env.MANGA_BEDROCK_DEFAULT_MODEL?.trim())
  );
  if (!selected) {
    throw new Error("AI provider or model is not configured.");
  }

  return { provider: selected.provider, model: selected.model };
}

export function getStoredAiModel(selection: ImageAiSelection) {
  return selection.provider === "bedrock"
    ? `bedrock:${selection.model}`
    : selection.model;
}
