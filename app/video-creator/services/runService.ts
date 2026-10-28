import { normalizeOutputVideo, parseOutputVideo } from "@video/lib/pipeline";
import { getRunLogRecord, listRecentRuns, saveRecoveredOutputVideo } from "@video/repositories/runRepository";
import type { Run, RunLogRecord } from "@video/models/run";
import { promises as fs } from "node:fs";
import path from "node:path";
import { appConfig } from "@video/lib/config";
import { startGeneration } from "@video/lib/pipeline";

export async function startGenerationRun(input: Parameters<typeof startGeneration>[0]) {
  return startGeneration(input);
}

const MAX_LOG_BYTES = 160_000;

function safeLogPath(logPath: string) {
  const root = path.resolve(appConfig.logDir(), "video-creator", "runs");
  const target = path.resolve(logPath);
  if (!target.startsWith(`${root}${path.sep}`) || path.extname(target) !== ".log") {
    throw new Error("Đường dẫn log không hợp lệ.");
  }
  return target;
}

async function readLogTail(logPath: string) {
  const filePath = safeLogPath(logPath);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return "Chưa có dữ liệu log.";
  const length = Math.min(stat.size, MAX_LOG_BYTES);
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    const prefix = stat.size > MAX_LOG_BYTES ? "... log cũ hơn đã ẩn ...\n" : "";
    return prefix + buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function listRuns(): Promise<Run[]> {
  const runs = await listRecentRuns();
  return Promise.all(runs.map(async (run) => {
    if (run.status !== "success") return run;
    if (run.output_video) {
      const normalized = normalizeOutputVideo(run.output_video);
      if (!normalized || normalized === run.output_video) return run;
      await saveRecoveredOutputVideo(run.id, normalized).catch(() => {});
      return { ...run, output_video: normalized };
    }
    const log = await fs.readFile(run.log_path, "utf8").catch(() => "");
    const outputVideo = parseOutputVideo(log);
    if (!outputVideo) return run;
    await saveRecoveredOutputVideo(run.id, outputVideo).catch(() => {});
    return { ...run, output_video: outputVideo };
  }));
}

export async function getRunLog(id: number): Promise<{ run: RunLogRecord; log: string } | null> {
  const run = await getRunLogRecord(id);
  if (!run) return null;
  const log = await readLogTail(run.log_path);
  run.output_video = run.output_video
    ? (normalizeOutputVideo(run.output_video) || run.output_video)
    : (parseOutputVideo(log) || null);
  return { run, log };
}
