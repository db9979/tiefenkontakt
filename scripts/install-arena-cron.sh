#!/usr/bin/env bash
# Install (or update) the nightly bot-arena balance run on the Pi: 03:30 every night, inside the
# game container, result by mail (scripts/arena-report.ts). Idempotent; remove with
#   ssh speech@speech.local 'crontab -l | grep -v tk-arena | crontab -'
# Usage: ./scripts/install-arena-cron.sh [user@host] [games]
set -euo pipefail
HOST="${1:-speech@speech.local}"
GAMES="${2:-90}"
LINE="30 3 * * * docker exec tiefenkontakt-tiefenkontakt-1 sh -c 'cd /app && node --import tsx scripts/arena-report.ts $GAMES' >> \$HOME/arena.log 2>&1 # tk-arena"
ssh "$HOST" "( crontab -l 2>/dev/null | grep -v 'tk-arena' ; echo \"$LINE\" ) | crontab - && crontab -l | grep tk-arena"
