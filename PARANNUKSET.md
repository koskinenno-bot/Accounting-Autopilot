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

## Jäljelle jäävät (isommat) jatkokehitykset
1. ~~Yhtiökohtainen käyttöoikeus~~ (tehty), ~~tositteiden luku~~ (tehty), ~~luonnosten hyväksyntä ja tilikauden
   sulkeminen dashboardissa~~ (tehty).
2. ~~Audit-lokin muuttumattomuus tietokantatasolla~~ (tehty, moduuli 10).
3. ~~Taloyhtiön tilikartta ja raporttikaavat~~ (tehty, moduuli 3). ALV-velvollisten yhtiöiden ALV-käsittely.
4. ~~Vastikereskontra ja maksumuistutukset~~ (tehty, moduuli 4). ~~Ostolaskujen hyväksyntä ja maksuaineisto~~ (tehty, moduuli 5).
5. ~~Usean yhtiön valinta dashboardiin~~ (tehty, moduuli 1).
6. ~~Tilinpäätöksen liitetiedot ja toimintakertomus~~ (tehty, moduuli 7). Tilintarkastajan käyttöoikeus (rooli AUDITOR on jo olemassa).
