import { promises as fs } from "node:fs";
import path from "node:path";
import { appConfig } from "@video/lib/config";

export function wordCreatorMascotUploadPath() {
  return path.join(appConfig.dataDir(), "word-creator", "assets", "spinning-bear.gif");
}

export function wordCreatorMascotBundledPath() {
  return path.join(appConfig.appRoot(), "src", "lib", "wordCreator", "template", "spinning-bear.gif");
}

export async function currentWordCreatorMascotPath() {
  const uploaded = wordCreatorMascotUploadPath();
  if (await fs.stat(uploaded).then((stat) => stat.isFile()).catch(() => false)) return uploaded;
  const bundled = wordCreatorMascotBundledPath();
  if (await fs.stat(bundled).then((stat) => stat.isFile()).catch(() => false)) return bundled;
  return null;
}
