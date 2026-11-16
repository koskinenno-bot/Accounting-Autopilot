#!/usr/bin/env bash
# Päivittää ohjelman: riippuvuudet, tietokantojen rakenne, Python-ympäristö ja dashboard,
# ja käynnistää palvelun uudelleen. asenna.sh kutsuu tätä; myöhemmin aja itse päivityksen jälkeen:
#   sudo deploy/paivita.sh            (kun koodi on päivitetty, esim. git pull)
# Ennen tietokantamuutoksia otetaan varmuuskopio.
set -euo pipefail
APPDIR="$(cd "$(dirname "$0")/.." && pwd)"
APPUSER="${APPUSER:-kirjanpito}"
cd "$APPDIR"
[ "$(id -u)" -eq 0 ] || { echo "Aja rootina: sudo $0" >&2; exit 1; }
[ -f apps/server/.env ] || { echo "apps/server/.env puuttuu. Aja ensin deploy/asenna.sh" >&2; exit 1; }
as_app() { runuser -u "$APPUSER" -- "$@"; }
step() { printf '\n=== %s ===\n' "$1"; }
envval() { grep -E "^$1=" apps/server/.env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

chown -R "$APPUSER:$APPUSER" "$APPDIR"

if [ "${SKIP_BACKUP:-}" != "1" ] && docker ps -q -f name=ai-accountant-postgres | grep -q .; then
  step 'Varmuuskopio ennen päivitystä'
  scripts/varmuuskopio.sh /var/backups/kirjanpito 30
fi

step 'Node-riippuvuudet'
# Kehitysriippuvuudet tarvitaan (ts-node, prisma, vite), vaikka NODE_ENV olisi production
as_app env HOME="$APPDIR" npm ci --include=dev --no-audit --no-fund

step 'Tietokantojen rakenne'
for pair in user-service:USER accounting-service:ACCOUNTING audit-service:AUDIT invoicing-service:INVOICING \
            bank-service:BANK voucher-service:VOUCHER document-service:DOCUMENT notification-service:NOTIFICATION; do
  svc="${pair%%:*}"; var="${pair##*:}_DATABASE_URL"
  url="$(envval "$var")"
  [ -n "$url" ] || { echo "$var puuttuu tiedostosta apps/server/.env" >&2; exit 1; }
  echo "-- $svc"
  ( cd "apps/$svc" && as_app env HOME="$APPDIR" DATABASE_URL="$url" npx prisma generate >/dev/null \
    && as_app env HOME="$APPDIR" DATABASE_URL="$url" npx prisma db push --skip-generate )
  # db push pysähtyy (ei poista tietoja), jos muutos vaatisi tietojen poistoa: silloin selvitettävä käsin
done

step 'Python-ympäristö (raportit ja tekoälyluku)'
[ -x .venv/bin/python ] || as_app python3 -m venv .venv
as_app .venv/bin/pip install -q --upgrade pip
as_app .venv/bin/pip install -q -r apps/reporting-service/requirements.txt anthropic pypdf

step 'Dashboard'
as_app env HOME="$APPDIR" npm run build:single --workspace admin-dashboard

step 'Käynnistetään palvelu uudelleen'
systemctl restart kirjanpito
PORT="$(envval PORT)"; PORT="${PORT:-3000}"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    curl -sS "http://127.0.0.1:$PORT/health"; echo
    echo 'Valmis.'
    exit 0
  fi
  sleep 2
done
echo 'Palvelu ei vastaa. Katso loki: journalctl -u kirjanpito -n 100' >&2
exit 1
