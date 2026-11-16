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

### Tiliotteiden automaattinen nouto pankista (PSD2-vaihtoehto tehty: moduuli 6)
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

## Tilikartta ja raporttikaavat (moduuli 3, 15.11.2026)

**Tilikartta.** Taloyhtiön tilikarttapohja laajennettiin noin 70 tiliin (hoitotuotot eriteltyinä vastikkeisiin,
käyttökorvauksiin ja vuokriin; hoitokulut kaavan ryhmiin; rahastot, lainat, ALV-saamiset ja -velat). Uudet tilit
lisätään olemassa oleville yhtiöille automaattisesti käynnistyksessä, vanhoihin tileihin ei kosketa.
Dashboard → **Tilikartta**: tilit ryhmiteltyinä, haku, ja isännöitsijälle tilin lisäys, uudelleennimeäminen sekä
käytöstä poisto. Tilin numero määrää sen paikan raporteilla (lomake näyttää sen ennen tallennusta), joten numeroa ei
voi muuttaa jälkikäteen. Käytöstä poistetulle tilille ei voi kirjata eikä automaatio ehdota sitä; vanhat kirjaukset
säilyvät. Rajapinnat: `POST /accounting/accounts`, `PATCH /accounting/accounts/:id` (vain isännöitsijä).

**Raportit.** Tuloslaskelma noudattaa asunto-osakeyhtiön kaavaa (KPA-asetus 1753/2015): hoitotuotot ja hoitokulut
eritellään kaavan riveihin (henkilöstökulut, hallinto, käyttö ja huolto, ulkoalueet, siivous, lämmitys, vesi,
sähkö, jätehuolto, vakuutukset, vuokrat, kiinteistövero, korjaukset, muut). Taseen pysyvät vastaavat jaetaan
aineellisiin hyödykkeisiin ja sijoituksiin. Kaikissa raporteissa ja PDF:issä on **edellisen tilikauden
vertailusarake** (KPL 3:1a §), kun edelliseltä kaudelta on kirjauksia. Vastikelaskelmassa näkyvät edellisen kauden
luvut, ja KOY:lle näytetään huomautus siitä, milloin laskelma on pakollinen.

Numeroalueet: `apps/reporting-service/src/reports.py` (MAINT_EXPENSE_GROUPS ym.), testit `tests/test_reports.py`,
tilikarttapohja `apps/accounting-service/src/services/chartOfAccountsService.ts`, testit `test/chart.test.ts`.

## Vastikereskontra (moduuli 4, 15.11.2026)

Dashboard → **Vastikkeet**, viisi välilehteä:

- **Osakasluettelo:** tuonti CSV-tiedostona isännöintijärjestelmästä (sarakkeet tunnistetaan otsikoista: Huoneisto,
  Pinta-ala, Osakkeet, Omistaja, Sähköposti, Puhelin, Henkilöt, Autopaikat; puolipiste tai pilkku, myös
  Windows-merkistö). Esikatselu näyttää virheet ja puutteet ennen tuontia. Tuonti korvaa yhtiön osakasluettelon.
  Huoneiston pinta-alaa, henkilömäärää ja autopaikkoja voi muokata suoraan.
- **Perusteet:** yhtiön vastikelajit hintoineen: hoitovastike €/m², rahoitusvastike €/osake, vesimaksu €/hlö,
  autopaikka €/kpl tai kiinteä €/huoneisto, kukin omalle tulotilille. Rahoitusvastikkeelle lainan pääoma, josta
  huoneistojen lainaosuudet lasketaan osakkeiden suhteessa; pois maksettu osuus merkitään, jolloin huoneisto ei enää
  maksa sitä rahoitusvastiketta. Viivästyskoron viitekorko ja muistutusasetukset (vain isännöitsijä).
- **Laskutusajo:** kauden vastikkeet esikatseluna huoneistoittain erittelyineen, sitten laskut yhdellä napilla.
  Kaudelle jo laskutetut huoneistot ohitetaan. Kirjanpitoon vienti syntyy vastikelajeittain (3000, 3900, 3100 …).
- **Reskontra:** huoneistokohtaiset saldot (laskutettu, maksettu, avoinna, erääntynyt) ja laskut suorituksineen.
  Viitesuoritukset kohdistuvat tiliotteelta automaattisesti, myös osasuoritukset; viitteettömän suorituksen voi
  kirjata käsin.
- **Muistutukset:** erääntyneet laskut, viivästyskorko tähän päivään (viitekorko + 7 %, korkolaki 4 §) ja
  muistutusten lähetys. Muistutusmaksu on enintään 5 € ja maksuaika vähintään 14 pv (perintälaki). Kulu ja korko
  laskutetaan omalla muistutuslaskulla (tilit 3600 ja 3960), alkuperäinen lasku maksetaan omalla viitteellään.

Rajapinnat (invoicing-service): `GET /invoices/fees`, `POST /invoices/fees/run`, `GET /invoices/reskontra`,
`POST /invoices/:id/payments`, `GET|POST /invoices/reminders` ym.; user-service `POST /shareholders/import`,
`PATCH /shareholders/apartment`. Uudet taulut: FeeComponent, LoanPayoff, Payment, ReskontraSettings.
Säännöt: `apps/invoicing-service/src/fees.ts` ja `src/reskontra.ts`, testit `test/fees.test.ts`;
CSV-jäsennys `apps/user-service/src/shareholderImport.ts`.

Huom: tarkista viitekorko (Suomen Pankki) Perusteet-välilehdeltä; oletus on 2 %. Muistutussähköpostit kulkevat
notification-servicen kautta, joka ei vielä lähetä oikeaa postia (tuotantovalmius, moduuli 10).

## Ostolaskujen hyväksyntä ja maksaminen (moduuli 5, 15.11.2026)

Dashboard → **Ostolaskut**, neljä välilehteä:

- **Hyväksyttävät:** isännöitsijä hyväksyy tai hylkää laskun (hylkäykseen kirjoitetaan syy). Assistentti valmistelee
  ja korjaa maksutiedot, mutta ei hyväksy (sisäinen valvonta). Yhtiökohtainen **hallituksen raja**: rajan ylittävät
  laskut tarvitsevat lisäksi hallituksen jäsenen hyväksynnän. Ilman rajaa riittää isännöitsijä tai hallituksen jäsen.
  Yksikin hylkäys hylkää laskun. Oman päätöksen voi perua ennen maksua.
