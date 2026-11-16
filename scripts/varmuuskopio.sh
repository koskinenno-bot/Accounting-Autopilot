#!/usr/bin/env bash
# Varmuuskopio Linux-palvelimelle (sama sisältö kuin varmuuskopio.ps1).
# Ajastus: crontab -e  ->  15 2 * * * /polku/scripts/varmuuskopio.sh /var/backups/taloyhtio 30
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/varmuuskopiot}"
KEEP="${2:-30}"
DIR="$DEST/varmuuskopio-$(date +%Y%m%d-%H%M)"
umask 077
mkdir -p "$DIR"

docker exec ai-accountant-postgres pg_dumpall -U admin --clean --if-exists | gzip > "$DIR/kannat.sql.gz"
if [ -n "$(docker ps -q -f name=ai-accountant-minio)" ]; then
  docker exec ai-accountant-minio tar czf - -C /bitnami/minio data > "$DIR/minio.tgz"
fi
# Yhden prosessin palvelin tallentaa tositteet levylle
if [ -d "$ROOT/apps/voucher-service/files" ]; then
  tar czf "$DIR/tositteet.tgz" -C "$ROOT/apps/voucher-service" files
fi
if [ -d "$ROOT/apps/document-service/uploads" ]; then
  tar czf "$DIR/dokumentit.tgz" -C "$ROOT/apps/document-service" uploads
fi
# Palvelimen asetukset (tietokannan salasana on myös dumpissa, joten ne kuuluvat yhteen palautuksessa).
# Sisältää salaisuuksia: säilytä kopiot salattuina. Pankin .pem-avainta ei oteta mukaan.
conf=()
for f in apps/server/.env deploy/.env; do [ -f "$ROOT/$f" ] && conf+=("$f"); done
if [ ${#conf[@]} -gt 0 ]; then tar czf "$DIR/asetukset.tgz" -C "$ROOT" "${conf[@]}"; fi
# Tyhjä dump = virhe (esim. kanta alhaalla)
[ "$(gzip -dc "$DIR/kannat.sql.gz" | head -c 100 | wc -c)" -gt 0 ] || { echo "Tietokantadump on tyhjä" >&2; exit 1; }
(cd "$DIR" && sha256sum -- * > SHA256SUMS.txt)
echo "Valmis: $DIR ($(du -sh "$DIR" | cut -f1))"
ls -1d "$DEST"/varmuuskopio-* 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
