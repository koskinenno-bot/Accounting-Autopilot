"""Tositteiden (ostolasku, kuitti) tietojen luku.

Ensisijaisesti Claude API (PDF document-blokkina tai kuva image-blokkina, rakenteinen
JSON-vastaus output_config.formatilla). Jos ANTHROPIC_API_KEY puuttuu, tekstipohjaisille
PDF:ille käytetään sääntöpohjaista varajäsennintä (pypdf + säännölliset lausekkeet),
jotta järjestelmä toimii myös ilman avainta. Kuvatositteet vaativat tekoälyn.
"""
import base64
import io
import json
import os
import re
from datetime import date
from typing import Dict, List, Optional

from classifier import SUSPENSE_ACCOUNT, is_expense_account, match_keywords


class ExtractionUnavailable(Exception):
    """Tositetta ei voi lukea tässä ympäristössä (esim. kuva ilman API-avainta)."""


class ExtractionFailed(Exception):
    """Luku epäonnistui (API-virhe, kieltäytyminen, lukukelvoton tiedosto)."""


# Kaikki kentät pakollisia (strict-skeema); puuttuva tieto = null.
_NULLABLE_STR = {"type": ["string", "null"]}
_NULLABLE_NUM = {"type": ["number", "null"]}

VOUCHER_SCHEMA = {
    "type": "object",
    "properties": {
        "documentType": {"type": "string", "enum": ["purchase_invoice", "receipt", "credit_note", "other"]},
        "supplierName": _NULLABLE_STR,
        "supplierBusinessId": {**_NULLABLE_STR, "description": "Y-tunnus muodossa 1234567-8"},
        "invoiceNumber": _NULLABLE_STR,
        "invoiceDate": {**_NULLABLE_STR, "description": "YYYY-MM-DD"},
        "dueDate": {**_NULLABLE_STR, "description": "YYYY-MM-DD"},
        "servicePeriodStart": {**_NULLABLE_STR, "description": "Suoritusjakson alku YYYY-MM-DD, jos laskulla"},
        "servicePeriodEnd": {**_NULLABLE_STR, "description": "Suoritusjakson loppu YYYY-MM-DD, jos laskulla"},
        "totalAmount": {**_NULLABLE_NUM, "description": "Maksettava summa sis. ALV, euroina"},
        "vatAmount": _NULLABLE_NUM,
        "currency": _NULLABLE_STR,
        "referenceNumber": {**_NULLABLE_STR, "description": "Viitenumero ilman välilyöntejä"},
        "iban": {**_NULLABLE_STR, "description": "Saajan tilinumero ilman välilyöntejä"},
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"description": {"type": "string"}, "amount": _NULLABLE_NUM},
                "required": ["description", "amount"],
                "additionalProperties": False,
            },
        },
        "suggestedAccount": {"type": "string", "description": "Tilinumero annetusta tilikartasta"},
        "accountReason": {"type": "string"},
        "confidence": {"type": "number", "description": "0-1: kuinka varma luku ja tiliöinti on"},
    },
    "required": [
        "documentType", "supplierName", "supplierBusinessId", "invoiceNumber", "invoiceDate", "dueDate",
        "servicePeriodStart", "servicePeriodEnd", "totalAmount", "vatAmount", "currency", "referenceNumber",
        "iban", "lines", "suggestedAccount", "accountReason", "confidence",
    ],
    "additionalProperties": False,
}

DEFAULT_MODEL = "claude-opus-5-5"


def has_api_key() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _chart_text(accounts: List[Dict]) -> str:
    return "\n".join(f"{a['accountNumber']} {a['accountName']}" for a in accounts)


