export const BASE_PATH = process.env.NEXT_PUBLIC_LIFEQUEST_BASE_PATH ?? "";

export function appPath(path: string) {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) {
    return path;
  }

  return path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
}

export const apiPath = appPath;