- **Tuplalaskuvaroitus:** sama toimittaja ja summa sekä sama viite, laskunumero tai eräpäivä.
- **Maksutietojen korjaus:** saajan IBAN (mod 97 -tarkiste), viite (kotimainen 7-3-1 tai RF) ja eräpäivä.
  IBANin vaihto nollaa hyväksynnät, jotta tilinumeroa ei voi vaihtaa hyväksynnän jälkeen.
- **Maksettavat:** hyväksytyt laskut valitaan ja niistä tehdään **SEPA-maksuaineisto** (pain.001.001.03,
  validoitu virallista XSD-skeemaa vasten). Isännöitsijä lataa tiedoston verkkopankkiin ja hyväksyy maksut siellä:
  järjestelmä ei siirrä rahaa. Sama lasku voi olla vain yhdessä voimassa olevassa maksuerässä.
- **Maksuerät:** lataa tiedosto uudelleen, merkitse lähetetyksi pankkiin (lukitsee erän) tai peru (laskut vapautuvat).
  Lasku merkitään maksetuksi vasta, kun maksu näkyy tiliotteella (pankkitäsmäytys).

Rajapinnat (accounting-service): `GET /accounting/purchases`, `PUT /accounting/purchases/policy`,
`POST|DELETE /accounting/purchases/:id/decision`, `PATCH /accounting/purchases/:id`,
`GET|POST /accounting/payment-batches`, `GET /accounting/payment-batches/:id/xml`,
`PATCH /accounting/payment-batches/:id`. Uudet taulut: PurchaseApproval, ApprovalPolicy, PaymentBatch.
Säännöt: `apps/accounting-service/src/payments.ts`, testit `test/payments.test.ts`.

## Tilinpäätöspaketti ja talousarvio (moduuli 7, 15.11.2026)

Dashboard → **Tilinpäätöspaketti**, viisi välilehteä:

- **Toimintakertomus:** osiot (yleistä, kiinteistö, korjaukset, kunnossapitotarveselvitys, talousarvion toteutuminen,
  talous ja rahoitus, tilikauden jälkeiset tapahtumat, hallituksen esitys tuloksesta). Pohja tehdään kirjanpidon
  luvuista; hakasulkeissa olevat [kohdat] täydennetään. Muokattu teksti tallentuu, ja automaattiseen voi palata.
- **Liitetiedot:** laatimisperiaatteet (pienyrityssäännökset, PMA 1753/2015), poistomenetelmät käyttöomaisuusrekisteristä,
  oman pääoman muutokset, pitkäaikaiset lainat, vakuudet, henkilöstö sekä kirjanpitokirjat ja tositelajit.
- **Tase-erittelyt:** jokaisen taseen tilin avaava saldo, kauden debet ja kredit, päättävä saldo, vertailuvuosi ja
  kirjoitettava erittely. Varoitus, jos avaava saldo ei täsmää edellisen kauden päättävään (tuloksen siirto 2200 → 2100
  huomioidaan).
- **Allekirjoitus:** allekirjoittajat, paikka ja päivä, tilintarkastaja tai toiminnantarkastaja. Suljetun kauden
  tilinpäätöksen voi merkitä allekirjoitetuksi, jolloin tekstit lukittuvat (lukituksen avaa vain isännöitsijä).
- **Tulosteet (PDF):** koko tilinpäätös (kansilehti, toimintakertomus talousarviovertailuineen, tuloslaskelma, tase,
  vastikelaskelma As Oy:lle, liitetiedot, allekirjoitussivu ja tilinpäätösmerkintä), tase-erittelyt, päiväkirja ja
  pääkirja. Avoimen kauden tilinpäätökseen tulostuu LUONNOS-merkintä.

Dashboard → **Talousarvio:** arvio tileittäin edellisen kauden toteuman ja kuluvan toteuman rinnalla, ero ja
toteutumis-%. Tyhjät rivit voi täyttää edellisen kauden toteumalla (kuluihin valittava korotus-%).

Rajapinnat: accounting-service `GET|PUT /accounting/fiscal-years/:id/closing-package`,
`GET|PUT /accounting/fiscal-years/:id/budget`; reporting-service `GET /reports/closing-package`,
`GET /reports/budget-comparison` ja PDF:t `/reports/{closing-package,balance-details,journal,general-ledger}/pdf`.
Uudet taulut: ClosingPackage, BudgetLine. Logiikka `apps/reporting-service/src/closing.py` ja `closing_pdf.py`,
testit `tests/test_closing.py`.

## Siirto vanhasta järjestelmästä (moduuli 11, 15.11.2026)

Dashboard → **Siirto vanhasta** (isännöitsijä ja assistentti; siirron tekee isännöitsijä):

1. **Saldoluettelo** vanhasta kirjanpito-ohjelmasta viimeiseltä suljetulta tilikaudelta: tiedosto (myös Windows-1252)
   tai Excelistä kopioitu taulukko. Sarakkeet tili;nimi;saldo tai tili;nimi;debet;kredit. Etumerkki valitaan
   (kredit miinuksella tai tuotot/velat positiivisina). Summat 1 234,56, 1.234,56 ja 99,90- tunnistetaan.
2. **Tilien mäppäys:** ehdotus tallennetusta valinnasta, samasta tilinumerosta tai nimestä samassa tililuokassa
   (taloyhtiötermien rinnakkaisnimet, esim. rahoitusvastikkeet → pääomavastikkeet). Valinnat tallentuvat yhtiölle.
   Luettelon on täsmättävä (debet = kredit).
3. **Vertailukausi ja avaustase:** saldot kirjataan suljetuksi vertailutilikaudeksi (tosite SIIRTO-vuosi), joten
   tuloslaskelmaan, taseeseen ja vastikelaskelmaan tulee edellisen vuoden sarake. Samalla voi kirjata seuraavan
   tilikauden avaustaseen (tulos siirtyy edellisten tilikausien voittoon). Siirron voi perua, kun seuraava kausi on avoinna.

Rajapinnat (accounting-service): `GET /accounting/migration`, `POST /accounting/migration/preview`,
`POST /accounting/migration/import`, `DELETE /accounting/migration/:fiscalYearId`. Uusi taulu AccountMapping.
Logiikka `apps/accounting-service/src/migration.ts`, testit `test/migration.test.ts`.

## Salasanan palautus ja muuttumaton muutosloki (moduuli 10, osa 1, 15.11.2026)