def _claude_extract(data: bytes, mime_type: str, accounts: List[Dict]) -> Dict:
    import anthropic  # tuodaan vasta tarvittaessa: palvelu käynnistyy ilman pakettia

    if mime_type == "application/pdf":
        file_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                     "data": base64.standard_b64encode(data).decode("ascii")}}
    elif mime_type in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        file_block = {"type": "image", "source": {"type": "base64", "media_type": mime_type,
                                                  "data": base64.standard_b64encode(data).decode("ascii")}}
    else:
        raise ExtractionFailed(f"Tiedostotyyppiä {mime_type} ei tueta (PDF, JPEG, PNG, GIF, WEBP)")

    system = (
        "Luet suomalaisen asunto-osakeyhtiön kirjanpitoon tulevia tositteita (ostolaskut, kuitit). "
        "Poimi tiedot täsmälleen tositteesta; jos tietoa ei ole, palauta null. Älä arvaa summia tai päivämääriä. "
        "Toimittaja on laskun lähettäjä, ei taloyhtiö (ostaja). "
        "Valitse suggestedAccount alla olevasta tilikartasta: kulun luonteen mukainen hoitokulu- tai korjaustili. "
        f"Jos sopivaa tiliä ei ole, käytä {SUSPENSE_ACCOUNT['code']}. "
        "confidence kuvaa, kuinka varma olet sekä luetuista tiedoista että tiliöinnistä.\n\n"
        f"Tilikartta:\n{_chart_text(accounts)}"
    )
    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL),
            max_tokens=16000,
            # Kieltäytymistilanteessa API ajaa pyynnön automaattisesti varamallilla
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": VOUCHER_SCHEMA}},
            messages=[{"role": "user", "content": [file_block, {"type": "text", "text": "Lue tämän tositteen tiedot."}]}],
        )
    except anthropic.AuthenticationError:
        raise ExtractionFailed("ANTHROPIC_API_KEY on virheellinen")
    except anthropic.RateLimitError:
        raise ExtractionFailed("Claude API:n käyttöraja täynnä, yritä myöhemmin uudelleen")
    except anthropic.APIStatusError as e:
        raise ExtractionFailed(f"Claude API vastasi {e.status_code}: {e.message}")
    except anthropic.APIConnectionError:
        raise ExtractionFailed("Claude API:a ei tavoiteta")

    if response.stop_reason == "refusal":
        raise ExtractionFailed("Tekoäly kieltäytyi lukemasta tositetta")
    if response.stop_reason == "max_tokens":
        raise ExtractionFailed("Tositteen luku katkesi (max_tokens)")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise ExtractionFailed("Tekoäly ei palauttanut tietoja")
    result = json.loads(text)
    result["extractor"] = "claude"
    return result


BANK_STATEMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "accountIban": _NULLABLE_STR,
        "transactions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "bookingDate": {"type": "string", "description": "Kirjauspäivä YYYY-MM-DD"},
                    "amount": {"type": "number", "description": "Aina positiivinen euromäärä"},
                    "direction": {"type": "string", "enum": ["CRDT", "DBIT"], "description": "CRDT = tilille tullut, DBIT = tililtä lähtenyt"},
                    "counterpartyName": _NULLABLE_STR,
                    "counterpartyIban": _NULLABLE_STR,
                    "referenceNumber": {**_NULLABLE_STR, "description": "Viitenumero ilman välilyöntejä"},
                    "message": _NULLABLE_STR,
                    "archiveId": {**_NULLABLE_STR, "description": "Arkistointitunnus, jos tiliotteella"},
                },
                "required": ["bookingDate", "amount", "direction", "counterpartyName", "counterpartyIban",
                             "referenceNumber", "message", "archiveId"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["accountIban", "transactions"],
    "additionalProperties": False,
}


def extract_bank_statement(data: bytes) -> Dict:
    """PDF-tiliote -> tapahtumalista (vaatii tekoälyn: pankkien PDF-asettelut vaihtelevat liikaa säännöille)."""
    if not has_api_key():
        raise ExtractionUnavailable("ANTHROPIC_API_KEY puuttuu: PDF-tiliotteen luku vaatii tekoälyn. Käytä camt.053- tai CSV-tiedostoa.")
    import anthropic

    client = anthropic.Anthropic()
    document = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                               "data": base64.standard_b64encode(data).decode("ascii")}}
    try:
        # Pitkä tiliote voi tuottaa paljon tapahtumia => striimaus (ei HTTP-aikakatkaisua)
        with client.beta.messages.stream(
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL),
            max_tokens=64000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=(
                "Luet suomalaisen pankin PDF-tiliotteen tapahtumat. Poimi jokainen tapahtuma täsmälleen sellaisenaan: "
                "älä jätä pois, älä yhdistä äläkä keksi tapahtumia. Ohita alku- ja loppusaldorivit sekä välisummat. "
                "Summa on aina positiivinen; suunta kertoo, tuliko raha tilille (CRDT) vai lähtikö (DBIT)."
            ),
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": BANK_STATEMENT_SCHEMA}},
            messages=[{"role": "user", "content": [document, {"type": "text", "text": "Poimi tiliotteen tapahtumat."}]}],
        ) as stream:
            response = stream.get_final_message()
    except anthropic.APIError as e:
        raise ExtractionFailed(f"Claude API: {e}")
    if response.stop_reason in ("refusal", "max_tokens"):
        raise ExtractionFailed(f"Tiliotteen luku keskeytyi ({response.stop_reason})")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise ExtractionFailed("Tekoäly ei palauttanut tapahtumia")
    return json.loads(text)


CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "account": {"type": "string", "description": "Tilinumero annetusta tilikartasta"},
        "reason": {"type": "string", "description": "Lyhyt perustelu suomeksi"},
        "confidence": {"type": "number", "description": "0-1"},
    },
    "required": ["account", "reason", "confidence"],
    "additionalProperties": False,
}


def classify_with_claude(description: str, supplier: Optional[str], amount: float, kind: Optional[str],
                         accounts: List[Dict]) -> Dict:
    """Tuntemattoman toimittajan pankkitapahtuman tiliöintiehdotus tilikartasta."""
    import anthropic

    direction = {"expense": "lähtevä maksu (kulu)", "income": "saapuva maksu (tuotto)"}.get(kind or "", "pankkitapahtuma")
    client = anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL),
            max_tokens=2000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=(
                "Tiliöit suomalaisen asunto-osakeyhtiön pankkitapahtumia. Valitse tili vain annetusta tilikartasta. "
                f"Jos et voi päätellä tiliä luotettavasti, valitse {SUSPENSE_ACCOUNT['code']} ja anna matala varmuus.\n\n"
                f"Tilikartta:\n{_chart_text(accounts)}"
            ),
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": CLASSIFY_SCHEMA}},
            messages=[{"role": "user", "content": (
                f"Tapahtuma: {direction}\nVastapuoli: {supplier or '-'}\nViesti: {description}\nSumma: {amount:.2f} €"
            )}],
        )
    except anthropic.APIError as e:
        raise ExtractionFailed(f"Claude API: {e}")
    if response.stop_reason in ("refusal", "max_tokens"):
        raise ExtractionFailed(f"Luokittelu keskeytyi ({response.stop_reason})")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise ExtractionFailed("Tekoäly ei palauttanut tiliä")
    result = json.loads(text)
    if not any(a["accountNumber"] == result["account"] for a in accounts):
        result = {"account": SUSPENSE_ACCOUNT["code"], "reason": f"Ehdotettu tili {result['account']} ei ole tilikartassa", "confidence": 0.1}
    return result


# ---------------------------------------------------------------------------
# Varajäsennin tekstipohjaisille PDF:ille (ei tekoälyä)
# ---------------------------------------------------------------------------

_DATE = r"(\d{1,2})\.(\d{1,2})\.(\d{4})"
_AMOUNT = r"(-?\d{1,3}(?:[  ]?\d{3})*,\d{2})"


def _iso(d: str, m: str, y: str) -> Optional[str]:
    try:
        return date(int(y), int(m), int(d)).isoformat()
    except ValueError:
        return None


def _find_date(text: str, labels: str) -> Optional[str]:
    match = re.search(rf"(?:{labels})\s*:?\s*{_DATE}", text, re.IGNORECASE)
    return _iso(*match.groups()) if match else None


def _amount(s: str) -> float:
    return float(s.replace(" ", "").replace(" ", "").replace(",", "."))


