#!/usr/bin/env bash
# Host-side health check for the Pi's crontab (every 5 min, see scripts/install-health-cron.sh).
# The game server can't report its own death, so this script asks /api/health from outside:
#   - after HC_FAILS failures in a row (default 2): restarts the container (HC_RESTART=1, at most
#     HC_MAX_RESTARTS times per outage, then it leaves it to you) and mails the operator;
#   - while it stays down: a reminder every HC_REMIND_H hours (default 6);
#   - when it answers again: a "wieder erreichbar" mail with the outage length.
# Mails go through a fresh one-shot container (scripts/alert.ts), so they work while the game
# container is crashed. Recipient: ALERT_TO, else MAIL_FROM (from .env). Log: stdout (cron → ~/tk-health.log).
# Maintenance: `touch ~/.tk-health-pause` silences it (no restarts, no mails); rm to resume.
# Usage: scripts/healthcheck.sh   (run from anywhere; uses the compose project it lives in)
set -uo pipefail
export PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$(dirname "$0")/.." || exit 1

envval() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"; }
PORT="$(envval HOST_PORT)"; PORT="${PORT:-8787}"
URL="${HC_URL:-http://localhost:$PORT/api/health}"
FAILS_NEEDED="${HC_FAILS:-$(envval HC_FAILS)}"; FAILS_NEEDED="${FAILS_NEEDED:-2}"
RESTART="${HC_RESTART:-$(envval HC_RESTART)}"; RESTART="${RESTART:-1}"
MAX_RESTARTS="${HC_MAX_RESTARTS:-$(envval HC_MAX_RESTARTS)}"; MAX_RESTARTS="${MAX_RESTARTS:-3}"
REMIND_H="${HC_REMIND_H:-$(envval HC_REMIND_H)}"; REMIND_H="${REMIND_H:-6}"
STATE="${HC_STATE:-$HOME/.tk-health-state}"
SERVICE=tiefenkontakt

say() { echo "$(date '+%F %T') $*"; }

[ -f "$HOME/.tk-health-pause" ] && exit 0

# One run at a time (a slow mail must not overlap the next cron run)
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE.lock"
  flock -n 9 || { say "läuft schon, übersprungen"; exit 0; }
fi

fails=0; down_since=0; restarts=0; mailed_at=0
if [ -f "$STATE" ]; then
  while IFS='=' read -r k v; do
    case "$k" in fails|down_since|restarts|mailed_at) [[ "$v" =~ ^[0-9]+$ ]] && printf -v "$k" '%s' "$v" ;; esac
  done < "$STATE"
fi
save() { printf 'fails=%s\ndown_since=%s\nrestarts=%s\nmailed_at=%s\n' "$fails" "$down_since" "$restarts" "$mailed_at" > "$STATE"; }

mail() {
  # $1 subject, $2 body; fresh container, independent of the (maybe dead) game container
  if timeout 240 docker compose run --rm --no-deps -T -w /app "$SERVICE" node --import tsx scripts/alert.ts "$1" "$2"; then
    say "Mail verschickt: $1"
  else
    say "Mail fehlgeschlagen: $1"
    return 1
  fi
}

now=$(date +%s)
host="$(hostname)"

if curl -fsS -m 10 -o /dev/null "$URL" 2>/dev/null; then
  if [ "$mailed_at" -gt 0 ]; then
    mins=$(( (now - down_since) / 60 ))
    say "wieder erreichbar nach $mins min ($restarts Neustart(s))"
    mail "Tiefenkontakt wieder erreichbar ($host)" "Der Server antwortet wieder auf $URL.
Ausfall: etwa $mins min, $fails fehlgeschlagene Prüfungen, $restarts automatische(r) Neustart(s)."
  elif [ "$fails" -gt 0 ]; then
    say "wieder ok nach $fails Fehlversuch(en)"
  fi
  fails=0; down_since=0; restarts=0; mailed_at=0
  save
  exit 0
fi

fails=$((fails + 1))
[ "$down_since" -eq 0 ] && down_since=$now
say "Health-Check fehlgeschlagen ($fails in Folge): $URL"

if [ "$fails" -ge "$FAILS_NEEDED" ]; then
  action="kein automatischer Neustart (HC_RESTART=0)"
  if [ "$RESTART" = "1" ]; then
    if [ "$restarts" -ge "$MAX_RESTARTS" ]; then
      action="schon $restarts Neustarts in diesem Ausfall: kein weiterer, bitte selbst nachsehen"
    elif [ $(( (fails - FAILS_NEEDED) % FAILS_NEEDED )) -eq 0 ]; then
      say "starte Container neu: docker compose restart $SERVICE"
      if timeout 120 docker compose restart "$SERVICE"; then
        restarts=$((restarts + 1)); action="Container neu gestartet (Neustart $restarts von höchstens $MAX_RESTARTS)"
      else
        action="Neustart fehlgeschlagen (docker compose restart)"
      fi
      say "$action"
    else
      action="Neustart $restarts von höchstens $MAX_RESTARTS läuft, nächster Versuch bei der nächsten Prüfung"
    fi
  fi
  save
  if [ "$mailed_at" -eq 0 ] || [ $((now - mailed_at)) -ge $((REMIND_H * 3600)) ]; then
    mins=$(( (now - down_since) / 60 ))
    status="$(timeout 30 docker compose ps "$SERVICE" 2>&1 | tail -5)"
    logs="$(timeout 30 docker compose logs --no-color --tail 30 "$SERVICE" 2>&1 | tail -30)"
    if mail "Tiefenkontakt ALARM: Server antwortet nicht ($host)" "$URL antwortet seit etwa $mins min nicht ($fails Prüfungen in Folge).
Maßnahme: $action

docker compose ps:
$status

Letzte Logzeilen:
$logs"; then
      mailed_at=$now
    fi
  fi
fi
save
exit 0
