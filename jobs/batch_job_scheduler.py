#!/usr/bin/env python3
"""Persistent interval scheduler for Batch Job Management."""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = "jobs/app-tools/config.json"
PROGRESS_RE = re.compile(r"\bprogress[=: ]+(\d{1,3})\s*%?", re.IGNORECASE)
STATUS_RE = re.compile(r"\bstatus[=: ]+([^\s,]+)", re.IGNORECASE)


def load_dotenv() -> None:
    values: dict[str, str] = {}
    node_env = os.environ.get("NODE_ENV", "production")
    env_files = (
        ROOT / ".env",
        ROOT / f".env.{node_env}",
        ROOT / ".env.local",
        ROOT / f".env.{node_env}.local",
    )
    for env_file in env_files:
        if not env_file.is_file():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
                value = value[1:-1]
            if key:
                values[key] = value
    for key, value in values.items():
        os.environ.setdefault(key, value)


def connect(*, autocommit: bool = False) -> psycopg.Connection:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required.")
    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    url_schema = query.pop("schema", "public").strip() or "public"
    schema = os.environ.get("BATCH_JOB_DB_SCHEMA", "").strip() or url_schema
    quote_identifier(schema, "BATCH_JOB_DB_SCHEMA")
    dsn = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment)
    )
    return psycopg.connect(
        dsn,
        options=f'-c search_path="{schema}",public',
        autocommit=autocommit,
    )


def quote_identifier(value: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$-]{0,62}", value):
        raise ValueError(f"{label} is invalid.")
    return f'"{value}"'

def batch_job_tables() -> tuple[str, str]:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required.")
    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    schema = os.environ.get("BATCH_JOB_DB_SCHEMA", "").strip() or query.get(
        "schema", "public"
    )
    jobs = os.environ.get("BATCH_JOB_TABLE", "").strip() or "batch_management_jobs"
    runs = os.environ.get("BATCH_JOB_RUNS_TABLE", "").strip() or "batch_management_runs"
    quoted_schema = quote_identifier(schema, "BATCH_JOB_DB_SCHEMA")
    return (
        f"{quoted_schema}.{quote_identifier(jobs, 'BATCH_JOB_TABLE')}",
        f"{quoted_schema}.{quote_identifier(runs, 'BATCH_JOB_RUNS_TABLE')}",
    )

def safe_file(value: str, allowed_root: Path, suffix: str | None = None) -> Path:
    candidate = (ROOT / value).resolve()
    root = allowed_root.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Configured path escaped allowed directory.")
    if not candidate.is_file():
        raise FileNotFoundError(f"Configured file not found: {value}")
    if suffix and candidate.suffix.lower() != suffix:
        raise ValueError(f"Configured file must end in {suffix}.")
    return candidate


def update_run(run_id: str, sql: str, values: tuple[object, ...]) -> None:
    with connect() as db:
        db.execute(sql, (*values, run_id))


