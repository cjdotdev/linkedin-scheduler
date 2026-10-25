#!/usr/bin/env bash
# What cron calls (see docs/scheduling.md): one publishing run, logged to logs/publish.log.
# It publishes at most one post (dated today, ready, its time has come) and exits.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
{
  echo "=== $(date -Iseconds) run"
  # publish.py writes its own lines to the log; only errors (stderr) are added here.
  /usr/bin/env python3 scripts/publish.py > /dev/null
  echo "=== exit $?"
} >> logs/publish.log 2>&1
