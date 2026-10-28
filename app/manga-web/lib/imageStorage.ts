import { mkdir, rm } from "fs/promises";
import { dirname, resolve, sep } from "path";

export const imageStorageRoot = resolve(
  process.env.MANGA_IMAGE_STORAGE || "/home/opc/manga-storage"
);

export function resolveImageStorageRoot(path?: string | null) {
  return resolve(path?.trim() || imageStorageRoot);
}

function isInsideStorage(path: string, roots: string[]) {
  return roots.some((root) => path.startsWith(`${root}${sep}`));
}

export async function removeStoredChapterImages(
  paths: string[],
  storageRoots: string[] = [imageStorageRoot]
) {
  const roots = Array.from(
    new Set([imageStorageRoot, ...storageRoots].map((root) => resolveImageStorageRoot(root)))
  );
  const chapterDirectories = new Set(
    paths
      .map((path) => dirname(resolve(path)))
      .filter((path) => isInsideStorage(path, roots))
  );
  await Promise.all(
    Array.from(chapterDirectories, (path) =>
      rm(path, { force: true, recursive: true })
    )
  );
}

export async function clearStoredChapterImages() {
  const chaptersPath = resolve(imageStorageRoot, "chapters");
  await rm(chaptersPath, { force: true, recursive: true });
  await mkdir(chaptersPath, { recursive: true });
}
