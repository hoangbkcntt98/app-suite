import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool } from "pg";

if (typeof process.loadEnvFile === "function" && !process.env.DATABASE_URL) {
  const configured = process.env.DOTENV_CONFIG_PATH;
  const candidates = configured
    ? [configured]
    : [".env.local", ".env", ".env.production"];
  const envFile = candidates.find((candidate) => existsSync(candidate));
  if (envFile) process.loadEnvFile(envFile);
}

function quoteIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return `"${value}"`;
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const parsedUrl = new URL(databaseUrl);
const schema =
  process.env.BATCH_JOB_DB_SCHEMA?.trim() ||
  parsedUrl.searchParams.get("schema") ||
  "public";
const jobsName =
  process.env.BATCH_JOB_TABLE?.trim() || "batch_management_jobs";
const runsName =
  process.env.BATCH_JOB_RUNS_TABLE?.trim() || "batch_management_runs";
const quotedSchema = quoteIdentifier(schema, "BATCH_JOB_DB_SCHEMA");
const quotedJobs = quoteIdentifier(jobsName, "BATCH_JOB_TABLE");
const quotedRuns = quoteIdentifier(runsName, "BATCH_JOB_RUNS_TABLE");
parsedUrl.searchParams.delete("schema");

const qualifiedJobs = `${quotedSchema}.${quotedJobs}`;
const qualifiedRuns = `${quotedSchema}.${quotedRuns}`;
const indexPrefix = `batch_job_${shortHash(`${schema}.${jobsName}.${runsName}`)}`;

const pool = new Pool({
  connectionString: parsedUrl.toString(),
  options: `-c search_path=${quotedSchema},public`,
});

try {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedJobs} (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      script_path TEXT NOT NULL,
      config_path TEXT NOT NULL,
      args JSONB NOT NULL DEFAULT '[]'::jsonb,
      interval_seconds INTEGER,
      run_once BOOLEAN NOT NULL DEFAULT false,
      enabled BOOLEAN NOT NULL DEFAULT true,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "${indexPrefix}_jobs_pkey" PRIMARY KEY (id)
    )
  `);
  await pool.query(`
    ALTER TABLE ${qualifiedJobs}
      ALTER COLUMN interval_seconds DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS run_once BOOLEAN NOT NULL DEFAULT false
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedRuns} (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      job_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      progress INTEGER NOT NULL DEFAULT 0,
      stage TEXT,
      pid INTEGER,
      log_path TEXT,
      error TEXT,
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMPTZ,
      CONSTRAINT "${indexPrefix}_runs_pkey" PRIMARY KEY (id),
      CONSTRAINT "${indexPrefix}_runs_job_fkey"
        FOREIGN KEY (job_id) REFERENCES ${qualifiedJobs}(id)
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "${indexPrefix}_enabled_next_idx"
     ON ${qualifiedJobs} (enabled, next_run_at)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "${indexPrefix}_runs_status_heartbeat_idx"
     ON ${qualifiedRuns} (status, heartbeat_at)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "${indexPrefix}_runs_job_started_idx"
     ON ${qualifiedRuns} (job_id, started_at)`,
  );
  console.log(
    `Batch Job Management tables ready: ${schema}.${jobsName}, ${schema}.${runsName}`,
  );
} finally {
  await pool.end();
}
