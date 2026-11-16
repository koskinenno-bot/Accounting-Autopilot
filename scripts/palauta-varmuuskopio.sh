#!/usr/bin/env bash
# Palauttaa Linux-palvelimen varmuuskopion (scripts/varmuuskopio.sh). KORVAA nykyiset tiedot.
#   sudo scripts/palauta-varmuuskopio.sh /var/backups/kirjanpito/varmuuskopio-20261116-0215
# Uudelle palvelimelle: aja ensin deploy/asenna.sh, sitten tämä. Asetukset (salasanat) palautetaan
# varmuuskopiosta, koska tietokannan salasana tulee dumpin mukana.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
[ -d "$SRC" ] || { echo "Käyttö: sudo $0 <varmuuskopiokansio>" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Aja rootina" >&2; exit 1; }
SRC="$(cd "$SRC" && pwd)"

echo 'Tarkistetaan tiivisteet...'
# Windows-kopion (varmuuskopio.ps1) tiivistelistassa on CRLF-rivinvaihdot
(cd "$SRC" && tr -d '\r' < SHA256SUMS.txt | sha256sum --quiet -c -) || { echo 'Varmuuskopio on vioittunut. Palautus keskeytetty.' >&2; exit 1; }
[ -f "$SRC/kannat.sql.gz" ] || { echo 'kannat.sql.gz puuttuu' >&2; exit 1; }

if [ "${VAHVISTA:-}" != "KYLLÄ" ]; then
  read -r -p "Palautetaanko $SRC? Nykyiset tiedot korvataan. Kirjoita KYLLÄ: " vastaus
  [ "$vastaus" = "KYLLÄ" ] || { echo 'Peruttu.'; exit 1; }
fi

has_service() { command -v systemctl >/dev/null && systemctl list-unit-files kirjanpito.service >/dev/null 2>&1; }
has_service && systemctl stop kirjanpito || true

if [ -f "$SRC/asetukset.tgz" ]; then
  echo '1/4 Asetukset...'
  tar xzf "$SRC/asetukset.tgz" -C "$ROOT"
  chmod 600 "$ROOT/apps/server/.env" "$ROOT/deploy/.env" 2>/dev/null || true
fi

echo '2/4 Tietokannat...'
# Yhteydet katki ennen kantojen pudotusta; virheet lokiin
gunzip -c "$SRC/kannat.sql.gz" | docker exec -i ai-accountant-postgres psql -q -v ON_ERROR_STOP=0 -U admin -d postgres > /tmp/palautus.log 2>&1 || true
if grep -q 'FATAL' /tmp/palautus.log; then echo 'Tietokantojen palautus epäonnistui, ks. /tmp/palautus.log' >&2; exit 1; fi
# Dumpin mukana tulee myös kannan käyttäjän salasana (esim. kehityskoneen 'password'):
# palautetaan se tämän palvelimen asetusten mukaiseksi
if [ -f "$ROOT/deploy/.env" ]; then
  PGPASS="$(grep '^POSTGRES_PASSWORD=' "$ROOT/deploy/.env" | cut -d= -f2-)"
  printf "ALTER ROLE admin PASSWORD '%s';\n" "${PGPASS//\'/\'\'}" | docker exec -i ai-accountant-postgres psql -q -U admin -d postgres >/dev/null
fi

echo '3/4 Tositteet ja dokumentit...'
# .tgz = Linux-kopio (sisältää kansion), .zip = Windows-kopio (sisältää kansion sisällön)
restore_dir() { # <tgz> <zip> <emokansio> <kansio>
  if [ -f "$1" ]; then rm -rf "$3/$4"; tar xzf "$1" -C "$3"
  elif [ -f "$2" ]; then rm -rf "$3/$4"; mkdir -p "$3/$4"; unzip -q -o "$2" -d "$3/$4"; fi
}
restore_dir "$SRC/tositteet.tgz" "$SRC/tositteet.zip" "$ROOT/apps/voucher-service" files
restore_dir "$SRC/dokumentit.tgz" "$SRC/dokumentit.zip" "$ROOT/apps/document-service" uploads
if [ -f "$SRC/minio.tgz" ] && [ -n "$(docker ps -q -f name=ai-accountant-minio)" ]; then
  docker exec -i ai-accountant-minio sh -c 'rm -rf /bitnami/minio/data/* && tar xzf - -C /bitnami/minio' < "$SRC/minio.tgz"
fi
id kirjanpito >/dev/null 2>&1 && chown -R kirjanpito:kirjanpito "$ROOT"

echo '4/4 Käynnistys...'
has_service && systemctl start kirjanpito || echo 'Käynnistä ohjelma.'
echo "Palautus valmis. Varoitukset: /tmp/palautus.log"
