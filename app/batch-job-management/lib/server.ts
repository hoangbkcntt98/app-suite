import "server-only";

import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { Pool } from "pg";

const ROOT = process.cwd();
const COOKIE_NAME = "batch_job_management";
const DEFAULT_CONFIG =
  process.env.BATCH_JOB_DEFAULT_CONFIG?.trim() ||
  process.env.APP_TOOLS_CONFIG?.trim() ||
  "jobs/app-tools/config.json";

function quoteIdentifier(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return `"${value}"`;
}

function getDatabaseSettings() {
  const databaseUrl = process.env.DATABASE_URL;
  const parsed = databaseUrl ? new URL(databaseUrl) : null;
  const schema = process.env.BATCH_JOB_DB_SCHEMA?.trim() ||
    parsed?.searchParams.get("schema") ||
    "public";
  const jobsTable =
    process.env.BATCH_JOB_TABLE?.trim() || "batch_management_jobs";
  const runsTable =
    process.env.BATCH_JOB_RUNS_TABLE?.trim() || "batch_management_runs";
  const quotedSchema = quoteIdentifier(schema, "BATCH_JOB_DB_SCHEMA");
  const quotedJobsTable = quoteIdentifier(jobsTable, "BATCH_JOB_TABLE");
  const quotedRunsTable = quoteIdentifier(runsTable, "BATCH_JOB_RUNS_TABLE");
  parsed?.searchParams.delete("schema");

  return {
    connectionString: parsed?.toString() || "",
    searchPath: `-c search_path=${quotedSchema},public`,
    jobsTable: `${quotedSchema}.${quotedJobsTable}`,
    runsTable: `${quotedSchema}.${quotedRunsTable}`,
  };
}

const globalPool = globalThis as typeof globalThis & {
  batchJobPool?: Pool;
};

function getPool() {
  if (globalPool.batchJobPool) return globalPool.batchJobPool;
  const settings = getDatabaseSettings();
  if (!settings.connectionString) throw new Error("DATABASE_URL is required.");
  globalPool.batchJobPool = new Pool({
    connectionString: settings.connectionString,
    options: settings.searchPath,
  });
  return globalPool.batchJobPool;
}

const databaseSettings = getDatabaseSettings();
export const BATCH_JOBS_TABLE = databaseSettings.jobsTable;
export const BATCH_JOB_RUNS_TABLE = databaseSettings.runsTable;

export const batchJobDb = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => getPool().query<T>(sql, values),
};

function equalSecret(candidate: string, expected: string) {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

export async function hasBatchJobAccess() {
  const expected = process.env.BATCH_JOB_MANAGEMENT_TOKEN?.trim();
  if (!expected) return false;
  const candidate = (await cookies()).get(COOKIE_NAME)?.value || "";
  return equalSecret(candidate, expected);
}

export function batchJobTokenConfigured() {
  return Boolean(process.env.BATCH_JOB_MANAGEMENT_TOKEN?.trim());
}

export function batchJobCookieName() {
  return COOKIE_NAME;
}

export function getDefaultConfigPath() {
  return DEFAULT_CONFIG;
}

export async function getSubtaskRunSchemas() {
  const schemas = new Set<string>();
  const configuredSchema = process.env.BATCH_SUBTASK_DB_SCHEMA?.trim();
  if (configuredSchema) schemas.add(configuredSchema);

  const configPath = path.resolve(
    /*turbopackIgnore: true*/ ROOT,
    DEFAULT_CONFIG,
  );
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      database?: { schema?: unknown };
      job_config?: Record<string, { database?: { schema?: unknown } }>;
    };
    if (typeof config.database?.schema === "string") {
      schemas.add(config.database.schema);
    }
    for (const job of Object.values(config.job_config || {})) {
      if (typeof job?.database?.schema === "string") {
        schemas.add(job.database.schema);
      }
    }
  } catch {
    // Fall back to DATABASE_URL schema below when config is unavailable.
  }

  try {
    const urlSchema = process.env.DATABASE_URL
      ? new URL(process.env.DATABASE_URL).searchParams.get("schema")
      : null;
    if (urlSchema) schemas.add(urlSchema);
  } catch {
    // Invalid database URL will be reported by the query connection.
  }

  if (schemas.size === 0) schemas.add("app_suite");
  for (const schema of schemas) quoteIdentifier(schema, "BATCH_SUBTASK_DB_SCHEMA");
  return [...schemas];
}

export function quoteDatabaseIdentifier(value: string, label: string) {
  return quoteIdentifier(value, label);
}

function repoRelativeFile(input: string, rootDir: string) {
  const candidate = path.resolve(/*turbopackIgnore: true*/ ROOT, input);
  const resolvedRoot = realpathSync(rootDir);
  const resolvedCandidate = realpathSync(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("Path must stay inside the allowed directory.");
  }
  if (!statSync(resolvedCandidate).isFile()) {
    throw new Error("Selected path must be a file.");
  }
  return path.relative(ROOT, resolvedCandidate);
}

export function validateScriptPath(input: unknown) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Python file is required.");
  }
  const jobsRoot = path.join(ROOT, "jobs");
  const relative = repoRelativeFile(input.trim(), jobsRoot);
  if (path.extname(relative).toLowerCase() !== ".py") {
    throw new Error("Python file must end in .py.");
  }
  return relative;
}

export function validateConfigPath(input: unknown) {
  const selected =
    typeof input === "string" && input.trim() ? input.trim() : DEFAULT_CONFIG;
  return repoRelativeFile(selected, ROOT);
}

export function validateJobArgs(input: unknown) {
  if (
    !Array.isArray(input) ||
    input.length > 64 ||
    !input.every(
      (value) =>
        typeof value === "string" &&
        value.length <= 4096 &&
        !value.includes("\0") &&
        value !== "--config" &&
        !value.startsWith("--config="),
    )
  ) {
    throw new Error("Arguments must be an array of up to 64 strings; omit --config.");
  }
  return input as string[];
}

