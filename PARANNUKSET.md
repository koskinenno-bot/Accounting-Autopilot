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

## Automaattinen kirjanpito aineistoista (1.11.2026, iltapäivä)

Tavoite: asiakas lataa vain aineistot (tiliotteet ja tositteet), ja järjestelmä muodostaa niistä
pääkirjan, tuloslaskelman, taseen ja vastikelaskelman. Ihminen hyväksyy ja käsittelee vain epäselvät.

### Työnkulku
1. **Tositteet** (ostolasku, kuitti; PDF tai kuva) dashboardista, rajapinnasta tai kansiosta
   `inbox/<yhtiön tunnus>/tositteet/` → voucher-service tallentaa MinIOon → ml-service lukee
   (toimittaja, Y-tunnus, laskunumero, päivä, eräpäivä, suoritusjakso, summa, ALV, viite, IBAN, tiliehdotus)
   → accounting-service: **ostolasku + luonnos D kulutili / K 2800 Ostovelat laskun päivälle** (suoriteperuste),
   tosite linkitettynä.
2. **Tiliotteet** (camt.053, pankin CSV tai PDF) dashboardista tai kansiosta `inbox/<yhtiön tunnus>/tiliotteet/`:
   - saapuva maksu viitteellä → myyntisaamisen kuittaus ja vastikelasku maksetuksi,
   - lähtevä maksu → **täsmäytys avoimeen ostolaskuun** (1. viite, 2. summa + toimittaja/IBAN ±14 pv eräpäivästä,
     3. yksikäsitteinen summa) → D 2800 / K 1900, ostolasku maksetuksi,
   - täsmäämätön meno → tiliöinti (opittu toimittajan tili > avainsanat > tekoäly) ja merkintä **"tosite puuttuu"**;
     kun tosite myöhemmin saapuu, se liitetään olemassa olevaan vientiin (kulua ei kirjata kahdesti).
3. **Käsittelemättömät**: tilin vaihto (järjestelmä oppii toimittaja → tili), kohdistus laskuun, tositteen
   esikatselu, "Hyväksy kaikki varmat". Tositteeton vienti hyväksytään vain erikseen vahvistaen (esim. pankkikulut).
4. **Tilinpäätös**: avaussaldot (CSV), käyttöomaisuus ja poistot, jaksotukset (ehdotukset suoritusjaksoista),
   tarkistuslista ja tilikauden sulkeminen (tulos 2200 → seuraavan kauden 2100, viennit lukitaan, seuraava kausi
   avataan saldoineen, jaksotukset puretaan). Raportit tilikausittain taloyhtiön kaavalla + PDF.

### Tekoäly (Claude API)
- Avain: `apps/ml-service/.env` → `ANTHROPIC_API_KEY=...` ja ml-service-ikkunan uudelleenkäynnistys.
  Malli `ANTHROPIC_MODEL` (oletus `claude-opus-5-5`); kieltäytymistilanteessa API vaihtaa automaattisesti
  varamalliin (`fallbacks: "default"`).
- **Ilman avainta**: tekstipohjaiset PDF-laskut luetaan sääntöpohjaisesti (luonnokset aina tarkistettaviksi),
  CSV- ja camt-tiliotteet toimivat täysin. Kuvatositteet, skannatut PDF:t, PDF-tiliotteet ja tuntemattomien
  toimittajien tekoälytiliöinti vaativat avaimen.

### Käyttöoikeudet
Jokainen palvelu tarkistaa yhtiöjäsenyyden (user-service `GET /companies/:id/access`, välimuisti 60 s);
myös id-pohjaiset reitit (vienti, lasku, dokumentti, tosite, tilikausi) tarkistavat kohteen yhtiön.
Palveluiden väliset kutsut (`x-service-token`) ohittavat tarkistuksen; reporting-service välittää käyttäjän
tunnisteen, jolloin accounting-service tarkistaa oikeuden.

### Tiliotteiden automaattinen nouto pankista (jatkokehitys)
Suoraa pankkiyhteyttä ei voi rakentaa ilman pankin kanssa tehtyä sopimusta ja tunnuksia. Nykyinen
`inbox/`-kansio on rajapinta, johon mikä tahansa näistä voidaan kytkeä ilman muutoksia kirjanpitoon:
1. **Pankin tiliotepalvelu (Web Services / pankkiyhteysohjelmisto)**: yrityksen pankki toimittaa camt.053-tiliotteet
   päivittäin. Pankkiyhteysohjelmisto tai SFTP-siirto ohjataan kirjoittamaan tiedostot kansioon
   `inbox/<yhtiön tunnus>/tiliotteet/`. Tarvitaan pankin Web Services -sopimus ja varmenne.
