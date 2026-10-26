#!/usr/bin/env bash
# What cron calls (see docs/scheduling.md): one publishing run, logged to logs/publish.log.
# It publishes at most one post (dated today, ready, its time has come) and exits.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
# cron starts it 5 times per slot (e.g. 9:00 to 9:08). A quiet check first: a try with nothing due
# (already published, or its time has not come) leaves no trace in the log.
/usr/bin/env python3 scripts/publish.py --due >> logs/publish.log 2>&1 || exit 0
{
  echo "=== $(date -Iseconds) run"
  # publish.py writes its own lines to the log; only errors (stderr) are added here.
  /usr/bin/env python3 scripts/publish.py > /dev/null
  echo "=== exit $?"
} >> logs/publish.log 2>&1
