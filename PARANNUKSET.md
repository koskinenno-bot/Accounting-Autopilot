# AI ACCOUNT_V3 – korjaukset ja parannukset (1.11.2026)

Kansio on nyt git-repo (ensimmäinen commit sisältää kaikki muutokset). Alkuperäiset
muutetut tiedostot ovat kansiossa `_varmuuskopio_claude_2026-11-01/` (gitin ulkopuolella).
Voit poistaa varmuuskopion, kun olet todennut kaiken toimivan.

## Käyttöönotto – aja nämä kerran

```powershell
# 1. Riippuvuudet (uudet: axios, jsonwebtoken, ts-node, PyJWT)
npm install
pip install -r apps/reporting-service/requirements.txt
pip install -r apps/ml-service/requirements.txt

# 2. Tietokannat. Jos Postgres-volyymi on jo olemassa, luo puuttuva kanta käsin:
docker exec -it ai-accountant-postgres psql -U admin -d main_db -c "CREATE DATABASE notification_service;"

# 3. Prisma-clientit ja migraatiot (audit, laskutus ja tilikartta muuttuivat)
cd apps/audit-service;      npx prisma generate; npx prisma migrate dev --name audit_init
cd ../invoicing-service;    npx prisma generate; npx prisma migrate dev --name per_company_invoice_numbers
cd ../accounting-service;   npx prisma generate
cd ../user-service;         npx prisma generate

# 4. Testit
cd ../..; npm test
cd apps/reporting-service; python -m unittest discover -s tests
cd ../ml-service;          python -m unittest discover -s tests
```

Huom:
- **Kirjaudu uudelleen** – vanhat tunnisteet eivät enää kelpaa.
- Kaikissa `.env`-tiedostoissa on nyt sama `JWT_SECRET` ja `SERVICE_TOKEN`. Jos vaihdat niitä, vaihda kaikkiin. Mallit: `.env.example`.
- **Tilikartta muuttui** (mm. Isännöinti 8000 → 4000, Lämmitys 4100 → 4500). Jo luoduilla kehitysyhtiöillä on vanhat tilit; helpointa on luoda testiyhtiö uudelleen.
- Kong Admin -portti on nyt 8002 (8001 oli päällekkäin ml-servicen kanssa).

## Mitä korjattiin

### Kirjanpito (accounting-service)
- Pankkisuoritukset kahdensivat vastiketuotot → kirjataan nyt myyntisaamisia vastaan.
- Automaattikirjaukset (pankki, laskut, tositteet) kaatuivat: väärä Prisma-import, ristiriitaiset tilikartat, olemattomat tilit. Yksi tilikartta, tilivakiot `src/accounts.ts`.
- Audit-middleware ei koskenut yhtään kirjausta → yksi jaettu client `src/db.ts`.
- Käsikirjaukset kaatuivat (`companyId` puuttui riveiltä, `EntryStatus` importtaamatta).
- Tasetarkistus senteissä, rivikohtaiset tarkistukset, selkeät virheviestit.
- Kirjattua vientiä ei voi muokata eikä poistaa (KPL 2:7 §) – vain luonnoksia.
- Tuplakirjausten esto (deterministiset tositenumerot).
- Uudet rajapinnat: `POST /entries/:id/post` (luonnos → kirjattu), `PATCH/DELETE /entries/:id`, `GET/POST /fiscal-years`, `POST /fiscal-years/:id/close` (lukitsee viennit), `GET /accounts`. Ensimmäinen tilikausi luodaan automaattisesti yhtiön luonnissa.
- Ilman summaa (OCR puuttuu) tositteesta ei enää luoda vientiä; aiemmin ML-worker keksi summaksi 100 €.

### Audit-loki (audit-service)
- Lokia ei tallennettu lainkaan (vanha JS-stubi vain tulosti konsoliin). Nyt tallennetaan Postgresiin, vain lisäys sallittu, toiminto validoidaan. `GET /audit/logs` toimii dashboardin kanssa.

