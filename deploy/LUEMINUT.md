# Asennus palvelimelle (pilotti)

Ohjelma ajetaan yhtenä palveluna (`apps/server`) ja tietokanta Dockerissa. Kafkaa, Kongia, Redistä ja
MinIOta ei tarvita. Caddy hoitaa HTTPS:n ja varmenteen automaattisesti.

## Mitä tarvitaan
- **Palvelin**: Ubuntu 24.04, 2 prosessoria, 4 Gt muistia, 40 Gt levyä. EU:ssa, mieluiten Suomessa
  (esim. Hetzner Helsinki tai UpCloud Helsinki), koska kirjanpidossa on henkilötietoja.
  Hinta on noin 5–15 € kuukaudessa.
- **Domain** ja sen DNS: A-tietue (esim. `kirjanpito.example.fi`) osoittaa palvelimen IP-osoitteeseen.
- SSH-yhteys palvelimelle.

## Asennus (noin 10 minuuttia)
```bash
sudo git clone <repon osoite> /opt/kirjanpito
sudo /opt/kirjanpito/deploy/asenna.sh kirjanpito.example.fi
```
Skripti asentaa tarvittavat ohjelmat, luo käyttäjän `kirjanpito`, arpoo salasanat ja salaisuudet
(`apps/server/.env` ja `deploy/.env`, vain rootin ja ohjelman luettavissa), käynnistää tietokannan,
rakentaa ohjelman ja ottaa käyttöön automaattisen käynnistyksen, HTTPS:n, palomuurin (vain SSH, 80 ja 443)
ja päivittäisen varmuuskopion klo 02.15. Skriptin voi ajaa uudelleen: salasanoja ei vaihdeta.

Avaa sitten `https://kirjanpito.example.fi` ja rekisteröidy. Ensimmäisestä käyttäjästä tulee toimiston omistaja.

## Asennuksen jälkeen
Muokkaa tiedostoa `/opt/kirjanpito/apps/server/.env` ja käynnistä ohjelma uudelleen (`sudo systemctl restart kirjanpito`):
- **Sähköposti**: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Ilman näitä viestit tallentuvat kansioon
  `apps/notification-service/outbox` eikä mitään lähetetä. Domainille tarvitaan SPF ja DKIM (ks. PARANNUKSET.md).
- **Tekoälyluku**: `ANTHROPIC_API_KEY`.
- **Pankkiyhteys**: kopioi Enable Bankingin .pem-avain palvelimelle omalta koneelta (älä lähetä sitä sähköpostilla):
  ```bash
  scp avain.pem palvelin:/tmp/ && ssh palvelin
  sudo install -o kirjanpito -g kirjanpito -m 600 /tmp/avain.pem /opt/kirjanpito/apps/bank-service/salaiset/ && rm /tmp/avain.pem
  ```
  Enable Bankingin sovellukseen paluuosoitteeksi `https://kirjanpito.example.fi/bank-connections/callback`.

## Nykyisten tietojen siirto omalta koneelta
1. Siirrä vanhat tositteet MinIOsta levylle (palvelimella ei ole MinIOta). Omalla koneella, ohjelma käynnissä:
   ```
   cd apps\voucher-service
   node --require ts-node/register/transpile-only src/tools/siirraLevylle.ts
   ```
   Skripti tarkistaa jokaisen tiedoston tiivisteellä ja kertoo, montako siirtyi. MinIOn tiedostot jäävät ennalleen.
2. Ota varmuuskopio: `powershell -ExecutionPolicy Bypass -File .\scripts\varmuuskopio.ps1`
3. Kopioi varmuuskopiokansio palvelimelle ja palauta:
   ```bash
   scp -r varmuuskopio-20261116-1200 palvelin:/tmp/
   sudo /opt/kirjanpito/scripts/palauta-varmuuskopio.sh /tmp/varmuuskopio-20261116-1200
   ```
   Palautus tarkistaa tiivisteet, pyytää vahvistuksen (KYLLÄ), palauttaa kannat, tositteet ja dokumentit
   ja asettaa tietokannan salasanan palvelimen asetusten mukaiseksi.

## Päivitys
```bash
cd /opt/kirjanpito && sudo git pull && sudo deploy/paivita.sh
```
Päivitys ottaa ensin varmuuskopion, sitten asentaa riippuvuudet, päivittää kantojen rakenteen ja dashboardin
ja käynnistää ohjelman uudelleen. Jos kannan muutos vaatisi tietojen poistoa, päivitys pysähtyy eikä poista mitään.

## Varmuuskopiot
- Joka yö klo 02.15 kansioon `/var/backups/kirjanpito` (30 uusinta). Loki: `/var/log/kirjanpito-varmuuskopio.log`.
- Kopio sisältää kannat, tositteet, dokumentit ja asetukset (salasanat), mutta ei pankin .pem-avainta.
- **Kopioi varmuuskopiot myös toiseen paikkaan**, salattuina, esim. Hetzner Storage Box tai muu EU-tallennus
  `rclone`-ohjelman salatulla (crypt) kohteella. Palvelimen levy ei yksin riitä.
- Kokeile palautusta kerran ennen pilottia (esim. uudelle testipalvelimelle): `scripts/palauta-varmuuskopio.sh`.

## Käyttö ja vianetsintä
| Mitä | Komento |
| --- | --- |
| Tila | `systemctl status kirjanpito` tai `curl http://127.0.0.1:3000/health` |
| Loki | `journalctl -u kirjanpito -f` |
| Uudelleenkäynnistys | `sudo systemctl restart kirjanpito` |
| HTTPS-loki | `/var/log/caddy/kirjanpito.log` |
| Tietokanta | `docker ps` (kontti `ai-accountant-postgres`) |

Seurantaan sopii ilmainen palvelu (esim. UptimeRobot), joka tarkistaa osoitteen `https://<domain>/health`
muutaman minuutin välein ja hälyttää sähköpostilla. Osoite palauttaa 503, jos raporttipalvelu ei vastaa.

## Testattu
Asennuksen rakennusvaihe (`paivita.sh`) puhtaalla Ubuntu 24.04 -kloonilla tuotantotilassa: riippuvuudet,
kannat, Python-ympäristö, dashboard ja käynnistys. Kaikki 55 päästä päähän -tarkistusta menivät läpi.
Varmuuskopio ja palautus testattiin koko kierroksena (myös Windows-koneen kopiosta), ja vioittunut
kopio pysäytti palautuksen. Tositteiden siirto MinIOsta levylle testattiin S3-yhteensopivaa palvelinta
vasten. Dockeria, systemd:tä ja Caddyä ei ollut testiympäristössä, joten ne varmistuvat ensimmäisessä
oikeassa asennuksessa.
