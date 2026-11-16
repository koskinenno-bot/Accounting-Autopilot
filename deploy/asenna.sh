#!/usr/bin/env bash
# Ensiasennus Ubuntu 24.04 -palvelimelle (esim. Hetzner, UpCloud tai muu EU-palvelin).
#
#   1. Osoita domain (A-tietue) palvelimen IP-osoitteeseen.
#   2. Kopioi ohjelma palvelimelle, esim.  sudo git clone <repo> /opt/kirjanpito
#   3. sudo /opt/kirjanpito/deploy/asenna.sh kirjanpito.example.fi
#
# Asentaa Dockerin, Node.js 22:n, Pythonin ja Caddyn, luo käyttäjän kirjanpito, arpoo salasanat
# ja salaisuudet, käynnistää tietokannan, rakentaa ohjelman, asettaa sen käynnistymään automaattisesti,
# HTTPS:n, palomuurin ja päivittäisen varmuuskopion. Voi ajaa uudelleen: olemassa olevia salasanoja ei vaihdeta.
set -euo pipefail
DOMAIN="${1:-}"
APPDIR="$(cd "$(dirname "$0")/.." && pwd)"
APPUSER=kirjanpito
BACKUPS=/var/backups/kirjanpito
[ "$(id -u)" -eq 0 ] || { echo "Aja rootina: sudo $0 <domain>" >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "Käyttö: sudo $0 kirjanpito.example.fi" >&2; exit 1; }
step() { printf '\n=== %s ===\n' "$1"; }
secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-48; }

step 'Järjestelmäpaketit'
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg openssl git unzip python3 python3-venv docker.io docker-compose-v2 caddy ufw cron
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  # Node.js 22 NodeSourcen pakettivarastosta (Ubuntun oma versio on liian vanha)
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q && apt-get install -y -q nodejs
fi
systemctl enable --now docker cron

step 'Käyttäjä ja kansiot'
id "$APPUSER" >/dev/null 2>&1 || useradd --system --home-dir "$APPDIR" --shell /usr/sbin/nologin "$APPUSER"
install -d -m 0700 "$BACKUPS"
chown -R "$APPUSER:$APPUSER" "$APPDIR"
# root ajaa päivityksessä git pullin kansiossa, jonka omistaa kirjanpito
git config --system --add safe.directory "$APPDIR" 2>/dev/null || true

step 'Salasanat ja asetukset'
if [ ! -f "$APPDIR/deploy/.env" ]; then
  ( umask 077; printf 'POSTGRES_PASSWORD=%s\n' "$(secret)" > "$APPDIR/deploy/.env" )
  echo 'Luotiin deploy/.env (tietokannan salasana)'
fi
PGPASS="$(grep '^POSTGRES_PASSWORD=' "$APPDIR/deploy/.env" | cut -d= -f2-)"
if [ ! -f "$APPDIR/apps/server/.env" ]; then
  db() { printf 'postgresql://admin:%s@127.0.0.1:5432/%s?schema=public' "$PGPASS" "$1"; }
  touch "$APPDIR/apps/server/.env" && chmod 600 "$APPDIR/apps/server/.env"
  cat > "$APPDIR/apps/server/.env" <<EOF
# Tuotannon asetukset (asenna.sh). Pidä salassa: sisältää salasanat.
NODE_ENV=production
PORT=3000
APP_URL=https://$DOMAIN
DASHBOARD_URL=https://$DOMAIN
JWT_SECRET=$(secret)
SERVICE_TOKEN=$(secret)
USER_DATABASE_URL=$(db user_service)
ACCOUNTING_DATABASE_URL=$(db accounting_service)
VOUCHER_DATABASE_URL=$(db voucher_service)
INVOICING_DATABASE_URL=$(db billing_service)
BANK_DATABASE_URL=$(db bank_service)
DOCUMENT_DATABASE_URL=$(db document_service)
NOTIFICATION_DATABASE_URL=$(db notification_service)
AUDIT_DATABASE_URL=$(db common_audit_log)
VOUCHER_STORAGE=local
PYTHON=$APPDIR/.venv/bin/python
# Sähköposti: ilman näitä viestit tallentuvat kansioon apps/notification-service/outbox eikä mitään lähetetä
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
# Tekoälyluku (tositteet ja PDF-tiliotteet). Ilman avainta vain tekstipohjaiset PDF:t luetaan.
ANTHROPIC_API_KEY=
# Pankkiyhteys (Enable Banking): .pem-avain kansioon apps/bank-service/salaiset (oikeudet 600, omistaja kirjanpito)
ENABLE_BANKING_REDIRECT_URL=https://$DOMAIN/bank-connections/callback
EOF
  echo 'Luotiin apps/server/.env (salaisuudet arvottu). Täydennä SMTP- ja tekoälyasetukset myöhemmin.'
fi
chown "$APPUSER:$APPUSER" "$APPDIR/apps/server/.env" "$APPDIR/deploy/.env"
chmod 600 "$APPDIR/apps/server/.env" "$APPDIR/deploy/.env"

step 'Tietokanta (Docker)'
docker compose -f "$APPDIR/deploy/docker-compose.yml" --env-file "$APPDIR/deploy/.env" up -d --wait

step 'Palvelu (systemd)'
sed "s#APPDIR#$APPDIR#g" "$APPDIR/deploy/kirjanpito.service" > /etc/systemd/system/kirjanpito.service
systemctl daemon-reload
systemctl enable kirjanpito

step 'Ohjelman rakennus'
SKIP_BACKUP=1 APPUSER="$APPUSER" "$APPDIR/deploy/paivita.sh"

step 'HTTPS (Caddy)'
install -d -o caddy -g caddy /var/log/caddy
sed "s#DOMAIN#$DOMAIN#g" "$APPDIR/deploy/Caddyfile.malli" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy && systemctl reload-or-restart caddy

step 'Palomuuri'
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -8

step 'Päivittäinen varmuuskopio (klo 02.15)'
cat > /etc/cron.d/kirjanpito-varmuuskopio <<EOF
15 2 * * * root $APPDIR/scripts/varmuuskopio.sh $BACKUPS 30 >> /var/log/kirjanpito-varmuuskopio.log 2>&1
EOF
chmod 644 /etc/cron.d/kirjanpito-varmuuskopio

cat <<EOF

Valmis: https://$DOMAIN
- Ensimmäinen käyttäjä: avaa osoite ja rekisteröidy (hänestä tulee toimiston omistaja).
- Asetukset: $APPDIR/apps/server/.env  ->  muutoksen jälkeen: sudo systemctl restart kirjanpito
- Loki: journalctl -u kirjanpito -f
- Varmuuskopiot: $BACKUPS (kopioi ne myös toiseen paikkaan, ks. deploy/LUEMINUT.md)
- Päivitys: cd $APPDIR && sudo git pull && sudo deploy/paivita.sh
EOF