### Tunnistautuminen
- **JWT-salaisuus oli käytännössä aina `'secret'`** (.env luettiin liian myöhään) → korjattu.
- Kaikki palvelut (kirjanpito, laskutus, pankki, tositteet, dokumentit, ilmoitukset, audit, raportit, ML) vaativat nyt kirjautumisen. Palvelujen väliset kutsut käyttävät `x-service-token`-otsaketta.
- Yhteinen middleware: `packages/config/auth/requireAuth.ts`, kopiot palveluihin `node scripts/sync-auth.js`.
- Osakasrekisteri ja tilastot rajattu omiin yhtiöihin. MFA-reitit (`/auth/mfa/setup`, `/auth/mfa/verify`) kytketty. Rekisteröinnissä sähköposti- ja salasanatarkistus (min. 8 merkkiä).
- Ladatut dokumentit eivät ole enää julkisesti saatavilla.

### Laskutus (invoicing-service)
- Laskun luonti kaatui aina (`prisma` määrittelemättä).
- Laskunumerot yhtiökohtaisia ja atomisesti varattuja (`InvoiceCounter`), ei enää törmäyksiä.
- Massalaskutus kaatui (pakollinen ALV puuttui). Hoitovastikkeiden ALV oletuksena 0 % (aiemmin virheellisesti 24 %).
- Syötteen tarkistus, Kafka-kuluttaja ei kaadu yhteen virheelliseen viestiin.

### Raportit ja ML
- Raportit sisältävät oletuksena vain kirjatut viennit (`?includeDrafts=true` näyttää luonnokset).
- Raporttien rakenne vastaa nyt dashboardia (tilikohtaiset rivit, nimet, tase täsmää tilikauden tuloksella). Aiemmin tuloslaskelma- ja tasesivu eivät voineet näyttää mitään.
- Vastikelaskelma erottaa hoito- ja pääomarahoituksen tilikartan mukaisesti (isännöinti ei enää rahoituskulu).
- Palvelun virhe näytetään virheenä, ei tyhjänä nollaraporttina.
- ML-tilit vastaavat tilikarttaa; lyhyet avainsanat ("if") vaativat kokonaisen sanan.

### Muut
- Kong-reitit vastaavat palveluiden polkuja ja kattavat kaikki palvelut.
- Puuttuvat `tsconfig.json`-tiedostot (audit, pankki, dokumentit, ilmoitukset) – ilman niitä `import express` kaatui ajossa.
- `nodemon`-skriptit toimivat nyt Windowsissa (lainausmerkit).
- Tositteiden ja dokumenttien SHA-256-tarkiste lasketaan oikeasti.
- Pankkipalvelun `disconnectProducer` puuttui.
- Siirretty varmuuskopioon: `apps/user-service/ .env` (välilyönti nimessä), 19 Mt `.tmp`-jäänne, vanhat audit-JS-stubit.

## Testit (16 kpl, kaikki läpi)
- `apps/accounting-service/test` – tasetarkistus, senttimuunnos, pankkitiliöinti
- `apps/invoicing-service/test` – viitenumero
- `apps/reporting-service/tests` – tuloslaskelma, tase täsmää, vastikelaskelma
- `apps/ml-service/tests` – ML-tilit löytyvät tilikartasta

## Jäljelle jäävät (isommat) jatkokehitykset
1. **Yhtiökohtainen käyttöoikeus** kirjanpidossa, laskutuksessa jne. Nyt vaaditaan kirjautuminen, mutta kirjautunut käyttäjä voi vielä kysyä toisen yhtiön tietoja `companyId`:llä. Ratkaisu: yhtiöjäsenyydet tokeniin tai tarkistuskutsu user-serviceen.
2. **OCR** tositteille (summa, päivä, toimittaja), jotta tositeautomaatio tuottaa vientejä.
3. Dashboardiin painike luonnosten hyväksyntään ja tilikauden sulkemiseen (rajapinnat ovat valmiina).
4. Audit-lokin muuttumattomuus tietokantatasolla (Postgres-trigger, joka estää UPDATE/DELETE).
5. Varsinaisen TATO-tilikartan käyttöönotto (nykyinen on yksinkertaistus).
