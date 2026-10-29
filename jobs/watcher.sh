#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_PATH="$ROOT_DIR/jobs/app-tools/.venv/bin/python"
DEFAULT_CONFIG="$ROOT_DIR/jobs/app-tools/config.json"
JOB_NAME="create_grammar_video_jobs.py"

configure_job() {
  case "$1" in
    create_grammar_video_jobs.py)
      JOB_SCRIPT="$ROOT_DIR/jobs/create_grammar_video_jobs.py"
      WATCHER_NAME="create_grammar_video_jobs"
      ;;
    create_grammar_example_video_jobs.py)
      JOB_SCRIPT="$ROOT_DIR/jobs/create_grammar_example_video_jobs.py"
      WATCHER_NAME="create_grammar_example_video_jobs"
      ;;
    generate_game_resource.py)
      JOB_SCRIPT="$ROOT_DIR/jobs/generate_game_resource.py"
      WATCHER_NAME="generate_game_resource"
      ;;
    *)
      echo "Unsupported job: $1" >&2
      exit 2
      ;;
  esac
}

usage() {
  cat <<'EOF'
Usage:
  jobs/watcher.sh start --config WATCHERS.json
  jobs/watcher.sh start JOB.py --clear-log
  jobs/watcher.sh status --all
  jobs/watcher.sh start JOB.py [--one-time] [--interval SECONDS] [job options...]
  jobs/watcher.sh stop --all
  jobs/watcher.sh stop  JOB.py [--config PATH]
  jobs/watcher.sh status JOB.py [--config PATH]

Example:
  jobs/watcher.sh start --config jobs/watchers.json
  jobs/watcher.sh start create_grammar_example_video_jobs.py --clear-log --config jobs/app-tools/config.json
  jobs/watcher.sh status --all
  jobs/watcher.sh stop --all
  jobs/watcher.sh start create_grammar_video_jobs.py --interval 10 --config jobs/app-tools/config.json
  jobs/watcher.sh start create_grammar_example_video_jobs.py --one-time --config jobs/app-tools/config.json --limit 10
  jobs/watcher.sh start generate_game_resource.py --one-time --config jobs/app-tools/config.json --limit 10
  jobs/watcher.sh start create_grammar_example_video_jobs.py --interval 10 --config jobs/app-tools/config.json
EOF
}

if [[ "${1:-}" == "__watch" ]]; then
  shift
  LOG_DIR="$1"
  LOG_FILE="$2"
  LOCK_FILE="$3"
  INTERVAL="$4"
  CONFIG_PATH="$5"
  JOB_NAME="$6"
  ONE_TIME="$7"
  configure_job "$JOB_NAME"
  PID_FILE="$LOG_DIR/${WATCHER_NAME}_watcher.pid"
  INTERVAL_FILE="$LOG_DIR/${WATCHER_NAME}_watcher.interval"
  shift 7
  JOB_ARGS=("$@")
  cd -- "$ROOT_DIR"
  exec 9>"$LOCK_FILE"
  child_pid=""

  cleanup_watcher() {
    if [[ -s "$PID_FILE" ]] && [[ "$(cat "$PID_FILE")" == "$$" ]]; then
      rm -f -- "$PID_FILE"
      if [[ "$ONE_TIME" == "true" ]]; then
        rm -f -- "$INTERVAL_FILE"
      fi
    fi
  }

  stop_watcher() {
    if [[ -n "$child_pid" ]]; then
      kill -TERM "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
      child_pid=""
    fi
    flock -u 9 2>/dev/null || true
    exit 0
  }
  trap cleanup_watcher EXIT
  trap stop_watcher TERM INT

  while true; do
    if flock -n 9; then
      printf '%s Starting %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$WATCHER_NAME" >>"$LOG_FILE"
      "$PYTHON_PATH" "$JOB_SCRIPT" --config "$CONFIG_PATH" "${JOB_ARGS[@]}" >>"$LOG_FILE" 2>&1 &
      child_pid=$!
      if wait "$child_pid"; then
        result=0
      else
        result=$?
      fi
      child_pid=""
      printf '%s Job exited with status %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$result" >>"$LOG_FILE"
      flock -u 9
    else
      if [[ "$ONE_TIME" == "true" ]]; then
        printf '%s One-time run skipped; another watcher holds lock\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG_FILE"
      else
        printf '%s Skipping tick; another watcher holds lock\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG_FILE"
      fi
    fi

    if [[ "$ONE_TIME" == "true" ]]; then
      break
    fi

    sleep "$INTERVAL" &
    child_pid=$!
    wait "$child_pid" || true
    child_pid=""
  done
