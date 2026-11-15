#!/usr/bin/env bash
# Varmuuskopio Linux-palvelimelle (sama sisältö kuin varmuuskopio.ps1).
# Ajastus: crontab -e  ->  15 2 * * * /polku/scripts/varmuuskopio.sh /var/backups/taloyhtio 30
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/varmuuskopiot}"
KEEP="${2:-30}"
DIR="$DEST/varmuuskopio-$(date +%Y%m%d-%H%M)"
mkdir -p "$DIR"
umask 077

docker exec ai-accountant-postgres pg_dumpall -U admin --clean --if-exists | gzip > "$DIR/kannat.sql.gz"
docker exec ai-accountant-minio tar czf - -C /bitnami/minio data > "$DIR/minio.tgz"
if [ -d "$ROOT/apps/document-service/uploads" ]; then
  tar czf "$DIR/dokumentit.tgz" -C "$ROOT/apps/document-service" uploads
fi
# Tyhjä dump = virhe (esim. kanta alhaalla)
[ "$(gzip -dc "$DIR/kannat.sql.gz" | head -c 100 | wc -c)" -gt 0 ] || { echo "Tietokantadump on tyhjä" >&2; exit 1; }
(cd "$DIR" && sha256sum -- * > SHA256SUMS.txt)
echo "Valmis: $DIR ($(du -sh "$DIR" | cut -f1))"
ls -1d "$DEST"/varmuuskopio-* 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