def parse_invoice_text(text: str, accounts: Optional[List[Dict]] = None) -> Dict:
    """Jäsentää suomenkielisen laskun tekstin. Puhdas funktio (testattavissa)."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    found: Dict = {
        "documentType": "purchase_invoice",
        "supplierName": lines[0] if lines else None,
        "supplierBusinessId": None, "invoiceNumber": None, "invoiceDate": None, "dueDate": None,
        "servicePeriodStart": None, "servicePeriodEnd": None, "totalAmount": None, "vatAmount": None,
        "currency": "EUR", "referenceNumber": None, "iban": None, "lines": [],
    }

    if m := re.search(r"Y-tunnus\s*:?\s*(\d{7}-\d)", text, re.IGNORECASE):
        found["supplierBusinessId"] = m.group(1)
    if m := re.search(r"(?:Laskun\s*(?:numero|nro)|Lasku\s*nro|Laskunumero)\s*:?\s*([A-Za-z0-9-]+)", text, re.IGNORECASE):
        found["invoiceNumber"] = m.group(1)
    found["invoiceDate"] = _find_date(text, r"Laskun\s*päivämäärä|Laskupäivä|Päiväys|Päivämäärä")
    found["dueDate"] = _find_date(text, r"Eräpäivä")
    if m := re.search(rf"(?:Laskutuskausi|Ajanjakso|Suoritusjakso)\s*:?\s*{_DATE}\s*[-–]\s*{_DATE}", text, re.IGNORECASE):
        g = m.groups()
        found["servicePeriodStart"], found["servicePeriodEnd"] = _iso(*g[:3]), _iso(*g[3:])
    # Summa voi olla samalla tai seuraavalla rivillä (oikealle tasattu teksti on PDF:ssä oma rivinsä)
    totals = re.findall(rf"(?:Yhteensä|Maksettava|Loppusumma)[^\d\n-]*\n?[^\d\n-]*{_AMOUNT}", text, re.IGNORECASE)
    if totals:
        found["totalAmount"] = _amount(totals[-1])
    if m := re.search(rf"ALV[^\n]*?{_AMOUNT}\s*(?:€|EUR)?\s*$", text, re.IGNORECASE | re.MULTILINE):
        found["vatAmount"] = _amount(m.group(1))
    if m := re.search(r"Viite(?:numero)?\s*:?\s*((?:RF\d{2}[ \d]+)|(?:\d[\d ]{2,24}\d))", text, re.IGNORECASE):
        found["referenceNumber"] = m.group(1).replace(" ", "")
    if m := re.search(r"\b(FI\d{2}(?:\s?\d{4}){3}\s?\d{2})\b", text):
        found["iban"] = m.group(1).replace(" ", "")

    # Ostolasku on aina kulu: tuottotilit (3xxx, esim. "vesimaksu" = osakkailta perittävä) eivät käy
    hits = [h for h in match_keywords(text.lower()) if is_expense_account(h["code"])]
    account = hits[0]["code"] if hits else SUSPENSE_ACCOUNT["code"]
    if accounts and not any(a["accountNumber"] == account for a in accounts):
        account = SUSPENSE_ACCOUNT["code"]
    found["suggestedAccount"] = account
    found["accountReason"] = f"Avainsana: {hits[0]['label']}" if hits else "Ei tunnistettua avainsanaa"

    essential = ["supplierName", "invoiceDate", "totalAmount", "dueDate"]
    share = sum(1 for k in essential if found[k] is not None) / len(essential)
    # Sääntöpohjainen luku on aina epävarmempi kuin tekoäly => katto 0.75 (alle automaattirajan 0.8)
    found["confidence"] = round(0.75 * share * (1.0 if hits else 0.8), 2)
    found["extractor"] = "heuristic"
    return found


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def extract_voucher(data: bytes, mime_type: str, accounts: List[Dict]) -> Dict:
    if has_api_key():
        return _claude_extract(data, mime_type, accounts)
    if mime_type != "application/pdf":
        raise ExtractionUnavailable("ANTHROPIC_API_KEY puuttuu: kuvatositteiden luku vaatii tekoälyn")
    try:
        text = _pdf_text(data)
    except Exception as e:  # pypdf: vioittunut tai salattu tiedosto
        raise ExtractionFailed(f"PDF:n lukeminen epäonnistui: {e}")
    if len(text.strip()) < 20:
        raise ExtractionUnavailable("PDF on skannattu kuva: luku vaatii tekoälyn (ANTHROPIC_API_KEY puuttuu)")
    return parse_invoice_text(text, accounts)
