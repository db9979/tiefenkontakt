#!/usr/bin/env bash
# Install (or update) the health cron jobs on the Pi. Idempotent: old tk-health / tk-restore
# lines are replaced, everything else in the crontab stays.
#   */5 min   scripts/healthcheck.sh: /api/health from the host; restart + mail when it's down
#   Sun 04:15 scripts/restore-test.ts in a one-shot container: newest backup restored and
#             started on a free port, report by mail (ALERT_TO, else MAIL_FROM)
# Usage: ./scripts/install-health-cron.sh [user@host|local] [remote dir] [--no-restore-test]
#   local = run on this machine (e.g. directly on the Pi) instead of over SSH.
# Remove:  ssh speech@speech.local 'crontab -l | grep -v -e tk-health -e tk-restore | crontab -'
set -euo pipefail
RESTORE=1
POS=()
for a in "$@"; do
  case "$a" in
    --no-restore-test) RESTORE=0 ;;
    *) POS+=("$a") ;;
  esac
done
HOST="${POS[0]:-speech@speech.local}"
DIR="${POS[1]:-tiefenkontakt}"

HEALTH="*/5 * * * * bash \$HOME/$DIR/scripts/healthcheck.sh >> \$HOME/tk-health.log 2>&1 # tk-health"
RESTORE_LINE="15 4 * * 0 cd \$HOME/$DIR && docker compose run --rm --no-deps -T -w /app tiefenkontakt node --import tsx scripts/restore-test.ts --mail >> \$HOME/tk-restore.log 2>&1 # tk-restore"
NEW="echo \"$HEALTH\""
[ "$RESTORE" = 1 ] && NEW="$NEW; echo \"$RESTORE_LINE\""
CMD="test -f \$HOME/$DIR/scripts/healthcheck.sh || { echo 'scripts/healthcheck.sh fehlt auf dem Host: erst scripts/deploy-pi.sh'; exit 1; }; \
( crontab -l 2>/dev/null | grep -v -e 'tk-health' -e 'tk-restore' ; $NEW ) | crontab - && crontab -l | grep -e tk-health -e tk-restore"

if [ "$HOST" = local ]; then
  bash -c "$CMD"
else
  ssh "$HOST" "$CMD"
fi
