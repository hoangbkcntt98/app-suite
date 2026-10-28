export const REQUIRED_CONFIG_PATHS = [
  "site_key",
  "base_url",
  "list.url",
  "list.item_selector",
  "list.title",
  "list.href",
  "list.image",
  "detail.chapters.link_selector",
  "detail.chapters.title_sources",
  "reader.image_selector",
];

export type SiteConfig = Record<string, unknown> & {
  site_key?: unknown;
};

function hasPath(config: SiteConfig, path: string) {
  let node: unknown = config;
  for (const part of path.split(".")) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      !(part in node)
    ) {
      return false;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return node !== null && node !== "";
}

export function validateSiteConfig(config: SiteConfig) {
  const missing = REQUIRED_CONFIG_PATHS.filter(
    (path) => !hasPath(config, path)
  );
  const siteKey =
    typeof config.site_key === "string" ? config.site_key.trim() : "";

  if (missing.length > 0) {
    return {
      error: `必須設定が不足しています: ${missing.join(", ")}`,
      siteKey,
    };
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(siteKey)) {
    return {
      error:
        "site_keyは2〜64文字の英数字、ハイフン、アンダースコアで入力してください。",
      siteKey,
    };
  }

  return { error: null, siteKey };
}
