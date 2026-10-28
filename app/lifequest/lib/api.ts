import { apiPath } from "@lifequest/lib/paths";

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(apiPath(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
  });

  const raw = await response.text();
  let data: { message?: unknown } | null = null;
  try {
    data = raw ? (JSON.parse(raw) as { message?: unknown }) : null;
  } catch {
    // Reverse proxies can return a non-JSON error page.
  }

  if (!response.ok) {
    throw new Error(
      typeof data?.message === "string"
        ? data.message
        : `Request failed (${response.status})`
    );
  }

  return data as T;
}