fi

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

ACTION="$1"
shift
case "$ACTION" in
  start|stop|status) ;;
  *) usage >&2; exit 2 ;;
esac

# Each watcher uses the JSON's config (or entry override) as its Python
# --config. Put other Python job options in args.
if [[ "$ACTION" == "start" || "$ACTION" == "status" ]] &&
  [[ "${1:-}" == "--config" && $# -ge 2 ]]; then
  WATCHERS_CONFIG="$2"
  shift 2
  CLEAR_LOG=false
  while (($#)); do
    case "$1" in
      --clear-log)
        CLEAR_LOG=true
        shift
        ;;
      *)
        echo "Unsupported option with watcher config: $1" >&2
        exit 2
        ;;
    esac
  done
  if [[ "$CLEAR_LOG" == "true" && "$ACTION" != "start" ]]; then
    echo "--clear-log is only valid for start." >&2
    exit 2
  fi
  if [[ "$WATCHERS_CONFIG" != /* ]]; then
    WATCHERS_CONFIG="$ROOT_DIR/$WATCHERS_CONFIG"
  fi
  if [[ ! -f "$WATCHERS_CONFIG" ]]; then
    echo "Watcher config file not found: $WATCHERS_CONFIG" >&2
    exit 1
  fi

  ENTRIES_FILE="$(mktemp)"
  if ! python3 - "$WATCHERS_CONFIG" "$ROOT_DIR" >"$ENTRIES_FILE" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
root = Path(sys.argv[2])
with config_path.open(encoding="utf-8") as stream:
    config = json.load(stream)
watchers = config.get("watchers")
if not isinstance(watchers, list):
    raise SystemExit("Watcher config must contain a 'watchers' array.")
default_config = config.get("python_config", str(config_path.resolve()))
if not isinstance(default_config, str) or not default_config:
    raise SystemExit("Watcher config 'python_config' must be a path string.")
for index, watcher in enumerate(watchers):
    if not isinstance(watcher, dict):
        raise SystemExit(f"watchers[{index}] must be an object.")
    script = watcher.get("file")
    args = watcher.get("args", [])
    job_config = watcher.get("config", default_config)
    interval = watcher.get("interval", 300)
    one_time = watcher.get("one_time", False)
    if not isinstance(script, str) or not script.endswith(".py"):
        raise SystemExit(f"watchers[{index}].file must be a Python filename.")
    if not isinstance(args, list) or not all(isinstance(arg, str) and arg for arg in args):
        raise SystemExit(f"watchers[{index}].args must be non-empty strings.")
    if "--config" in args or any(arg.startswith("--config=") for arg in args):
        raise SystemExit(
            f"watchers[{index}].args must not include --config; use watcher config 'python_config'."
        )
    if not isinstance(job_config, str) or not job_config:
        raise SystemExit(f"watchers[{index}].config must be a path string.")
    if isinstance(interval, bool) or not isinstance(interval, int) or interval < 1:
        raise SystemExit(f"watchers[{index}].interval must be a positive integer.")
    if not isinstance(one_time, bool):
        raise SystemExit(f"watchers[{index}].one_time must be a boolean.")
    config_path = Path(job_config).expanduser()
    if not config_path.is_absolute():
        config_path = root / config_path
    for value in (
        script, str(interval), "true" if one_time else "false",
        str(config_path.resolve()), *args, "",
    ):
        sys.stdout.write(value + "\0")
PY
  then
    rm -f -- "$ENTRIES_FILE"
    exit 2
  fi
  mapfile -d '' -t WATCHER_ENTRIES <"$ENTRIES_FILE"
  rm -f -- "$ENTRIES_FILE"
  if [[ "${#WATCHER_ENTRIES[@]}" -eq 0 ]]; then
    echo "Watcher config contains no watchers."
    exit 0
  fi
  while (("${#WATCHER_ENTRIES[@]}" >= 3)); do
    script="${WATCHER_ENTRIES[0]}"
    interval="${WATCHER_ENTRIES[1]}"
    one_time="${WATCHER_ENTRIES[2]}"
    job_config="${WATCHER_ENTRIES[3]}"
    WATCHER_ENTRIES=("${WATCHER_ENTRIES[@]:4}")
    args=()
    while (("${#WATCHER_ENTRIES[@]}" > 0)) && [[ -n "${WATCHER_ENTRIES[0]}" ]]; do
      args+=("${WATCHER_ENTRIES[0]}")
      WATCHER_ENTRIES=("${WATCHER_ENTRIES[@]:1}")
    done
    if (("${#WATCHER_ENTRIES[@]}" > 0)); then
      WATCHER_ENTRIES=("${WATCHER_ENTRIES[@]:1}")
    fi
    if [[ "$ACTION" == "status" ]]; then
      printf '%s: ' "$script"
      "$ROOT_DIR/jobs/watcher.sh" status "$script" --config "$job_config"
    else
      start_args=(start "$script" --interval "$interval" --config "$job_config" "${args[@]}")
      if [[ "$CLEAR_LOG" == "true" ]]; then
        start_args+=(--clear-log)
      fi
      if [[ "$one_time" == "true" ]]; then
        start_args=(start "$script" --one-time --interval "$interval" --config "$job_config" "${args[@]}")
        if [[ "$CLEAR_LOG" == "true" ]]; then
          start_args+=(--clear-log)
        fi
      fi
      "$ROOT_DIR/jobs/watcher.sh" "${start_args[@]}"
    fi
  done
  exit 0
fi

if [[ "$ACTION" == "status" && "${1:-}" == "--all" ]]; then
  found=0
  while IFS= read -r -d '' pid_file; do
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    name="$(basename -- "$pid_file" _watcher.pid)"
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
      printf '%s running pid=%s\n' "$name" "$pid"
      ((found += 1))
    else
      printf '%s stopped\n' "$name"
    fi
  done < <(find "$ROOT_DIR" -type f -name '*_watcher.pid' -print0)
  if ((found == 0)); then
    echo "No running watchers."
  fi
  exit 0
fi

if [[ "$ACTION" == "stop" && "${1:-}" == "--all" ]]; then
  stopped=0
  shopt -s nullglob
  while IFS= read -r -d '' pid_file; do
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null; then
      command_line="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
      if [[ "$command_line" == *"watcher.sh __watch "* ]]; then
        kill -TERM "$pid" 2>/dev/null || true
        for _ in {1..20}; do
          kill -0 "$pid" 2>/dev/null || break
          sleep 0.25
        done
        if kill -0 "$pid" 2>/dev/null; then
          kill -KILL "$pid" 2>/dev/null || true
        fi
        ((stopped += 1))
      fi
    fi
    rm -f -- "$pid_file"
    interval_file="${pid_file%_watcher.pid}_watcher.interval"
    rm -f -- "$interval_file"
  done < <(find "$ROOT_DIR" -type f -name '*_watcher.pid' -print0)
  printf 'stopped %s watcher(s)\n' "$stopped"
  exit 0
fi

if [[ $# -gt 0 && "$1" != --* ]]; then
  JOB_NAME="$(basename -- "$1")"
  shift
fi
configure_job "$JOB_NAME"

INTERVAL=300
CONFIG_PATH="$DEFAULT_CONFIG"
ONE_TIME=false
CLEAR_LOG=false
JOB_ARGS=()
while (($#)); do
  case "$1" in
    --one-time)
      if [[ "$ACTION" != "start" ]]; then
        echo "--one-time is only valid for start." >&2
        exit 2
      fi
      ONE_TIME=true
      shift
      ;;
    --clear-log)
      if [[ "$ACTION" != "start" ]]; then
        echo "--clear-log is only valid for start." >&2
        exit 2
      fi
      CLEAR_LOG=true
      shift
      ;;
    --interval)
      if [[ "$ACTION" != "start" || $# -lt 2 ]]; then
        echo "--interval is only valid for start and needs a value." >&2
        exit 2
      fi
      INTERVAL="$2"
      shift 2
      ;;
    --interval=*)
      if [[ "$ACTION" != "start" ]]; then
        echo "--interval is only valid for start." >&2
        exit 2
      fi
      INTERVAL="${1#*=}"
      shift
      ;;
    --config)
      if [[ $# -lt 2 ]]; then
        echo "--config needs a path." >&2
        exit 2
      fi
      CONFIG_PATH="$2"
      shift 2
      ;;
    *)
      JOB_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! [[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "Interval must be a positive whole number of seconds." >&2
  exit 2
fi
if [[ ! -x "$PYTHON_PATH" ]]; then
  echo "Virtualenv Python not found: $PYTHON_PATH" >&2
  exit 1
fi
if [[ ! -f "$CONFIG_PATH" ]]; then
  if [[ "$CONFIG_PATH" != /* ]]; then
    CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
  fi
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "Config file not found: $CONFIG_PATH" >&2
    exit 1
  fi
fi
if [[ "$CONFIG_PATH" != /* ]]; then
  CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi

LOG_DIR="$(
  python3 - "$CONFIG_PATH" "$ROOT_DIR" "$WATCHER_NAME" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
root = Path(sys.argv[2])
job_name = sys.argv[3]
with config_path.open(encoding="utf-8") as stream:
    config = json.load(stream)
job = config.get("job_config", {}).get(job_name, {})
job_logger = job.get("logger", {})
shared_logger = config.get("logger", {})
log_file = job_logger.get("file") if isinstance(job_logger, dict) else None
if not log_file and isinstance(shared_logger, dict):
    log_file = shared_logger.get("file")
if log_file:
    path = Path(str(log_file)).expanduser()
    if not path.is_absolute():
        path = config_path.parent / path
    print(path.resolve().parent)
else:
    print((root / "logs").resolve())
PY
)"
mkdir -p -- "$LOG_DIR"

LOG_FILE="$LOG_DIR/${WATCHER_NAME}_watcher.log"
LOCK_FILE="$LOG_DIR/${WATCHER_NAME}.lock"
PID_FILE="$LOG_DIR/${WATCHER_NAME}_watcher.pid"
INTERVAL_FILE="$LOG_DIR/${WATCHER_NAME}_watcher.interval"

is_running() {
  [[ -s "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "$ACTION" in
  status)
    if is_running; then
      if [[ -f "$INTERVAL_FILE" ]]; then
        INTERVAL="$(cat "$INTERVAL_FILE")"
      fi
      if [[ "$INTERVAL" == "one-time" ]]; then
        printf 'running pid=%s mode=one-time log=%s\n' "$(cat "$PID_FILE")" "$LOG_FILE"
      else
        printf 'running pid=%s interval=%ss log=%s\n' "$(cat "$PID_FILE")" "$INTERVAL" "$LOG_FILE"
      fi
    else
      echo "stopped"
      exit 0
    fi
    ;;
  stop)
    if ! is_running; then
      rm -f -- "$PID_FILE"
      rm -f -- "$INTERVAL_FILE"
      echo "stopped"
      exit 0
    fi
    pid="$(cat "$PID_FILE")"
    kill -TERM "$pid"
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "Watcher did not stop within 5 seconds; sending SIGKILL." >&2
      kill -KILL "$pid"
    fi
    rm -f -- "$PID_FILE"
    rm -f -- "$INTERVAL_FILE"
    echo "stopped"
    ;;
  start)
    if is_running; then
      echo "Watcher already running (pid=$(cat "$PID_FILE"))."
      exit 0
    fi
    rm -f -- "$PID_FILE"
    if [[ "$CLEAR_LOG" == "true" ]]; then
      : >"$LOG_FILE"
    fi
    if [[ "$ONE_TIME" == "true" ]]; then
      printf 'one-time\n' >"$INTERVAL_FILE"
    else
      printf '%s\n' "$INTERVAL" >"$INTERVAL_FILE"
    fi
    nohup "$ROOT_DIR/jobs/watcher.sh" __watch "$LOG_DIR" "$LOG_FILE" "$LOCK_FILE" "$INTERVAL" "$CONFIG_PATH" "$JOB_NAME" "$ONE_TIME" "${JOB_ARGS[@]}" \
      >/dev/null 2>&1 &
    watcher_pid=$!
    echo "$watcher_pid" >"$PID_FILE"
    if [[ "$ONE_TIME" == "true" ]]; then
      if ! kill -0 "$watcher_pid" 2>/dev/null; then
        rm -f -- "$PID_FILE" "$INTERVAL_FILE"
      fi
      echo "started pid=$watcher_pid mode=one-time log=$LOG_FILE lock=$LOCK_FILE"
    else
      echo "started pid=$watcher_pid interval=${INTERVAL}s log=$LOG_FILE lock=$LOCK_FILE"
    fi
    ;;
esac
