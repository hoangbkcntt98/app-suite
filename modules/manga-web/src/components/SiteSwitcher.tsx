"use client";

import { appPath } from "@manga/lib/paths";
import { useRouter } from "next/navigation";

type SiteOption = {
  site_key: string;
  title_count: number;
};

export default function SiteSwitcher({
  currentSiteKey,
  crawledOnly,
  hasChaptersOnly,
  query,
  sort,
  sites,
  className,
}: {
  currentSiteKey: string;
  crawledOnly: boolean;
  hasChaptersOnly: boolean;
  query: string;
  sort: string;
  sites: SiteOption[];
  className?: string;
}) {
  const router = useRouter();

  function switchSite(siteKey: string) {
    const params = new URLSearchParams();
    params.set("site", siteKey);
    if (query) params.set("q", query);
    if (crawledOnly) params.set("filter", "crawled");
    if (hasChaptersOnly) params.set("chapters", "has");
    if (sort && sort !== "chapters_desc") params.set("sort", sort);
    router.push(appPath(`/?${params.toString()}`));
  }

  return (
    <label className={className}>
      <span>Switch Site</span>
      <select
        aria-label="Switch Site"
        onChange={(event) => switchSite(event.target.value)}
        value={currentSiteKey}
      >
        {sites.map((site) => (
          <option key={site.site_key} value={site.site_key}>
            {site.site_key} ({site.title_count})
          </option>
        ))}
      </select>
    </label>
  );
}