def run_job(job: dict[str, object], run_id: str) -> None:
    log_dir = Path(os.environ.get("BATCH_JOB_LOG_DIR", "jobs/logs/batch-jobs"))
    if not log_dir.is_absolute():
        log_dir = ROOT / log_dir
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{run_id}.log"
    try:
        script = safe_file(str(job["script_path"]), ROOT / "jobs", ".py")
        config_path = safe_file(str(job["config_path"]), ROOT)
        python = os.environ.get("BATCH_JOB_PYTHON", "jobs/app-tools/.venv/bin/python")
        python_path = Path(python)
        if not python_path.is_absolute():
            python_path = ROOT / python_path
        if not python_path.is_file():
            raise FileNotFoundError(f"Python executable not found: {python_path}")
        args = job["args"]
        if isinstance(args, str):
            args = json.loads(args)
        if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
            raise ValueError("Stored job args must be an array of strings.")
        command = [
            str(python_path),
            str(script),
            "--config",
            str(config_path),
            *args,
        ]
        with log_path.open("a", encoding="utf-8") as log:
            log.write(
                f"Starting run {run_id}: {script.name} "
                f"({len(args)} configured arguments)\n"
            )
            process = subprocess.Popen(
                command,
                cwd=ROOT,
                start_new_session=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            update_run(
                run_id,
                f"UPDATE {batch_job_tables()[1]} SET pid = %s, log_path = %s WHERE id = %s::uuid",
                (process.pid, str(log_path)),
            )
            done = threading.Event()

            def heartbeat() -> None:
                while not done.wait(15):
                    try:
                        update_run(
                            run_id,
                            f"UPDATE {batch_job_tables()[1]} SET heartbeat_at = NOW() WHERE id = %s::uuid",
                            (),
                        )
                    except Exception as exc:  # keep subprocess supervision alive
                        print(f"batch scheduler heartbeat failed: {exc}", file=sys.stderr)

            heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
            heartbeat_thread.start()
            assert process.stdout is not None
            for line in process.stdout:
                log.write(line)
                log.flush()
                progress = PROGRESS_RE.search(line)
                status = STATUS_RE.search(line)
                if progress or status:
                    values: list[object] = []
                    assignments: list[str] = []
                    if progress:
                        assignments.append("progress = %s")
                        values.append(min(100, int(progress.group(1))))
                    if status:
                        assignments.append("stage = %s")
                        values.append(status.group(1)[:200])
                    assignments.append("heartbeat_at = NOW()")
                    update_run(
                        run_id,
                        f"UPDATE {batch_job_tables()[1]} SET {', '.join(assignments)} WHERE id = %s::uuid",
                        tuple(values),
                    )
            result = process.wait()
            done.set()
            heartbeat_thread.join(timeout=1)
            update_run(
                run_id,
                f"""UPDATE {batch_job_tables()[1]}
                   SET status = CASE
                         WHEN stage = 'stopping' THEN 'stopped'
                         WHEN %s = 0 THEN 'completed'
                         ELSE 'failed'
                       END,
                       progress = CASE WHEN stage = 'stopping' THEN progress
                                       WHEN %s = 0 THEN 100 ELSE progress END,
                       stage = CASE WHEN stage = 'stopping' THEN 'stopped'
                                    WHEN %s = 0 THEN 'completed' ELSE 'failed' END,
                       error = CASE WHEN stage = 'stopping' THEN 'Stopped by user.'
                                    WHEN %s = 0 THEN NULL
                                    ELSE %s END,
                       finished_at = NOW(), heartbeat_at = NOW()
                   WHERE id = %s::uuid""",
                (
                    result,
                    result,
                    result,
                    result,
                    f"Process exited with code {result}.",
                ),
            )
    except Exception as exc:
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as log:
                log.write(f"Batch job failed before completion: {exc}\n")
            update_run(
                run_id,
                f"""UPDATE {batch_job_tables()[1]} SET status = 'failed', stage = 'failed',
                   error = %s, log_path = %s, finished_at = NOW(), heartbeat_at = NOW()
                   WHERE id = %s::uuid""",
                (str(exc)[:4000], str(log_path)),
            )
        except Exception as db_exc:
            print(f"batch scheduler could not record failure: {db_exc}", file=sys.stderr)


def claim_due_job(db: psycopg.Connection) -> tuple[dict[str, object], str] | None:
    jobs_table, runs_table = batch_job_tables()
    with db.transaction():
        row = db.execute(
            f"""SELECT id, name, script_path, config_path, args, run_once
               FROM {jobs_table}
               WHERE enabled = TRUE AND next_run_at <= NOW()
                 AND NOT EXISTS (
                   SELECT 1 FROM {runs_table} r
                   WHERE r.job_id = {jobs_table}.id AND r.status = 'running'
                 )
               ORDER BY next_run_at
               LIMIT 1
               FOR UPDATE SKIP LOCKED
               """
        ).fetchone()
        if not row:
            return None
        job_id, name, script_path, config_path, args, run_once = row
        if run_once:
            db.execute(
                f"""UPDATE {jobs_table} SET enabled = FALSE, last_run_at = NOW(),
                   updated_at = NOW() WHERE id = %s""",
                (job_id,),
            )
        else:
            db.execute(
                f"""UPDATE {jobs_table}
                   SET next_run_at = NOW() + (interval_seconds * INTERVAL '1 second'),
                       last_run_at = NOW(), updated_at = NOW() WHERE id = %s""",
                (job_id,),
            )
        run_id = str(uuid.uuid4())
        db.execute(
            f"""INSERT INTO {runs_table} (id, job_id, status, progress, stage)
               VALUES (%s::uuid, %s, 'running', 0, 'starting')""",
            (run_id, job_id),
        )
    return (
        {
            "id": str(job_id),
            "name": name,
            "script_path": script_path,
            "config_path": config_path,
            "args": args,
            "run_once": run_once,
        },
        run_id,
    )


def main() -> None:
    load_dotenv()
    max_workers = max(1, min(16, int(os.environ.get("BATCH_JOB_MAX_WORKERS", "3"))))
    worker_id = uuid.uuid4().hex[:12]
    db = connect(autocommit=True)
    lock = db.execute(
        "SELECT pg_try_advisory_lock(hashtext('batch-job-management-scheduler'))"
    ).fetchone()[0]
    if not lock:
        raise RuntimeError("Another Batch Job Management scheduler is already running.")
    db.execute(
        f"""UPDATE {batch_job_tables()[1]} SET status = 'failed', stage = 'worker_lost',
           error = 'Scheduler heartbeat expired.', finished_at = NOW()
           WHERE status = 'running' AND heartbeat_at < NOW() - INTERVAL '2 minutes'"""
    )
    print(f"Batch Job Management scheduler {worker_id} started.")
    active: dict[concurrent.futures.Future[None], str] = {}
    stopping = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        stopping.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        while not stopping.is_set():
            active = {future: run for future, run in active.items() if not future.done()}
            while len(active) < max_workers:
                claimed = claim_due_job(db)
                if not claimed:
                    break
                job, run_id = claimed
                print(f"Starting {job['name']} run={run_id}")
                active[executor.submit(run_job, job, run_id)] = run_id
            stopping.wait(2)
    db.execute("SELECT pg_advisory_unlock(hashtext('batch-job-management-scheduler'))")
    db.close()
    print("Batch Job Management scheduler stopped.")


if __name__ == "__main__":
    main()
