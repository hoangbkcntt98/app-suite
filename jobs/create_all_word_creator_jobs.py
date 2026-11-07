#!/usr/bin/env python3
"""Run the WordCreator job once for every distinct Kanji source in Anki."""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "jobs" / "app-tools"
JOBS = ROOT / "jobs"
sys.path.insert(0, str(TOOLS))
sys.path.insert(0, str(JOBS))

from create_word_creator_jobs import _db_options, _url_settings
from job_interface import get_effective_job_config
from python.config import load_config

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError as error:
    raise RuntimeError("Install jobs/app-tools/python/requirements.txt first.") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate WordCreator videos for every Kanji source in Anki."
    )
    parser.add_argument("--config", default=None, help="app-tools config JSON.")
    parser.add_argument("--duration", type=float, help="Override video duration.")
    parser.add_argument("--fps", type=int, help="Override video FPS.")
    parser.add_argument("--fixed-fps", action="store_true")
    parser.add_argument("--step", type=int, default=1, help="Maximum concurrent Kanji source tasks.")
    args = parser.parse_args()
    if args.duration is not None and not 0 < args.duration <= 300:
        parser.error("--duration must be greater than 0 and at most 300.")
    if args.fps is not None and not 1 <= args.fps <= 60:
        parser.error("--fps must be from 1 to 60.")
    if args.step < 1:
        parser.error("--step must be a positive integer.")
    return args


def get_anki_sources(config: dict[str, Any]) -> list[str]:
    effective = get_effective_job_config(config, "create_word_creator_jobs")
    main_db = dict(effective.get("database", {}))
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        main_db.update(_url_settings(database_url))
    if not main_db:
        raise ValueError("Configure database in app-tools config or set DATABASE_URL.")

    anki_db = dict(effective.get("anki_database", {}))
    anki_url = os.environ.get("VIDEO_ANKI_DATABASE_URL", "").strip()
    if anki_url:
        anki_db.update(_url_settings(anki_url))
    if not anki_db:
        anki_db = dict(main_db)
        anki_db["dbname"] = "anki"

    with psycopg.connect(**_db_options(anki_db), row_factory=dict_row) as database:
        rows = database.execute(
            """SELECT DISTINCT BTRIM(k."Kanji") AS source
               FROM public.anki_kanji k
               WHERE NULLIF(BTRIM(k."Kanji"), '') IS NOT NULL
                 AND NULLIF(BTRIM(k."RequiredVocabulary"), '') IS NOT NULL
                 AND k.anki_note_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1
                   FROM public.anki_videos v
                   WHERE v.anki_note_id = k.anki_note_id
                     AND NULLIF(BTRIM(v.video_path), '') IS NOT NULL
                 )
               ORDER BY source"""
        ).fetchall()
    return [str(row["source"]) for row in rows]


def run() -> int:
    args = parse_args()
    config = load_config(args.config)
    sources = get_anki_sources(config)
    if not sources:
        print("status=no_sources progress=0%", flush=True)
        return 0

    script = ROOT / "jobs" / "create_word_creator_jobs.py"
    failed_sources: list[str] = []
    total = len(sources)
    print(f"Found {total} distinct Kanji sources.", flush=True)

    def run_source(source: str) -> tuple[str, int, str]:
        command = [sys.executable, str(script)]
        if args.config:
            command.extend(["--config", args.config])
        command.extend(["--source", source])
        if args.duration is not None:
            command.extend(["--duration", str(args.duration)])
        if args.fps is not None:
            command.extend(["--fps", str(args.fps)])
        if args.fixed_fps:
            command.append("--fixed-fps")

        process = subprocess.run(
            command,
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        return source, process.returncode, process.stdout

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.step) as executor:
        futures = [executor.submit(run_source, source) for source in sources]
        for future in concurrent.futures.as_completed(futures):
            source, exit_code, output = future.result()
            completed += 1
            print(f"Finished Kanji source task: {source}", flush=True)
            if output:
                print(output, end="" if output.endswith("\n") else "\n", flush=True)
            if exit_code:
                failed_sources.append(source)
                print(f"Kanji source failed: {source} (exit={exit_code})", flush=True)
            print(
                f"Progress {completed}/{total} ({int(completed * 100 / total)}%) "
                f"status=kanji_{completed}_of_{total}",
                flush=True,
            )

    if failed_sources:
        print(
            f"Failed {len(failed_sources)}/{total} sources: "
            + ", ".join(failed_sources),
            flush=True,
        )
        return 1
    print(f"All {total} Kanji sources completed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
