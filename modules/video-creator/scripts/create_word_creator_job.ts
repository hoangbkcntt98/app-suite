import { loadEnvConfig } from "@next/env";
import { enqueueWordCreator, getWordCreatorJob, startWordCreatorWorker } from "@video/lib/wordCreator/jobs";

loadEnvConfig(process.cwd());

type Options = {
  sources: string[];
  durationSeconds?: number;
  fps: number;
  autoFps: boolean;
};

function parseArgs(args: string[]): Options {
  const options: Options = { sources: [], fps: 25, autoFps: true };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return next;
    };

    if (arg === "--source") options.sources.push(value().trim());
    else if (arg === "--duration") options.durationSeconds = Number(value());
    else if (arg === "--fps") options.fps = Number(value());
    else if (arg === "--fixed-fps") options.autoFps = false;
    else if (arg === "--help") {
      console.log("Usage: npx tsx modules/video-creator/scripts/create_word_creator_job.ts --source Kanji [--source Kanji ...] [--duration SECONDS] [--fps 1-60] [--fixed-fps]");
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.sources.length || options.sources.some((source) => !source)) {
    throw new Error("Pass at least one non-empty --source.");
  }
  if (options.sources.length > 100) throw new Error("Pass no more than 100 --source values.");
  if (options.durationSeconds !== undefined
    && (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 || options.durationSeconds > 300)) {
    throw new Error("--duration must be greater than 0 and at most 300 seconds.");
  }
  if (!Number.isInteger(options.fps) || options.fps < 1 || options.fps > 60) {
    throw new Error("--fps must be an integer from 1 to 60.");
  }

  options.sources = [...new Set(options.sources)];
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const job = await enqueueWordCreator({ ...options, forceRecreate: true });
  console.log(`WordCreator job ${job.id}: ${job.status}; ${job.total} item(s).`);

  startWordCreatorWorker();
  let previousProgress = "";
  while (true) {
    const current = await getWordCreatorJob(job.id);
    if (!current) throw new Error(`WordCreator job ${job.id} disappeared.`);

    const progress = `${current.status}:${current.processed}/${current.total}:${current.generated}:${current.current_source || ""}`;
    if (progress !== previousProgress) {
      console.log(`${current.status}: ${current.processed}/${current.total} processed, ${current.generated} generated`
        + (current.current_source ? `; current=${current.current_source}` : ""));
      previousProgress = progress;
    }

    if (current.status === "completed") {
      if (current.errors.length) {
        console.error(`${current.errors.length} item(s) failed.`);
        process.exitCode = 1;
      }
      return;
    }
    if (current.status === "failed") throw new Error(current.error || "WordCreator job failed.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

main().then(() => {
  process.exit(process.exitCode ?? 0);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
