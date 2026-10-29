CREATE TABLE "batch_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "script_path" TEXT NOT NULL,
    "config_path" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "interval_seconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ NOT NULL,
    "last_run_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "batch_job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "pid" INTEGER,
    "log_path" TEXT,
    "error" TEXT,
    "heartbeat_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "batch_job_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "batch_job_runs_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "batch_jobs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "batch_jobs_enabled_next_run_at_idx"
  ON "batch_jobs"("enabled", "next_run_at");
CREATE INDEX "batch_job_runs_status_heartbeat_at_idx"
  ON "batch_job_runs"("status", "heartbeat_at");
CREATE INDEX "batch_job_runs_job_id_started_at_idx"
  ON "batch_job_runs"("job_id", "started_at");