2. **PSD2-tilitietopalvelu (AISP)**, esim. Enable Banking tai muu Finanssivalvonnan rekisteröimä palveluntarjoaja:
   taloyhtiön edustaja antaa suostumuksen (voimassa enintään 180 vrk kerrallaan), ja ajastettu tehtävä hakee
   tapahtumat palveluntarjoajan rajapinnasta. Toteutus: uusi moduuli bank-serviceen, joka muuntaa tapahtumat
   `BankTransaction`-muotoon ja kutsuu `importStatement`-funktiota (sama kuin tiedostotuonnissa). Tapahtuman
   pankkitunniste viedään `entryReference`-kenttään, jolloin päällekkäiset haut eivät kirjaa tuplia.
3. **Sähköposti**: pankin tai toimittajien sähköpostit ohjataan postilaatikkoon, josta liitteet tallennetaan
   inbox-kansioon (esim. Power Automate / Gmail-sääntö + synkronoitu kansio).

### Demo
`python scripts/samples/generate_invoices.py` (ostolasku-PDF:t) ja `npm run demo`: As Oy Demokoti,
lokakuu pankkipohjaisesti (camt) ja marraskuu tositteet ensin (6 ostolaskua + Nordea-CSV). Näytteet:
`scripts/samples/` (ostolaskut, viiden pankin CSV-muodot, avaustase).

### Testit
accounting 16, bank 7, ml 10, reporting 8, invoicing (viitenumero) – kaikki läpi.

## Isännöintitoimisto ja käyttöoikeudet (moduuli 1, 15.11.2026)

Tuotteen asiakas on isännöintitoimisto, jolla on useita taloyhtiöitä. Haara: `moduuli-1-isannointitoimisto`.

### Käyttöönotto
```powershell
powershell -ExecutionPolicy Bypass -File .\kaynnista.ps1
```
Skripti ajaa `prisma generate` ja `prisma db push` kaikille palveluille. user-servicen skeemaan tulee uusia tauluja
ja sarakkeita oletusarvoineen, olemassa oleva data säilyy (kokeiltu vanhan skeeman datalla).
Vanha käyttäjä saa ensimmäisellä kirjautumisella oman toimiston, ja hänen yhtiönsä liitetään siihen.

### Roolit
| Taso | Rooli | Oikeudet |
| --- | --- | --- |
| Toimisto | Omistaja / Pääkäyttäjä | Isännöitsijän oikeudet kaikkiin toimiston yhtiöihin, yhtiöiden lisäys, käyttäjien hallinta |
| Toimisto | Työntekijä | Vain yhtiöt, joihin hänet on erikseen liitetty |
| Yhtiö | Isännöitsijä | Kaikki, myös tilikauden sulkeminen ja avaussaldot |
| Yhtiö | Kirjanpitoassistentti | Kirjaukset, tositteet, tiliotteet, laskut; ei tilikauden sulkemista |
| Yhtiö | Hallitus | Vain luku |
| Yhtiö | Tilin- tai toiminnantarkastaja | Vain luku |

Palvelut tarkistavat roolin user-servicestä (`GET /companies/:id/access` palauttaa `{ role }`).
Lukevat pyynnöt (GET) vaativat minkä tahansa roolin, muut pyynnöt isännöitsijän tai assistentin,
tilikauden sulkeminen ja avaussaldot isännöitsijän. Yhteinen logiikka: `packages/config/auth/requireAuth.ts`
(`node scripts/sync-auth.js` kopioi palveluihin).

### Uutta
- Rekisteröityminen luo isännöintitoimiston (rekisteröityjä on omistaja).
- Dashboardin etusivu **Kaikki yhtiöt**: jokaisen yhtiön tehtävät (käsittelemättömät, puuttuvat tositteet,
  erääntyneet ostolaskut, tilinpäätös tekemättä, vanha tiliote), eniten huomiota vaativat ensin.
  Rajapinta: accounting-service `GET /accounting/overview?companyIds=a,b,c`.
