export const BASE_PATH = process.env.NEXT_PUBLIC_MANGA_BASE_PATH ?? "";

export function appPath(path: string) {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) {
    return path;
  }

  return path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
}

export const apiPath = appPath;

export function routerPath(path: string) {
  if (!BASE_PATH || !path.startsWith(BASE_PATH)) return path;
  const withoutBasePath = path.slice(BASE_PATH.length);
  return withoutBasePath.startsWith("/") ? withoutBasePath : "/";
}
