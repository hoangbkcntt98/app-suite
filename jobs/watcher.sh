#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/jobs/create_grammar_video_jobs.py"
PYTHON_PATH="$ROOT_DIR/jobs/app-tools/.venv/bin/python"
DEFAULT_CONFIG="$ROOT_DIR/jobs/app-tools/config.json"
WATCHER_NAME="create_grammar_video_jobs"

usage() {
  cat <<'EOF'
Usage:
  jobs/watcher.sh start create_grammar_video_jobs.py [--interval SECONDS] [job options...]
  jobs/watcher.sh stop  create_grammar_video_jobs.py [--config PATH]
  jobs/watcher.sh status create_grammar_video_jobs.py [--config PATH]

Example:
  jobs/watcher.sh start create_grammar_video_jobs.py --interval 10 --config jobs/app-tools/config.json
EOF
}

if [[ "${1:-}" == "__watch" ]]; then
  shift
  LOG_DIR="$1"
  LOG_FILE="$2"
  LOCK_FILE="$3"
  INTERVAL="$4"
  CONFIG_PATH="$5"
  shift 5
  JOB_ARGS=("$@")
  cd -- "$ROOT_DIR"
  exec 9>"$LOCK_FILE"
  child_pid=""

  stop_watcher() {
    if [[ -n "$child_pid" ]]; then
      kill -TERM "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
      child_pid=""
    fi
    flock -u 9 2>/dev/null || true
    exit 0
  }
  trap stop_watcher TERM INT

  while true; do
    if flock -n 9; then
      printf '%s Starting %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$WATCHER_NAME" >>"$LOG_FILE"
      "$PYTHON_PATH" "$SCRIPT_PATH" --config "$CONFIG_PATH" "${JOB_ARGS[@]}" >>"$LOG_FILE" 2>&1 &
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
      printf '%s Skipping tick; another watcher holds lock\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG_FILE"
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

JOB_NAME="$WATCHER_NAME.py"
if [[ $# -gt 0 && "$1" != --* ]]; then
  JOB_NAME="$(basename -- "$1")"
  shift
fi
if [[ "$JOB_NAME" != "$WATCHER_NAME.py" ]]; then
  echo "Unsupported job: $JOB_NAME" >&2
  exit 2
fi

INTERVAL=10
CONFIG_PATH="$DEFAULT_CONFIG"
JOB_ARGS=()
while (($#)); do
  case "$1" in
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
  python3 - "$CONFIG_PATH" "$ROOT_DIR" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
root = Path(sys.argv[2])
with config_path.open(encoding="utf-8") as stream:
    config = json.load(stream)
job = config.get("job_config", {}).get("create_grammar_video_jobs", {})
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
      [[ -f "$INTERVAL_FILE" ]] && INTERVAL="$(cat "$INTERVAL_FILE")"
      printf 'running pid=%s interval=%ss log=%s\n' "$(cat "$PID_FILE")" "$INTERVAL" "$LOG_FILE"
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
    printf '%s\n' "$INTERVAL" >"$INTERVAL_FILE"
    nohup "$ROOT_DIR/jobs/watcher.sh" __watch "$LOG_DIR" "$LOG_FILE" "$LOCK_FILE" "$INTERVAL" "$CONFIG_PATH" "${JOB_ARGS[@]}" \
      >/dev/null 2>&1 &
    echo "$!" >"$PID_FILE"
    echo "started pid=$! interval=${INTERVAL}s log=$LOG_FILE lock=$LOCK_FILE"
    ;;
esac
