# AI ACCOUNT_V3 – katselmointi ja parannukset (1.11.2026)

Alkuperäiset versiot muutetuista tiedostoista: `_varmuuskopio_claude_2026-11-01/`.
Kansiossa ei ole git-versionhallintaa, joten varmuuskopio on ainoa paluutie.

## Tehty (turvalliset korjaukset)

### accounting-service
| Ongelma | Vaikutus | Korjaus |
|---|---|---|
| `EntryStatus` puuttui importeista | Palvelu ei kääntynyt | Import lisätty |
| Käsin syötetyiltä riveiltä puuttui `companyId` | Jokainen `POST /entries` kaatui | Lisätty |
| Kuluttajat käyttivät `@prisma/client`-pakettia vaikka client generoidaan `prisma/client`-kansioon | Automaattikirjaukset (pankki, laskut, tositteet) eivät toimineet | Yksi jaettu client `src/db.ts` |
| Audit-middleware (KPL 2:6 §) oli vain index.ts:n omassa clientissa | Mitään oikeaa kirjausta ei lokitettu | Middleware jaetussa clientissa; `updateMany`/`deleteMany` muunnetaan audit-enumin arvoiksi |
| Kaksi ristiriitaista tilikarttaa (esim. 1700 = Ostovelat vs. Myyntisaamiset), kirjauksissa tilejä joita ei ole (1701, 9999) | Viite-eheysvirhe, kirjaukset kaatuivat | Yksi TATO-pohja, tilivakiot `src/accounts.ts`, lisätty 1990 Selvitettävät erät |
| Viitteellinen pankkisuoritus kirjattiin K 3000 Hoitovastikkeet, vaikka lasku oli jo kirjattu tuotoksi | **Vastiketuotot kahdentuivat** | Suoritus kirjataan D Pankki / K Myyntisaamiset |
| `BANK-${Date.now()}` toistui saman millisekunnin sisällä; Kafka `fromBeginning` toisti viestejä | Kirjauksia katosi tai tuplaantui | Deterministiset tositenumerot + tarkistus ennen luontia |
| Tasetarkistus liukuluvuilla, negatiiviset ja debet+kredit samalla rivillä sallittiin | Virheellisiä vientejä | Tarkistus senteissä + rivikohtaiset tarkistukset, selkeät 400/409-virheet |
| Kirjatun (POSTED) viennin sai poistaa | KPL 2:7 § | Vain luonnoksen voi poistaa |
| ML:n ehdottamaa tiliä ei ole tilikartassa | Tositekirjaus kaatui | Tuntematon tili → 1990 Selvitettävät erät |
| Yhtiön luonnissa ei luotu tilikautta | Kaikki käsikirjaukset hylättiin ("ei avointa tilikautta") | Ensimmäinen tilikausi luodaan company.created-tapahtumasta |
| `axios` puuttui riippuvuuksista; `.env` luettiin vasta importtien jälkeen | | Korjattu |

### user-service
- **JWT-salaisuus oli käytännössä aina `'secret'`**, koska `dotenv.config()` ajettiin vasta kun salaisuus oli jo luettu. Kuka tahansa pystyi väärentämään kirjautumisen. Nyt `src/config.ts` lataa .env:n ensin, ja tuotannossa puuttuva salaisuus on virhe. *Vanhat tokenit lakkaavat toimimasta, kirjaudu uudelleen.*
- Osakasrekisterin sai luettua/kirjoitettua minkä tahansa yhtiön `companyId`:llä. Nyt vaaditaan jäsenyys yhtiössä (tai SUPER_ADMIN).
- `rbac.ts` importtasi olemattoman `Role`-enumin; roolit määritelty paikallisesti.

### invoicing-service
- `prisma` oli määrittelemättä controllerissa → laskujen luonti kaatui aina. Korjattu.
- `disconnectKafka` puuttui; Kafka-kuluttajan virhe kaatoi koko kuluttajan. Korjattu.

### ml-service / reporting-service
- ML-worker lähetti `suggested_account`, kirjanpito luki `suggestedAccount` → tili oli aina tyhjä. Nyt camelCase + ISO-aikaleima (kirjanpito hyväksyy molemmat).
- Vastikelaskelma kaatui ei-numeeriseen tilinumeroon.

## Ehdotukset (vaativat päätöksesi)

1. **Audit-palvelu ei tallenna mitään.** Ajossa oleva `auditRoutes.js` vain tulostaa konsoliin ja `GET` palauttaa tyhjän listan. Oikea tallentava controller on olemassa, mutta audit-palvelun Prisma-client on rikki (tyhjät tiedostot, vanha SQLite-skeema). Vaatii `npx prisma generate` + migraation. KPL 2:6 § kannalta tärkein.
2. **Kirjanpito-, lasku-, pankki- ja audit-rajapinnat ovat ilman tunnistautumista.** Kuka tahansa verkossa voi lukea pääkirjan tai luoda vientejä. Ehdotus: yhteinen JWT-middleware `packages/`-kansioon.
3. **Laskunumero on uniikki koko järjestelmässä**, mutta numerointi on yhtiökohtainen → toinen yhtiö saa virheen. Lisäksi rinnakkaiset pyynnöt voivat saada saman numeron. Vaatii skeemamuutoksen `@@unique([companyId, invoiceNumber])`.
4. **ML-palvelun tilinumerot (5000, 5100, 8000 …) eivät vastaa TATO-tilikarttaa** (4000 Sähkö, 4100 Lämmitys, 8000 Isännöinti). Nyt ne ohjautuvat selvitettäviin eriin.
5. **Raportit sisältävät luonnokset (DRAFT)**, eikä luonnoksia voi hyväksyä (POSTED) mistään rajapinnasta. Tarvitaan hyväksyntä-endpoint ja raporttien rajaus.
6. **Versionhallinta**: kansio ei ole git-repo, ja `.env`-tiedostoissa on salasanoja. Suositus: `git init` + `.gitignore` (.env, node_modules, *.db, prisma/client).
7. Pienemmät: Kong-reitit eivät vastaa palveluiden polkuja; `apps/user-service/ .env` (välilyönti nimessä) on ylimääräinen kopio; `query_engine-windows.dll.node.tmp15532` (19 Mt) on jäänne; rekisteröityminen antaa kaikille COMPANY_ADMIN-roolin; `bank-service`-reconciliationController käyttää kenttää `accountId` ja tilejä 1910/1701 eikä sitä ole reititetty.
8. Testit: projektissa ei ole yhtään automaattista testiä. Ensimmäiseksi kannattaisi testata tasetarkistus, viitenumero ja pankkikirjausten tiliöinti.
