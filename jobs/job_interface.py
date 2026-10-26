"""Shared configuration helpers for app-suite jobs."""
from __future__ import annotations

from typing import Any


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
