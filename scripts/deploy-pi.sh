#!/usr/bin/env bash
# Deploy Tiefenkontakt to a Raspberry Pi (or any Linux host with Docker) over SSH.
# Usage: scripts/deploy-pi.sh [user@host] [remote dir]
# Needs SSH key login (ssh-copy-id user@host once). The remote .env is never overwritten.
set -euo pipefail
HOST="${1:-speech@speech.local}"
DIR="${2:-tiefenkontakt}"
cd "$(dirname "$0")/.."

echo "▸ Kopiere Code nach $HOST:~/$DIR"
ssh "$HOST" "mkdir -p ~/$DIR"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude .matches --exclude '*.db' --exclude '*.db-journal' \
  --exclude .env --exclude .claude --exclude .DS_Store --exclude backup-mirror \
  ./ "$HOST:~/$DIR/"

echo "▸ Prüfe Funk-Schlüssel in .env (fehlende werden zufällig erzeugt, nie ausgegeben)"
ssh "$HOST" "cd ~/$DIR && ( [ -f .env ] || cp .env.example .env ) && rnd() { od -An -tx1 -N\$1 /dev/urandom | tr -d ' \\n'; } && \
  for k in TURN_SECRET LIVEKIT_SECRET; do grep -qE \"^\$k=.+\" .env || { sed -i \"/^\$k=/d\" .env; echo \"\$k=\$(rnd 24)\" >> .env; }; done && \
  { grep -qE '^LIVEKIT_KEY=.+' .env || { sed -i '/^LIVEKIT_KEY=/d' .env; echo \"LIVEKIT_KEY=tk\$(rnd 4)\" >> .env; }; }"

echo "▸ Baue und starte den Container (beim ersten Mal einige Minuten)"
ssh "$HOST" "cd ~/$DIR && docker compose up -d --build"

echo "▸ Warte auf den Server"
for i in $(seq 1 60); do
  if ssh "$HOST" "curl -sf localhost:\$(grep -E '^HOST_PORT=' ~/$DIR/.env | cut -d= -f2 || echo 8787)/api/health >/dev/null 2>&1 || curl -sf localhost:8787/api/health >/dev/null"; then
    echo "✓ Läuft auf $HOST"
    exit 0
  fi
  sleep 3
done
echo "✗ Server antwortet nicht – Logs:"
ssh "$HOST" "cd ~/$DIR && docker compose logs --tail 40"
exit 1
