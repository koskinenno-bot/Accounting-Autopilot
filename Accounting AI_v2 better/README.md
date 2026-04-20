# Kirjanpito-AI (Accounting Autopilot)

Moderni, tekoälypohjainen SaaS-alusta suomalaisten asunto-osakeyhtiöiden kirjanpidon automaatioon. Järjestelmä on suunniteltu täyttämään Kirjanpitolain (KPL) vaatimukset ja automatisoimaan jopa 100 % kuukausittaisesta kirjanpitotyöstä.

![Accounting Autopilot](frontend/public/favicon.ico)

## Esittely

Asunto-osakeyhtiöiden isännöinti ja kirjanpito on perinteisesti työlästä ja manuaalista. **Kirjanpito-AI** ratkaisee tämän yhdistämällä perinteisen sääntöpohjaisen automaation ja uusimman tekoälyn (Google Gemini 1.5 Flash). Järjestelmä lukee pankin tiliotteet, kohdistaa maksut viitenumeroiden perusteella ja tiliöi loput tapahtumat älykkäästi.

## Tärkeimmät ominaisuudet

1.  **Kolmitasoinen Tiliöintimoottori:**
    *   **Taso 1:** Viitenumerotarkistus (7-3-1 moduuli-10). Kohdistaa vastikemaksut automaattisesti oikeille huoneistoille.
    *   **Taso 2:** Sääntöpohjainen Regex-moottori. Tunnistaa vakiotoimittajat (esim. Helen, paikallinen jätehuolto) ja tiliöi ne oikeille kulutileille.
    *   **Taso 3:** Google Gemini 1.5 Flash AI. Analysoi epäselvät tilitapahtumat ja ehdottaa tiliöintiä taloyhtiön tilikartan perusteella.
2.  **Lakisääteiset Raportit:**
    *   **Tuloslaskelma & Tase:** Reaaliaikainen seuranta ja viralliset kaavat.
    *   **Vastikelaskelma:** Erityisesti taloyhtiöille suunnattu raportointi.
    *   **ALV-raportointi:** Automaattinen arvonlisäveron käsittely ja raportointi.
3.  **Kahdenkertainen Kirjanpito:**
    *   Vankka `JournalLine`-pohjainen kirjanpitoarkkitehtuuri varmistaa tietojen eheyden ja täydellisen kirjausketjun (Audit Trail).
4.  **Isännöitsijän Työkalupakki:**
    *   Dashboard-näkymä talousarvion ja kassavirran seurantaan.
    *   Puuttuvat maksut -widget: näe heti ketkä osakkaat ovat jättäneet vastikkeet maksamatta.
    *   Monen yhtiön hallinta (Multi-tenancy) yhdellä tunnuksella.

## Tekninen toteutus

*   **Backend:** Python 3.13, FastAPI, SQLModel (SQLAlchemy 2.0).
*   **Frontend:** Next.js 14, React 18, TypeScript, Premium Glassmorphism UI.
*   **Tietokanta:** PostgreSQL 15 Docker-ympäristössä (kehityksessä tuki SQLite-tiedostolle).
*   **Tekoäly:** Google GenAI SDK (Gemini 1.5 Flash).
*   **Infrastruktuuri:** Täysi Docker-tuki (docker-compose).

## Pikaohje: Käyttöönotto

Järjestelmä on kontitettu ja valmis ajettavaksi Dockerilla.

### 1. Esivaatimukset
*   [Docker Desktop](https://www.docker.com/products/docker-desktop/) asennettuna.
*   Google Gemini API-avain.

### 2. Käynnistys
Lisää Gemini API-avaimesi `backend/.env` tiedostoon ja aja komento:

```bash
# Rakenna ja käynnistä koko palvelu
docker-compose up --build -d
```

Palvelut ovat nyt käynnissä:
*   **Käyttöliittymä:** [http://localhost:3000](http://localhost:3000)
*   **API-dokumentaatio (Swagger):** [http://localhost:8000/docs](http://localhost:8000/docs)

### 3. Kehitysympäristö (Ilman Dockeria)
Jos haluat ajaa järjestelmää paikallisesti:
1.  **Backend:** Asenna riippuvuudet `pip install -r requirements.txt`, aja `python seed.py` ja käynnistä `uvicorn main:app --reload`.
2.  **Frontend:** Aja `npm install` ja `npm run dev`.

## Kirjanpitolain Mukaisuus

Järjestelmä on kehitetty noudattaen suomalaista kirjanpitolakia ja hyvää kirjanpitotapaa. Kaikki tapahtumat tallennetaan siten, että ne muodostavat katkeamattoman kirjausketjun alustavasta viennistä lopulliseen tilinpäätökseen asti.
