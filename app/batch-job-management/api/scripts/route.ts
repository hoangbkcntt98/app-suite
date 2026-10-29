import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { hasBatchJobAccess } from "../../lib/server";

export const runtime = "nodejs";

const ROOT = process.cwd();
const JOBS_ROOT = path.join(ROOT, "jobs");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".venv",
  "node_modules",
  "__pycache__",
  "logs",
]);

async function findPythonScripts(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const scripts: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scripts.push(...(await findPythonScripts(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".py")) {
      scripts.push(path.relative(ROOT, fullPath).split(path.sep).join("/"));
    }
  }

  return scripts;
}

export async function GET() {
  if (!(await hasBatchJobAccess())) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  try {
    const scripts = await findPythonScripts(JOBS_ROOT);
    scripts.sort((left, right) => left.localeCompare(right));
    return NextResponse.json({ scripts });
  } catch {
    return NextResponse.json(
      { message: "Không đọc được danh sách Python file trong jobs/." },
      { status: 500 },
    );
  }
}