- Yläpalkin yhtiövalitsin: kaikki yhtiökohtaiset sivut näyttävät valitun yhtiön (aiemmin aina ensimmäisen).
- **Käyttäjät**-sivu: kutsu, oikeuksien muokkaus, poisto. Kutsu luo linkin (voimassa 14 pv), jonka isännöitsijä
  lähettää itse; kutsuttu asettaa salasanan sivulla `/invite/<tunniste>`. Toimiston viimeistä omistajaa ei voi poistaa.
- **Yhtiöt**-sivun "Lisää uusi yhtiö" toimii (ennen pelkkä lomakepohja): nimi, Y-tunnus, As Oy / KOY, tilikausi.

### Rajoitukset
- Kutsua ei lähetetä sähköpostilla automaattisesti, koska sähköpostin lähetystä ei ole vielä kytketty. Linkki kopioidaan.
- Lukuoikeuden käyttäjälle osa painikkeista näkyy yhä; palvelin estää muutokset ja näyttää virheen.

### Testit
user-service 4 (roolisäännöt), accounting 18 (sis. käyttöoikeustasot). Lisäksi ajettu läpi oikealla Postgresilla:
vanhan käyttäjän siirtymä, rekisteröinti, yhtiöiden luonti, hallituksen ja assistentin kutsut, lukuoikeuden esto,
tilikauden sulkemisen esto assistentilta, toisen toimiston yhtiön esto, viimeisen omistajan suoja.

## Poikkeusjono (moduuli 2, 15.11.2026)

Isännöitsijä käsittelee kaikkien yhtiöiden tehtävät yhdestä listasta: dashboard → **Työjono**.
Tehtävät lasketaan suoraan kirjanpidosta, joten jonoa ei tarvitse ylläpitää käsin.

| Tehtävä | Milloin syntyy | Kiireellisyys |
| --- | --- | --- |
| Tilinpäätös | Tilikausi päättynyt eikä suljettu (määräaika 4 kk, KPL) | Kiireellinen alle 30 pv ennen määräaikaa tai myöhässä |
| Ostolasku | Maksamaton lasku erääntyy 7 pv sisällä tai on erääntynyt | Erääntynyt = kiireellinen |
| Tarkistettava kirjaus | Luonnos, josta automaatio ei ole varma | Yli 30 pv vanha = kiireellinen |
| Puuttuva tosite | Kirjattu pankkimeno ilman tositetta | Yli 30 pv vanha = tällä viikolla |
| Tiliote | Viimeisin pankkitapahtuma yli 10 pv vanha tai ei tiliotteita | Yli 30 pv = tällä viikolla |
| Varmat kirjaukset | Yhtiön varmat luonnokset yhtenä tehtävänä, "Hyväksy kaikki" | Kun ehdit |

Jokaisen tehtävän voi antaa toimiston jäsenelle, siirtää myöhemmäksi (huomenna, viikko, kuukausi) ja siihen voi
kirjoittaa muistiinpanon. Suodattimet: kaikki / minulle / jakamatta, tyyppi, yhtiö. Jonossa näkyvät vain yhtiöt,
joissa käyttäjä on isännöitsijä tai assistentti. "Käsittele" avaa kyseisen viennin Käsittelemättömät-sivulla korostettuna.

Rajapinnat: accounting-service `GET /accounting/queue?companyIds=…` ja `PUT /accounting/queue/task`,
user-service `GET /organizations/:id/members`. Uusi taulu `QueueTask` (accounting-service), luodaan `kaynnista.ps1`:llä.
Säännöt: `apps/accounting-service/src/queue.ts`, testit `test/queue.test.ts`.

## Jäljelle jäävät (isommat) jatkokehitykset
1. ~~Yhtiökohtainen käyttöoikeus~~ (tehty), ~~tositteiden luku~~ (tehty), ~~luonnosten hyväksyntä ja tilikauden
   sulkeminen dashboardissa~~ (tehty).
2. Audit-lokin muuttumattomuus tietokantatasolla (Postgres-trigger, joka estää UPDATE/DELETE).
3. Varsinaisen TATO-tilikartan käyttöönotto (nykyinen on yksinkertaistus) ja ALV-velvollisten yhtiöiden ALV-käsittely.
4. Myyntisaamisten ja ostovelkojen reskontraraportit sekä maksumuistutukset myöhässä oleville vastikkeille.
5. ~~Usean yhtiön valinta dashboardiin~~ (tehty, moduuli 1).
6. Tilinpäätöksen liitetiedot ja toimintakertomus (AOYL 10:5–6 §) sekä tilintarkastajan käyttöoikeus.