- **Salasanan palautus:** kirjautumissivulla "Unohditko salasanan?". Linkki lähetetään sähköpostiin, on voimassa tunnin
  ja on kertakäyttöinen. Kantaan tallennetaan vain linkin tiiviste. Vastaus on sama, oli osoite rekisteröity tai ei,
  ja pyyntöjä hyväksytään enintään 3 tunnissa. **Kehitysympäristössä** (NODE_ENV ≠ production) linkki näytetään myös
  sivulla, koska sähköposti ei vielä lähde. Tuotannossa aseta `APP_URL` (dashboardin osoite linkkiin).
  Rajapinnat: `POST /auth/password-reset`, `GET /auth/password-reset/:token`, `POST /auth/password-reset/confirm`,
  `POST /auth/change-password` (kirjautunut käyttäjä). Uusi taulu PasswordReset.
- **Muutosloki:** tietokantatriggeri estää AuditLog-rivien muuttamisen, poistamisen ja TRUNCATEn (asennetaan
  audit-servicen käynnistyessä). Lisäksi tapahtumat ketjutetaan yhtiökohtaisesti tiivisteillä, joten myös
  tietokannan pääkäyttäjän tekemä muutos havaitaan: Muutosloki-sivulla näkyy "Eheys tarkistettu" tai katkoskohta.
  Rajapinta `GET /audit/verify?companyId=`. Logiikka `apps/audit-service/src/chain.ts` ja `src/immutability.ts`.

Huom: sisäänkirjautumistunniste (JWT) on voimassa 24 h myös salasanan vaihdon jälkeen; tunnisteiden mitätöinti
on seuraavan vaiheen työ.

## Pankkiyhteys (moduuli 6, 15.11.2026)

Yhtiön pankkitili yhdistetään kerran pankkitunnuksilla (PSD2-tilitietopalvelu **Enable Banking**). Sen jälkeen
tapahtumat haetaan automaattisesti kuuden tunnin välein ja ne kulkevat samaa reittiä kuin tiliotetiedostot:
viitesuoritukset kohdistuvat vastikereskontraan, lähtevät maksut ostolaskuihin ja loput tiliöidään tai jäävät selvitettäviin.

### Käyttöönotto
1. Rekisteröidy: https://enablebanking.com/cp → **API applications** → Add a new application.
   Environment = Sandbox (testi) tai Production, Redirect URL = `http://localhost:5173/bank-connections/callback`.
