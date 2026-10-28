"""Shared configuration helpers for app-suite jobs."""
from __future__ import annotations

import json
import re
from typing import Any

_SCHEMA_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_$-]*$")


def runs_table(schema: str) -> str:
    """Return safely quoted runs table for configured PostgreSQL schema."""
    if not isinstance(schema, str) or not _SCHEMA_NAME.fullmatch(schema):
        raise ValueError(f"Invalid PostgreSQL schema name: {schema!r}")
    return f'"{schema}"."runs"'


def ensure_progress_column(database: Any, schema: str) -> None:
    """Add progress column for existing runs tables."""
    database.execute(
        f"ALTER TABLE {runs_table(schema)} ADD COLUMN IF NOT EXISTS progress INTEGER"
    )


def insert_run_record(
    database: Any,
    schema: str,
    *,
    action: str,
    pattern_id: int,
    pattern_name: str,
    runner_pid: int,
    object_type: str,
    object_id: str,
    log_path: str,
    metadata: dict[str, Any] | None = None,
) -> int:
    """Insert a running job record and return its ID."""
    ensure_progress_column(database, schema)
    rows = database.execute(
        f"""INSERT INTO {runs_table(schema)}
            (action, object_type, object_id, status, is_completed, progress, log_path, metadata)
            VALUES (%s, %s, %s, 'starting', FALSE, 1, %s, %s::jsonb)
            RETURNING id""",
        (
            action,
            object_type,
            object_id,
            log_path,
            json.dumps({
                **(metadata or {}),
                "pattern_id": pattern_id,
                "pattern_name": pattern_name,
                "runner_pid": runner_pid,
            }, ensure_ascii=False),
        ),
    )
    if not rows or not isinstance(rows[0], dict) or not rows[0].get("id"):
        raise RuntimeError("Could not create job run record.")
    return int(rows[0]["id"])


def update_progress(database: Any, schema: str, run_id: int, progress: int) -> None:
    """Persist integer job progress from 1 through 100."""
    if isinstance(progress, bool) or not isinstance(progress, int) or not 1 <= progress <= 100:
        raise ValueError("progress must be an integer from 1 to 100")
    database.execute(
        f"""UPDATE {runs_table(schema)}
            SET progress = %s
            WHERE id = %s AND is_completed = FALSE""",
        (progress, run_id),
    )


def update_run_record(
    database: Any,
    schema: str,
    run_id: int,
    *,
    stage: str,
    status: str,
    terminal: bool = False,
    output_video: str | None = None,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
    manage_status: bool = True,
) -> None:
    """Persist run stage/metadata and optionally manage its status lifecycle."""
    values = {"job_stage": stage, **(metadata or {})}
    if output_video is not None:
        values["video_path"] = output_video
    if manage_status:
        database.execute(
            f"""UPDATE {runs_table(schema)}
                SET status = %s,
                    is_completed = %s,
                    ended_at = CASE WHEN %s THEN NOW() ELSE ended_at END,
                    error = COALESCE(%s, error),
                    metadata = COALESCE(metadata, '{{}}'::jsonb) || %s::jsonb
                WHERE id = %s""",
            (
                status,
                terminal,
                terminal,
                error,
                json.dumps(values, ensure_ascii=False),
                run_id,
            ),
        )
        return

    database.execute(
        f"""UPDATE {runs_table(schema)}
            SET error = COALESCE(%s, error),
                metadata = COALESCE(metadata, '{{}}'::jsonb) || %s::jsonb
            WHERE id = %s AND is_completed = FALSE""",
        (error, json.dumps(values, ensure_ascii=False), run_id),
    )


def job_settings(config: dict[str, Any], job_id: str) -> dict[str, Any]:
    """Return settings scoped to one job ID."""
    all_jobs = config.get("job_config", {})
    settings = all_jobs.get(job_id, {}) if isinstance(all_jobs, dict) else {}
    return settings if isinstance(settings, dict) else {}


def get_job_setting(
    config: dict[str, Any],
    job_id: str,
    section: str,
    key: str,
    default: Any = None,
) -> Any:
    """Resolve job-specific value first, then shared app-tools config, then default."""
    settings = job_settings(config, job_id)
    if key in settings and settings[key] is not None:
        return settings[key]

    section_override = settings.get(section, {})
    if isinstance(section_override, dict) and key in section_override and section_override[key] is not None:
        return section_override[key]

    shared_section = config.get(section, {})
    if isinstance(shared_section, dict) and key in shared_section and shared_section[key] is not None:
        return shared_section[key]
    if key in config and config[key] is not None:
        return config[key]
    return default


def get_effective_job_config(config: dict[str, Any], job_id: str) -> dict[str, Any]:
    """Merge this job's tool overrides into shared app-tools settings."""
    def merge(base: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
        result = dict(base)
        for key, value in overrides.items():
            if isinstance(result.get(key), dict) and isinstance(value, dict):
                result[key] = merge(result[key], value)
            else:
                result[key] = value
        return result

    effective = dict(config)
    for section, overrides in job_settings(config, job_id).items():
        base = effective.get(section)
        if isinstance(base, dict) and isinstance(overrides, dict):
            effective[section] = merge(base, overrides)
        elif section == "image" and isinstance(overrides, dict):
            ai = effective.get("ai")
            ai = dict(ai) if isinstance(ai, dict) else {}
            image = ai.get("image")
            ai["image"] = merge(image if isinstance(image, dict) else {}, overrides)
            effective["ai"] = ai
    return effective
