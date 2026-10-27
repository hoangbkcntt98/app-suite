#!/usr/bin/env python3
"""Run the repository-owned manga crawler as a jobs-managed process."""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CRAWLER_SCRIPT = Path(__file__).resolve().with_name("manga_crawler.py")
DEFAULT_ENV_FILE = REPOSITORY_ROOT / ".env"


def load_env_file(path: Path, environ: dict[str, str]) -> None:
    """Read simple KEY=value dotenv entries without executing shell code."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        if value.startswith("export "):
            value = value[7:].lstrip()
        key, separator, raw_value = value.partition("=")
        key = key.strip()
        if not separator or not key or key in environ:
            continue
        parsed = shlex.split(raw_value, comments=True, posix=True)
        environ[key] = parsed[0] if parsed else ""


def build_crawler_env(base: dict[str, str]) -> dict[str, str]:
    env = dict(base)
    dialect = env.get("DB_DIALECT") or env.get("MANGA_DB_DIALECT") or "postgres"
    env["DB_DIALECT"] = dialect.lower()
    env["MANGA_DB_SCHEMA"] = env.get("MANGA_DB_SCHEMA", "").strip() or "public"
    env["DB_HOST"] = env.get("DB_HOST") or env.get("MANGA_DB_HOST", "")
    env["DB_PORT"] = env.get("DB_PORT") or env.get(
        "MANGA_DB_PORT", "3306" if dialect.lower() == "mysql" else "5432"
    )
    env["DB_NAME"] = env.get("DB_NAME") or env.get("MANGA_DB_NAME", "")
    env["DB_USER"] = env.get("DB_USER") or env.get("MANGA_DB_USER", "")
    env["DB_PASSWORD"] = env.get("DB_PASSWORD") or env.get("MANGA_DB_PASSWORD", "")
    return env


def build_parser(
    env: dict[str, str],
    *,
    default_env_file: str | None = None,
) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run manga crawler using registered site config or JSON config."
    )
    parser.add_argument(
        "--env-file",
        default=default_env_file or env.get("MANGA_CRAWLER_ENV_FILE", str(DEFAULT_ENV_FILE)),
        help="Optional dotenv file for crawler DB settings.",
    )
    parser.add_argument(
        "--python-bin",
        default=env.get("MANGA_CRAWLER_PYTHON", "python3"),
        help="Python executable for the repository-owned jobs/manga_crawler.py.",
    )
    parser.add_argument("--log-file", help="Append crawler output here; defaults to MANGA_CRAWLER_LOG or crawler.log.")
    config_group = parser.add_mutually_exclusive_group(required=True)
    config_group.add_argument("--config", help="Crawler site JSON config.")
    config_group.add_argument("--site-key", help="Load crawler site config from crawler_sites.")
    parser.add_argument("--manga-id", type=int, help="Crawl one local manga_titles.id.")
    parser.add_argument("--max-chapters", type=int, help="Limit chapters per manga.")
    parser.add_argument("--skip-title-list", action="store_true", help="Do not refresh the browse/title list.")
    parser.add_argument("--chapter-id", type=int, help="Crawl images for one local manga_chapters.id.")
    parser.add_argument("--crawl-images", action="store_true", help="Download/store reader images.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Destructive: truncate all crawler data tables before crawling.",
    )
    return parser


def crawler_args(args: argparse.Namespace) -> list[str]:
    result: list[str] = []
    if args.config:
        result.extend(["--config", args.config])
    else:
        result.extend(["--site-key", args.site_key])
    for name in ("manga_id", "max_chapters", "chapter_id"):
        value = getattr(args, name)
        if value is not None:
            if value < 1:
                raise ValueError(f"--{name.replace('_', '-')} must be positive.")
            result.extend([f"--{name.replace('_', '-')}", str(value)])
    if args.skip_title_list:
        result.append("--skip-title-list")
    if args.crawl_images:
        result.append("--crawl-images")
    if args.reset:
        result.append("--reset")
    return result


def lock_path(args: argparse.Namespace) -> Path:
    if args.chapter_id is not None:
        suffix = f"chapter-{args.chapter_id}"
    elif args.manga_id is not None:
        suffix = f"title-{args.manga_id}"
    else:
        return Path("/tmp/manga-crawler.lock")
    return Path("/tmp") / f"manga-crawler-{suffix}.lock"


def main() -> int:
    initial_env = dict(os.environ)
    bootstrap = argparse.ArgumentParser(add_help=False)
    bootstrap.add_argument(
        "--env-file",
        default=initial_env.get("MANGA_CRAWLER_ENV_FILE", str(DEFAULT_ENV_FILE)),
    )
    bootstrap_args, _ = bootstrap.parse_known_args()
    env_file = Path(bootstrap_args.env_file).expanduser()
    try:
        load_env_file(env_file, initial_env)
    except (OSError, ValueError) as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    parser = build_parser(initial_env, default_env_file=str(env_file))
    args = parser.parse_args()
    env = build_crawler_env(initial_env)

    if not CRAWLER_SCRIPT.is_file():
        print(json.dumps({
            "success": False,
            "error": f"Local crawler implementation not found: {CRAWLER_SCRIPT}",
        }, ensure_ascii=False), file=sys.stderr)
        return 1
    try:
        forwarded_args = crawler_args(args)
    except ValueError as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2
    command = [args.python_bin, str(CRAWLER_SCRIPT), *forwarded_args]
    log_value = args.log_file or env.get("MANGA_CRAWLER_LOG")
    log_path = (
        Path(log_value).expanduser().resolve()
        if log_value
        else REPOSITORY_ROOT / "jobs" / "manga_crawler.log"
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    lock = lock_path(args)
    lock.parent.mkdir(parents=True, exist_ok=True)

    try:
        import fcntl

        with lock.open("a", encoding="utf-8") as lock_stream:
            try:
                fcntl.flock(lock_stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError(f"Crawler already running for lock scope {lock.name}.")

            with log_path.open("a", encoding="utf-8", buffering=1) as log_stream:
                start = datetime.now().astimezone().isoformat(timespec="seconds")
                log_stream.write(f"{start} jobs manga crawler started\n")
                print(f"Logging crawler output to {log_path}", flush=True)
                process = subprocess.Popen(
                    command,
                    cwd=str(REPOSITORY_ROOT),
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                )
                assert process.stdout is not None
                for line in process.stdout:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    log_stream.write(line)
                exit_code = process.wait()
                end = datetime.now().astimezone().isoformat(timespec="seconds")
                log_stream.write(f"{end} jobs manga crawler exited status={exit_code}\n")
    except Exception as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({
        "success": exit_code == 0,
        "exit_code": exit_code,
        "crawler_script": str(CRAWLER_SCRIPT),
        "log_file": str(log_path),
    }, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