2. Register lataa tiedoston `<sovellustunnus>.pem`. Siirrä se kansioon `apps\bank-service\salaiset\`
   (kansio on suljettu versionhallinnasta). Sovellustunnus luetaan tiedoston nimestä.
3. Aja KAYNNISTA.bat: se luo kannan `bank_service`, lisää `DATABASE_URL`:n bank-servicen .env-tiedostoon ja päivittää skeeman.
4. Dashboard → **Pankkiyhteydet** → valitse pankki → Yhdistä pankkiin → tunnistaudu → paluu sovellukseen.

Testipankit (Sandbox): Nordea ja Handelsbanken ilman tunnuksia, OP käyttäjä 88888881, S-Pankki customera / 12345678.
Tuotannossa: omien tilien testaus "Linked accounts" -tilassa (rajoitettu tila), asiakasyhtiöiden tilit vaativat
Enable Bankingin sopimuksen ja KYC-tarkastuksen.

### Toiminta
- Suostumus on voimassa pankin enimmäisajan, enintään 180 päivää. Sivu varoittaa 14 päivää ennen vanhenemista,
  ja "Yhdistä uudelleen" uusii sen. Vanhentunut yhteys merkitään, eikä hakua tehdä.
- Haku alkaa käyttäjän valitsemasta päivästä. Seuraavat haut alkavat 3 päivää ennen viimeisintä kirjauspäivää,
  jotta myöhässä kirjautuvat tapahtumat eivät jää välistä. Jo välitetyt tapahtumat ohitetaan (taulu BankSyncedTransaction),
  ja kirjanpito ohittaa lisäksi saman arkistointitunnuksen (`BANK-<tunnus>`), myös camt-tiedostotuonnin kanssa.
- Vain kirjatut (BOOK) tapahtumat; varaukset haetaan, kun ne kirjautuvat. RF-viite muunnetaan kansalliseksi viitteeksi.
- Jos Kafka ei vastaa, hakukohta ei etene, ja virhe näkyy yhteydellä.
- Oikeudet: yhdistäminen, poisto ja tilin haun kytkentä = isännöitsijä; "Hae nyt" = isännöitsijä tai assistentti;
  hallitus näkee yhteydet ja saldot. Yhdistäminen ja poisto kirjataan muutoslokiin.
- Rajapinnat (bank-service 3005): `GET /bank/connections?companyId`, `GET /bank/connections/aspsps`,
  `POST /bank/connections`, `POST /bank/connections/callback`, `POST /bank/connections/:id/sync`,
  `PATCH /bank/connections/:id/accounts/:accountId`, `DELETE /bank/connections/:id`.
- Asetukset (.env, valinnaiset): `ENABLE_BANKING_KEY_PATH`, `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_REDIRECT_URL`,
  `ENABLE_BANKING_API_URL`, `ENABLE_BANKING_SYNC_HOURS` (oletus 6).
- Testattu päästä päähän testipalvelinta vasten (JWT-allekirjoitus tarkistettu, sivutus, peruutettu tunnistus,
  viitesuoritus → lasku maksetuksi, lähtevä maksu → kirjaus, uusintahaku ilman tuplia). Yksikkötestit: bank-service 20.

Jatkokehitys: pankin saldon ja kirjanpidon pankkitilin (1900) täsmäytys sivulla; tuotantoversiossa paluuosoite https-osoitteeksi.

## Arvonlisävero ja veroilmoitus (moduuli 8, 15.11.2026)

Taloyhtiö on yleensä arvonlisäverovelvollinen vain, jos se on hakeutunut verovelvolliseksi liiketilojen vuokrauksesta
(vastikkeet ja asuntojen vuokrat ovat verottomia). Kannat 1.1.2026 alkaen: 25,5 %, 13,5 % ja 10 %.

### Arvonlisävero (sivu **Arvonlisävero**)
- Asetukset yhtiökohtaisesti: verovelvollinen kyllä/ei, verokausi (kuukausi, neljännes, vuosi), alkupäivä,
  vähennysoikeus % (osittain verollinen kiinteistö, esim. 60 %), Y-tunnus ja yhteyshenkilön puhelin.
- Ostolaskut: vähennyskelpoinen osuus verosta kirjataan tilille 1750, loput kuluun. Laskun ALV-tiedot tulevat
  tulkinnasta; vero huomioidaan vain, kun yhtiö on verovelvollinen ja laskun päivä on alkupäivän jälkeen.
- Myynti: vastikkeiden perusteille voi antaa ALV-kannan (Vastikkeet → Perusteet → ALV). Verollinen rivi kirjataan
  nettona tuottotilille ja vero tilille 2880. Verottomat vastikkeet laskulla eivät muutu.
- Käsin kirjattaville riveille voi antaa ALV-koodin (S255, S135, S10, S0, P, RCB rakentamispalvelut, EU-ostot, maahantuonti).
- Kausiveroilmoitus lasketaan kirjatuista vienneistä OmaVeron kenttätunnuksin (301–320, 308 = maksettava/palautettava).
  Hyväksymättömistä luonnoksista, joissa on veroa, ja 2880-tilin erosta varoitetaan.
- **Tilitys**: päättyneen kauden vero siirretään yhdellä viennillä (`ALV-<kausi>`) tilille 2885
  (maksettava tai palautettava). Kausi tilitetään vain kerran. Vaatii isännöitsijän oikeuden.
- Ilmoitus annetaan OmaVerossa: luvut näkyvät sivulla kenttätunnuksineen ja kopioidaan sinne.
- **Ilmoitin.fi-tiedosto** (VSRALVKV) on valmiina, mutta se vaatii ohjelmistotoimittajan tunnisteen:
  `VERO_SOFTWARE_ID=<ohjelmistoyrityksen Y-tunnus>_<tunniste>` ja `VERO_SOFTWARE_NAME` accounting-servicen .env-tiedostoon.
  Tunniste saadaan vasta, kun tuotteella on oma yritys. Ilman sitä latausnappi ei näy.
- Rajapinnat (accounting 3002): `GET/PUT /accounting/vat/settings`, `GET /accounting/vat/periods`,
  `GET /accounting/vat/return`, `GET /accounting/vat/return/file`, `POST /accounting/vat/settle`.

### Veroilmoitus 4 (Tilinpäätöspaketti → **Veroilmoitus**)
- **Korjaus kehityssuunnitelmaan**: asunto-osakeyhtiö ja kiinteistöosakeyhtiö antavat veroilmoituksen **4**
  (asunto- ja kiinteistöyhteisö), ei 6C. Lomake 6B tarvitaan vain, jos yhtiöllä on elinkeinotoiminnan tuloa.
- Rivit muodostetaan tuloslaskelman tileistä: vastikkeet (30xx, pääomavastikkeet 39xx), vuokrat (31xx–38xx),
  korkotuotot, muut tuotot, hoitokulut, poistot, korkomenot ja tuloverot (vähennyskelvottomia, Verotus-sarake 0).
- Jokaisella rivillä on Kirjanpito- ja Verotus-sarake. Lopputuloksena verotettava tulo tai vahvistettava tappio.
- Varoitukset: tuloutetut pääomavastikkeet (veronalaista tuloa, jos niitä ei ole rahastoitu) ja poistot
  (täytä lomake 62, verotuksen enimmäismäärä). Ilmoitus jätetään OmaVerossa, yleensä 4 kk tilikauden päättymisestä.
- Rajapinta: `GET /accounting/fiscal-years/:id/tax-return`.

### Seuraavat askeleet
- Verohallinnon rajapinta (ilmoitusten lähetys suoraan): vaatii ohjelmistokehittäjän rekisteröitymisen ja varmenteen
  (Verohallinnon rajapintapalvelu, "Ilmoitustiedostojen lähetys"). Tehdään, kun tuotteella on oma yritys.
- Yksikkötestit: accounting-service 46 (ALV-laskenta, kaudet, Ilmoitin-tiedosto, Y-tunnus, veroilmoitus 4).

## Palkat, tulorekisteri ja urakkatiedot (moduuli 9, 15.11.2026)

Sivu **Palkat**. Taloyhtiön tavalliset suoritukset ovat hallituksen kokouspalkkiot, puheenjohtajan palkkio ja pienet
palkat (esim. talonmies). Isännöintitoimiston lasku on työkorvausta ja kulkee ostolaskuna kuten ennenkin.

### Palkansaajat ja palkanmaksu
- Palkansaajalle tallennetaan henkilötunnus (tarkiste tarkistetaan), verokortti (pidätysprosentti, lisäprosentti,
  tuloraja ja vuosi), tilinumero sekä oletustulolaji ja -summa. Henkilötunnus näytetään aina peitettynä
  (`150570-****`), eikä sitä viedä muutoslokiin.
- Tulolajit ja vakuuttaminen tulorekisterin koodiston mukaan:
  201 aikapalkka (TyEL, työttömyys, sairausvakuutus, tapaturma), 210 kokouspalkkio (ei maksuja),
  215 luottamustoimipalkkio (vain sairausvakuutus), 308 hallintoelimen jäsenen palkkio (ei maksuja).
- Ennakonpidätys verokortin mukaan, tulorajan ylittävältä osalta lisäprosentilla (saman vuoden aiemmat maksut
  huomioidaan). Ilman verokorttia 60 %.
- Maksut 2026 (asetuksissa muutettavissa): TyEL 25,85 % (tilapäinen työnantaja; sopimuksella vakuutusyhtiön prosentti),
  työntekijän TyEL 7,30 %, työttömyysvakuutus 0,31 % / 0,89 %, työnantajan sv-maksu 1,91 %, tapaturma vakuutusyhtiön mukaan.
  Ikärajat: TyEL 17–67, työttömyysvakuutus 17–64, sv-maksu 16–67 v (henkilötunnuksesta). TyEL-alaraja 71,72 €/kk.
- **Hyväksy ja kirjaa** (isännöitsijä): vienti maksupäivälle (`PALKKA-<nro>`): D 4010 palkat, D 4020 sivukulut,
  K 2840 nettopalkat, K 2850 ennakonpidätys ja sv-maksu, K 2855 TyEL ja työttömyysvakuutus. Laskelma lukitaan.
  Kun nettopalkat maksetaan pankista, maksu tiliöidään tilille 2840.

### Tulorekisteri
- Välilehti **Tulorekisteri** näyttää jokaisesta maksupäivästä palkkatietoilmoituksen tiedot (tulolajit, 402, 413, 414,
  vakuuttaminen) ja määräpäivän (5 päivää maksupäivästä), sekä kuukausittain työnantajan erillisilmoituksen
  (sv-maksu, määräpäivä seuraavan kuun 5.) ja Verohallinnolle maksettavan summan (12. päivä).
- Ilmoitukset annetaan toistaiseksi tulorekisterin asiointipalvelussa käsin, ja ne merkitään sivulla annetuiksi.
  Suora lähetys rajapinnalla vaatii tulorekisterin käyttöoikeuden ja varmenteen ohjelmistotoimittajalle (oma yritys).

### Rakentamisen urakkatiedot
- Välilehti **Urakkatiedot**: taloyhtiön tilaamat rakennusurakat (urakoitsija, Y-tunnus, työmaa, arvo alv 0, aika).
  Yli 15 000 € urakat näkyvät kuukauden ilmoituksessa, kun urakka alkaa tai urakoitsija laskuttaa. Laskutettu määrä
  lasketaan saman Y-tunnuksen ostolaskuista. Määräpäivä on raportointikuukautta seuraavan toisen kuukauden 5. päivä.
  Ilmoitus annetaan OmaVerossa.

- Rajapinnat (accounting 3002): `/accounting/payroll/settings`, `/payees`, `/runs` (`/:id/post`, `/:id/reported`),
  `/reports`, `/reports/mark`, `/contracts`, `/contracts/report`.
- Yksikkötestit: accounting-service 53 (henkilötunnus, ennakonpidätys, maksut, ikärajat, määräpäivät, urakkatiedot).

## Sähköposti (15.11.2026)

Aiemmin ilmoituspalvelu vain kirjoitti viestit lokiin, ja maksumuistutuksen ja salasanan vaihdon viestipohjat
puuttuivat. Nyt viestit lähtevät oikeasti SMTP:n kautta (nodemailer).

- **Käyttöönotto**: lisää SMTP-asetukset tiedostoon `apps\notification-service\.env` (mallit .env.example-tiedostossa)
  ja käynnistä palvelu uudelleen. Viestintä-sivu näyttää, onko lähetys käytössä ja toimiiko kirjautuminen
  SMTP-palvelimelle, ja sieltä voi lähettää testiviestin.
- **Ilman SMTP-asetuksia** (testitila) mitään ei lähetetä: viestit tallennetaan kansioon `apps\notification-service\outbox`
  .eml-tiedostoina (avautuvat Outlookissa), ja Viestintä-sivulla tila on "Ei lähetetty (testitila)".
  Kansio on suljettu versionhallinnasta, koska viesteissä on henkilötietoja.
- Viestit: vastikelasku, maksumuistutus, salasanan vaihto ja **käyttäjäkutsu** (kutsu lähtee nyt sähköpostilla;
  linkin voi edelleen kopioida). Viesteissä on HTML- ja tekstiversio.
- Jono: Redisin kanssa 3 yritystä (5 s, 10 s, 20 s). Jos Redis ei vastaa, viesti lähetetään heti suoraan.
  Epäonnistunut viesti näkyy Viestintä-sivulla syineen (esim. väärä SMTP-salasana).
- **Palveluntarjoaja**: testaukseen käy oma Gmail sovellussalasanalla (pieni päivittäinen raja). Tuotannossa tarvitaan
  oma domain ja lähetyspalvelu, jossa domain vahvistetaan (SPF ja DKIM), muuten viestit menevät roskapostiin.
  EU:ssa toimivia vaihtoehtoja ovat esim. Brevo (Ranska) ja Amazon SES (Tukholman alue).
- Testattu SMTP-testipalvelinta vasten: kirjautuminen, kaikki viestipohjat, väärä salasana, Redis pois ja takaisin.
  Yksikkötestit: notification-service 4.

## Pankkitäsmäytys (15.11.2026)

Uusi sivu **Pankkitäsmäytys** (valikossa Pankkiyhteyksien alla) vertaa joka kuukauden lopussa pankkitilien saldoa
kirjanpidon rahatilien (1900–1989) saldoon. Tämä puuttui moduulista 6.

- **Saldot tulevat automaattisesti**: pankkiyhteyden (Enable Banking) synkronointi tallentaa päivän saldon, ja
  camt.053-tiliotteen tuonti tallentaa tiliotteen loppusaldon (CLBD). Jos kumpaakaan ei ole, kuukauden viimeisen
  päivän saldo syötetään tiliotteelta käsin. Käsin syötetyn saldon voi poistaa, automaattista ei. Käyttäjä ei voi
  merkitä käsin syötettyä saldoa pankista tulleeksi.
- **Tila kuukausittain**: Täsmää, Ero (euroina), Pankkisaldo puuttuu tai Vanha saldo (yli 4 päivää vanha).
  Usealla pankkitilillä verrataan tilien yhteissaldoa, ja kuukauden riviltä näkee tilikohtaiset saldot.
- Sarake **Hyväksymättömät** näyttää kuukauden luonnosviennit. Jos ero on täsmälleen niiden suuruinen, sivu kertoo,
  että ero selittyy niillä ja viennit pitää hyväksyä.
- Täsmäävän kuukauden voi **merkitä täsmäytetyksi** (merkinnän voi perua). Eroavaa kuukautta ei voi merkitä.
- IBAN tarkistetaan (tarkiste mod 97).
- Testattu: käsin syötetty saldo, tiliotteen ja pankkiyhteyden saldo, virheellinen IBAN, ero ja sen esto merkinnässä.
  Yksikkötestit: accounting-service 55, bank-service 21.

## Kovennus ennen pilottia (16.11.2026)

### Kevyt käynnistys: kaikki yhdessä prosessissa (`KAYNNISTA-KEVYT.bat`)
- Kaikki Node-palvelut ajetaan samassa prosessissa ja portissa **3000** (`apps\server`). Tapahtumat kulkevat
  prosessin sisällä (`EVENT_BUS=local`), joten **Kafkaa, Kongia ja Redistä ei tarvita**. Dockerista tarvitaan
  Postgres ja MinIO vanhoja tositteita varten. Raportti- ja tekoälypalvelut (Python) palvelin käynnistää itse.
- Dashboard käännetään (`npm run build:single --workspace admin-dashboard`) ja palvelin jakaa sen samasta osoitteesta:
  **http://localhost:3000**. Tila: http://localhost:3000/health.
- Asetukset luetaan palveluiden nykyisistä `.env`-tiedostoista (jokaisen palvelun `DATABASE_URL` säilyy omana kantanaan).
  Halutessaan kaikki asetukset voi koota yhteen tiedostoon `apps\server\.env` (esim. `USER_DATABASE_URL=...`).
  Palvelin varoittaa käynnistyessään, jos `JWT_SECRET` tai `SERVICE_TOKEN` poikkeaa palveluiden välillä.
- Uudet tositteet tallentuvat levylle kansioon `apps\voucher-service\files` (vanhat aukeavat edelleen MinIOsta).
  MinIOn voi pitää uusillekin asettamalla `MINIO_ENDPOINT`.
- **Vanha tapa toimii ennallaan**: `KAYNNISTA.bat` käynnistää palvelut omiin ikkunoihinsa Kafkan ja Kongin kanssa.
- Palvelimella (Linux): `cd apps/server && NODE_ENV=production npm start` ja eteen HTTPS-välityspalvelin (esim. Caddy).
  Tuotannossa palvelin kuuntelee vain osoitetta 127.0.0.1 (muutettavissa `HOST`), ja selaimelle sallitaan vain sama
  alkuperä. Muut alkuperät sallitaan muuttujalla `CORS_ORIGINS` (pilkuilla eroteltu lista).

### Tietoturva
- Kirjautuminen: sähköposti kirjainkoosta riippumatta, **5 väärää yritystä lukitsee tunnuksen 15 minuutiksi**.
- **Salasanan vaihto ja palautus mitätöivät kaikki vanhat kirjautumiset.** Uusi sivu **Oma tili** (valikossa):
  salasanan vaihto ja "Kirjaudu ulos kaikilta laitteilta". Kirjautuminen on voimassa 12 tuntia.
- Kaikissa palveluissa samat turvaotsakkeet, rajattu CORS ja virheenkäsittely (selaimelle ei näy pinojälkiä,
  liian iso pyyntö 413). Docker-palvelut (Postgres, Redis, Kafka, MinIO) kuuntelevat vain omaa konetta.
- Dokumentit: suojaamaton `/uploads`-polku poistettu. Tiedosto ladataan vain tunnisteella ja käyttöoikeus
  tarkistaen, ja tiedoston tiiviste tarkistetaan (muuttunut tiedosto ei aukea).
- Lukuoikeuden käyttäjille (hallitus, tarkastajat) muokkausnapit eivät enää näy.

### Uudet toiminnot
- **Ajankäyttö yhtiöittäin**: dashboard mittaa isännöitsijän aktiivisen ajan yhtiön sivuilla (minuutti kerrallaan,
  vain kun välilehti on näkyvissä ja käyttäjä aktiivinen). Lisäksi voi kirjata käsin (esim. puhelut).
  Yhtiön etusivulla kortti, Kaikki yhtiöt -näkymässä sarake "Työaika 12 kk" ja ennuste. Tavoite 10 h vuodessa
  (`TIME_TARGET_HOURS`).
- **Puuttuvien tositteiden pyyntö**: yhtiön etusivulla lista pankkimenoista ilman tositetta ja pyyntö sähköpostilla
  (esim. hallituksen puheenjohtajalle). Vastaukset tulevat lähettäjän omaan sähköpostiin. Pyydetty tosite
  näkyy työjonossa pyyntöpäivän kanssa alemmalla kiireellisyydellä, ja jos tositetta ei viikossa
  tule, se palaa normaaliin kiireellisyyteen.
- **Tilinpäätöksen arkistointi 10 vuodeksi**: kun tilinpäätös merkitään allekirjoitetuksi, sen PDF:t
  (tilinpäätös, tase-erittelyt, päiväkirja, pääkirja) tallentuvat Dokumentteihin lukittuina. Säilytys päättyy
  tilikauden lopusta 10 vuoden kuluttua (31.12.). Arkistoitua ei voi poistaa.
- **Yhtiön tilinumero**: yhtiön etusivulla. Finvoice-aineistossa käytetään nyt yhtiön oikeaa nimeä, Y-tunnusta ja
  tilinumeroa (aiemmin malliarvot). Ilman tilinumeroa aineistoa ei muodosteta.
- **Varmuuskopiot**: `scripts\varmuuskopio.ps1` (kannat, tositteet, dokumentit, tiivisteet, 30 uusinta) ja
  `scripts\palauta-varmuuskopio.ps1`. Linux-palvelimelle `scripts/varmuuskopio.sh`. Ajasta päivittäin
  (ohje tiedoston alussa) ja kopioi myös toiseen paikkaan.

### Käyttöönotto
Aja `KAYNNISTA.bat` tai `KAYNNISTA-KEVYT.bat` kerran: se päivittää kantojen rakenteen (`prisma db push`).
Uusia sarakkeita: käyttäjien lukitus ja tunnisteversio, ajankäyttö, tositepyynnöt, arkiston lähdeavain.

### Testit
Yksikkötestit: user 15, accounting 62, invoicing 10, bank 21, notification 4, document 3, server 7.
Koko polku testattu kevyttä palvelinta vasten oikealla Postgresilla: rekisteröinti, lukitus, salasanan vaihto,
yhtiön luonti (tilikartta ja tilikausi syntyvät ilman Kafkaa), ajankäyttö, puuttuvat tositteet ja sähköposti,
raportit välityksen kautta, allekirjoitus ja arkistointi, PDF:n lataus, tositteen lataus levylle, Finvoice ja
toisen toimiston eristys. Varmuuskopioskriptejä ei voitu ajaa testiympäristössä (ei Windowsia eikä Dockeria):
kokeile ne kerran ennen pilottia.

## Palvelinasennus (16.11.2026)

Valmis asennuspaketti Linux-palvelimelle: `deploy/asenna.sh <domain>` asentaa kaiken (tietokanta, ohjelma,
automaattikäynnistys, HTTPS, palomuuri, päivittäinen varmuuskopio). Päivitys: `deploy/paivita.sh`.
Ohje: **deploy/LUEMINUT.md**, myös nykyisten tietojen siirto omalta koneelta.

- `scripts/palauta-varmuuskopio.sh`: palautus Linuxilla, myös Windows-koneen varmuuskopiosta.
- Varmuuskopioon tulevat nyt myös palvelimen asetukset (tietokannan salasana kulkee dumpin mukana).
- `apps/voucher-service/src/tools/siirraLevylle.ts`: vanhat tositteet MinIOsta levylle ennen siirtoa.
- Palvelimen portti voidaan asettaa tiedostossa `apps/server/.env` (`PORT`).

## Koko tilivuoden läpiajo (vuosiajo, 16.11.2026)

Koko tilivuosi ajettiin esimerkkiyhtiöllä alusta loppuun kevyttä palvelinta (localhost:3000) vasten ilman pankkiyhteyttä,
Verohallinnon rajapintaa ja tekoälyavainta. Ajo on nyt toistettava skripti:

```powershell
# KAYNNISTA-KEVYT.bat käynnissä
npm run vuosiajo
```

Skripti (`scripts/vuosiajo.js`) luo joka kerta uuden käyttäjän ja yhtiön (As Oy Vuosikoe, 12 huoneistoa, liiketila,
laina 702 000 €) ja tekee tilivuoden 2025 kuten isännöitsijä dashboardissa:
siirto vanhasta (esimerkkisaldoluettelo 2024 → vertailukausi ja avaustase), osakasluettelo, vastikeperusteet, ALV
(liiketila, neljännes, vähennysoikeus 12 %), käyttöomaisuus, talousarvio, hallituksen jäsenen kutsu. Joka kuukausi:
vastikelaskutus, liiketilan verollinen vuokralasku, 7–9 ostolaskua PDF:nä (luetaan sääntöpohjaisesti), hyväksyntä
(yli 5 000 € myös hallitus), SEPA-maksuaineisto, camt.053-tiliote (vastikkeet viitteellä, myöhästynyt ja viitteetön
maksu, ostolaskujen maksut, lainan lyhennys ja korko, pankkikulu, ALV), käsittelemättömät ja pankkitäsmäytys.
Neljännesvuosittain ALV-ilmoitus ja tilitys. Lopuksi jaksotus (joulukuun lämpölasku tulee tammikuussa), poistot,
tarkistuslista, sulkeminen, toimintakertomus, allekirjoitus, PDF:t, arkistointi ja veroilmoitus 4.
Skripti vertaa raporttien lukuja omiin laskelmiinsa (60 tarkistusta: tilikohtaiset tuotot ja kulut, tulos,
pankki = tiliote, laina, saamiset, ostovelat, siirtovelat, ALV, vastikelaskelma, reskontra, veroilmoitus).
Tulokset (PDF:t, maksuaineistot, tiliotteet, yhteenveto.json) kansioon `scratch/vuosiajo-<aika>/`.
Poistumiskoodi on 1, jos jokin tarkistus ei täsmää, joten skriptiä voi käyttää regressiotestinä ennen julkaisua.

**Tulos ennen korjauksia:** tulos 58 800 € väärin, 47/52 tarkistusta pielessä, pankkitäsmäytys ero joka kuukausi,
418 käsin hyväksyttävää vientiä vuodessa. **Korjausten jälkeen:** 60/60 tarkistusta täsmää, käsin hyväksyttäviä 62
vuodessa (tammikuussa 13, sen jälkeen 3–6 kuukaudessa: lainan lyhennys, korko, pankkikulu ja ALV-maksu, joille
tiliote on tosite). Ajo kestää noin 2 minuuttia.

### Korjatut virheet
1. **Lainan lyhennykset ja korot kirjautuivat pankkikuluiksi.** Avainsana "pankki" osui maksun saajan nimeen
   ("Rahoituspankki Oyj") ennen viestin sanaa "korko". Nyt viesti luokitellaan ensin ja saajan nimi vasta sitten;
   "pankki" korvattiin sanoilla pankkikulu/palvelumaksu/tilinhoitomaksu; "lyhennys" ehdottaa tiliä 2500 (velan
   lyhennys, ei kulu). Vaikutus esimerkissä: tulos 42 000 € liian pieni, vastikelaskelmasta puuttuivat lyhennykset ja korot,
   veroilmoituksen korkomenot 0 €. (`apps/ml-service/src/classifier.py`, `main.py`)
2. **Opittu tili koski kaikkia saman saajan maksuja.** Yksi korjaus (lyhennys → 2500) olisi opettanut saman tilin
   pankin koroille ja palvelumaksuille. Nyt opitaan saaja + viestin tunniste ("lainan korko"); pelkkää saajaa käytetään
   vain, jos avainsanoista ei löydy tiliä ja saajalle on aina valittu sama tili. (`learningService.ts`, `bankConsumer.ts`)
3. **Käsin tehty myyntilasku (esim. liiketilan vuokra) oli väärin:** ALV ei tullut laskulle eikä kirjanpitoon, tulo
   kirjautui aina hoitovastikkeisiin (3000) ja laskupäivä oli aina tämä päivä. Nyt rivillä on tulotili ja ALV-kanta,
   vero lisätään laskulle ja kirjataan tilille 2880, ja laskupäivän voi antaa (`issueDate`). (`invoiceController.ts`)
4. **Pankkitäsmäytys näytti eroa joka kuukausi** yhtiöllä, jolla on edellinen tilikausi (siirto tai suljettu kausi):
   kirjanpidon saldo laski edellisen kauden pankkisaldon kahdesti (vertailukausi + avaustase). Nyt saldo lasketaan
   avausviennin sisältävän tilikauden alusta. Koskee kaikkia yhtiöitä ensimmäisen tilinpäätöksen jälkeen. (`bankReconController.ts`)
5. **Ostolaskuja katosi ruuhkassa.** Kun usean tositteen luku valmistui yhtä aikaa, tietokantatransaktio ei ehtinyt
   alkaa ("Unable to start a transaction in the given time") ja virhe vain lokitettiin: tosite jäi ilman ostolaskua ja
   kirjausta (tammikuussa 7/9 laskua). Nyt odotusaika on pidempi ja hetkellinen virhe heitetään tapahtumaväylälle, joka
   yrittää uudelleen (tuplatarkistukset estävät kahdentumisen). Sama tiliotteen ja laskujen käsittelyyn. (`db.ts`, `consumers/*`)
6. **Viesti "Vastike B 9 03/2025" tulkittiin viitteeksi 2025**, jolloin viitteetön suoritus ei mennyt selvitettäviin ja
   lasku jäi reskontrassa avoimeksi (olisi saanut maksumuistutuksen). Vapaan viestin numero kelpaa viitteeksi vain,
   jos tarkiste täsmää. (`bank-service/src/services/camtParser.ts`)
7. **Siirtovelka jaksotettiin bruttona** ALV-velvolliselle yhtiölle: vähennettävä ALV kuului kuluun. Nyt ehdotus on
   laskun summa ilman vähennettävää veroa. (`fiscalController.ts` accrualSuggestions)
8. **Toimintakertomuksen tuntematon osio tallentui hiljaa** (esim. väärä avain), mutta ei näkynyt tilinpäätöksessä.
   Nyt rajapinta kertoo sallitut osiot. (`closingPackageController.ts`)
9. Siivous ehdotettiin jätehuollon tilille (4300) vaikka tilikartassa on 4250 Siivous; lisätty avainsanat lumityöt
   (4210), toiminnan-/tilintarkastus (4030), hissi (4120), kiinteistövero (4870).
10. Taseen sarakeotsikko PDF:ssä on nyt tilinpäätöspäivä (31.12.2025), ei kausi; "-0,00 €" ei enää tulostu.
11. `KAYNNISTA-KEVYT.bat` odotti minuutteja ja tulosti lopuksi "Valmis" vaikka palvelin ei vastannut: /health palauttaa 503,
    kun raporttipalvelu vielä käynnistyy, ja se tulkittiin virheeksi. Nyt mikä tahansa vastaus kelpaa, ja jos palvelin ei
    vastaa 2 minuutissa, skripti sanoo sen. Selaimen välilehden nimen kirjoitusvirhe korjattu.

### Automaation parannukset (vähemmän käsin hyväksyttävää)
- **Yhtiön omat laskut** (vastikelaskut, vuokralaskut) ovat "varmoja", kun kaikki tulotilit löytyvät tilikartasta.
- **Viitesuoritus yhtiön omaan laskuun** on varma. Tuntematon viite (esim. vanhan järjestelmän lasku) kirjataan edelleen
  myyntisaamisiin, mutta jää tarkistettavaksi ("Viitettä ei löydy yhtiön laskuista").
- **Tuttu toimittaja:** ostolasku on varma myös ilman tekoälyä, kun toimittajalta on aiempi käsin
  hyväksytty lasku samalle kulutilille, saajan tilinumero on sama kuin ennen ja summa on enintään kaksinkertainen
  aiempien suurimpaan nähden. Uusi tilinumero, uusi tili tai poikkeuksellinen summa vaatii aina ihmisen (laskupetokset).
  Maksun hyväksyntäkierto (isännöitsijä/hallitus) ei muutu. (`purchaseMatching.ts` isTrustedSupplier)

### Jatkokorjaukset (16.11.2026, ilta)
Edellisen ajon kolme avointa huomiota korjattu:
- **Vanhan järjestelmän ostovelat laskuittain.** Siirto vanhasta -sivulla on uusi kohta *4. Avoimet ostolaskut*:
  liitä vanhan reskontran avoimet laskut (Toimittaja, Laskunumero, Summa, Eräpäivä, Viite, IBAN; sarakkeet tunnistetaan
  otsikoista). Laskujen summan on täsmättävä avaustaseen ostovelkoihin (2800). Laskut tulevat Ostolaskut-sivulle valmiiksi
  hyväksyttyinä (kulu on jo vanhassa kirjanpidossa), ja kun ne maksetaan, tiliotteen maksu kohdistuu laskuun automaattisesti
  (D 2800 / K 1900, varma). Ennen maksu ehdotettiin kulutilille. Siirron peruminen poistaa myös nämä laskut (ei, jos jo maksettu).
  Rajapinnat: `POST /accounting/migration/payables/preview` ja `POST /accounting/migration/payables` (isännöitsijä).
- **Arkistointi palvelimella allekirjoituksen yhteydessä.** Kun tilinpäätös merkitään allekirjoitetuksi, kirjanpitopalvelu
  arkistoi PDF:t heti (vastauksessa `archive`). Jos arkistointi epäonnistuu, allekirjoitus pysyy ja dashboard yrittää
  uudelleen; Arkistoi-nappi toimii edelleen. Selaimen sulkeminen ei enää jätä tilinpäätöstä arkistoimatta.
- **Uuden toimittajan laskut.** Toimittaja on tuttu jo yhden käsin hyväksytyn laskun jälkeen (ennen kaksi), kun saajan
  tilinumero ja kulutili ovat samat ja summa on enintään kaksinkertainen. Ensimmäinen lasku tarkistetaan aina käsin.
- Vuosiajo: käsin hyväksyttäviä 52 vuodessa (ennen 62): tammikuussa 13 (uudet toimittajat), sen jälkeen 3–5 kuukaudessa.
  60/60 tarkistusta täsmää.

Jäljelle jää: ilman tekoälyavainta uuden toimittajan ensimmäinen lasku hyväksytään käsin. Vanhan järjestelmän avoimet
myyntisaamiset kirjautuvat edelleen tarkistettaviksi (tuntematon viite).
### Testit
Yksikkötestit: accounting 64 (uudet: tuttu toimittaja, viestin tunniste), bank 22 (uusi: camt-viite), invoicing 10,
ml 12 (uudet: pankin nimi ei ole pankkikulu, siivous ja lumityöt), reporting 23. Vuosiajo: 60/60 tarkistusta.

## Jäljelle jäävät (isommat) jatkokehitykset
1. ~~Yhtiökohtainen käyttöoikeus~~ (tehty), ~~tositteiden luku~~ (tehty), ~~luonnosten hyväksyntä ja tilikauden
   sulkeminen dashboardissa~~ (tehty).
2. ~~Audit-lokin muuttumattomuus tietokantatasolla~~ (tehty, moduuli 10).
3. ~~Taloyhtiön tilikartta ja raporttikaavat~~ (tehty, moduuli 3). ~~ALV-velvollisten yhtiöiden ALV-käsittely~~ (tehty, moduuli 8).
4. ~~Vastikereskontra ja maksumuistutukset~~ (tehty, moduuli 4). ~~Ostolaskujen hyväksyntä ja maksuaineisto~~ (tehty, moduuli 5).
5. ~~Usean yhtiön valinta dashboardiin~~ (tehty, moduuli 1).
6. ~~Tilinpäätöksen liitetiedot ja toimintakertomus~~ (tehty, moduuli 7). Tilintarkastajan käyttöoikeus (rooli AUDITOR on jo olemassa).
