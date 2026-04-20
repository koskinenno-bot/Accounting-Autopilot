"""
Fuzzy CSV parser for Finnish bank exports.

Supports:
  - Semicolon (;) and comma (,) delimiters — auto-detected
  - Column headers: Date, Description, Amount, Reference (case-insensitive, partial match)
  - Finnish decimal conventions: comma as decimal separator (e.g. "1 234,56")
  - Separate Debet/Kredit columns (Nordea, OP, Danske Bank format)
  - Strips whitespace, BOM characters, and quotes
  - Skips blank and header-only rows

Bank format examples supported:
  - Nordea: Kirjauspäivä; Määrä; Saajan nimi/Maksajan nimi; Viite
  - OP:      Kirjauspäivä; Summa; Saaja/Maksaja; Viite
  - Danske:  Date; Description; Debet; Kredit; Reference
  - Generic: Date, Description, Amount, Reference
"""
import csv
import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_finnish_amount(raw: str) -> Optional[float]:
    """Parse amount strings like '1 234,56' or '-450.75' or '1234.56'."""
    if not raw or not raw.strip():
        return None
    cleaned = raw.strip().replace("\xa0", "").replace(" ", "").replace("\u202f", "")
    # Remove leading/trailing quotes
    cleaned = cleaned.strip('"\'')
    # Replace comma decimal separator with dot (Finnish convention)
    # Handle European format: 1.234,56 → 1234.56
    if re.search(r"\d,\d", cleaned):        # Comma is the decimal separator
        cleaned = cleaned.replace(".", "").replace(",", ".")
    # Handle plain negative with parentheses: (123.45) → -123.45
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_date(raw: str) -> Optional[date]:
    """Try common Finnish/ISO date formats."""
    raw = raw.strip().strip('"\'')
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y%m%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _detect_delimiter(sample: str) -> str:
    """Return ';' or ',' based on which appears more in the header row."""
    first_line = sample.split("\n")[0]
    if first_line.count(";") >= 3:
        return ";"
    if first_line.count(",") >= 3:
        return ","
    # Fallback: tab
    if "\t" in first_line:
        return "\t"
    return ";"  # Finnish bank default


def _map_header(headers: List[str]) -> Dict[str, int]:
    """
    Map canonical column names to their index using fuzzy matching.
    Keys returned: 'date', 'description', 'amount', 'debet', 'kredit', 'reference', 'iban'
    """
    mapping = {}
    canonical = {
        "date": ["date", "päivä", "pvm", "booking", "kirjauspäivä", "transactiondate",
                 "arvopäivä", "maksupäivä", "tapahtumanpäivämäärä"],
        "description": ["description", "kuvaus", "selite", "saaja", "maksaja", "message",
                        "viesti", "tiedot", "tapahtumateksti", "saajanimaksajanimi",
                        "saajan nimi", "maksajan nimi"],
        "amount": ["amount", "summa", "määrä", "belopp", "summaeur", "summa eur",
                   "tapahtuma", "arvo"],
        # Separate debit/credit columns (Nordea, OP, Danske)
        "debet":  ["debet", "debit", "veloitus", "expense", "out", "menot"],
        "kredit": ["kredit", "credit", "hyvitys", "income", "in", "tulot"],
        "reference": ["reference", "viite", "viitenumero", "ref", "referens", "viiteno"],
        "iban": ["iban", "tilinumero", "account", "vastatili", "tilinro"],
    }
    for idx, header in enumerate(headers):
        normalized = header.strip().lower().replace(" ", "").replace(".", "").replace("/", "")
        for key, patterns in canonical.items():
            if key not in mapping:
                for pattern in patterns:
                    pattern_norm = pattern.replace(" ", "").replace(".", "")
                    if pattern_norm in normalized or normalized in pattern_norm:
                        mapping[key] = idx
                        break
    return mapping


# ── Public API ────────────────────────────────────────────────────────────────

def parse_bank_csv(content: bytes) -> List[Dict[str, Any]]:
    """
    Parse a Finnish bank CSV file (bytes) into a list of transaction dicts.

    Each dict contains:
      - date: datetime.date
      - description: str
      - amount: float  (positive = income, negative = expense)
      - reference_number: str | None
      - iban: str | None
    """
    # Try UTF-8 with BOM, then latin-1 (Windows Excel exports)
    for encoding in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            text = content.decode(encoding).strip()
            break
        except UnicodeDecodeError:
            continue
    else:
        text = content.decode("latin-1", errors="replace").strip()

    delimiter = _detect_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)

    rows = list(reader)
    if not rows:
        return []

    # Find header row: first row that contains at least 'date' AND ('amount' OR 'debet'/'kredit')
    header_idx = 0
    col_map: Dict[str, int] = {}
    for i, row in enumerate(rows[:20]):  # Only check first 20 rows
        candidate = _map_header(row)
        has_date = "date" in candidate
        has_amount = "amount" in candidate or ("debet" in candidate and "kredit" in candidate)
        if has_date and has_amount:
            col_map = candidate
            header_idx = i
            break

    if not col_map:
        return []

    transactions: List[Dict[str, Any]] = []
    for row in rows[header_idx + 1:]:
        if not any(cell.strip() for cell in row):
            continue  # skip blank rows
        if len(row) <= max(col_map.values(), default=0):
            continue  # skip malformed rows

        raw_date = row[col_map["date"]].strip() if "date" in col_map else ""
        raw_desc = row[col_map["description"]].strip() if "description" in col_map else ""
        raw_ref = row[col_map["reference"]].strip() if "reference" in col_map else ""
        raw_iban = row[col_map["iban"]].strip().replace(" ", "") if "iban" in col_map else ""

        # ── Amount resolution: single column OR debet+kredit ────────────────
        parsed_amount: Optional[float] = None
        if "amount" in col_map:
            parsed_amount = _parse_finnish_amount(row[col_map["amount"]])
        elif "debet" in col_map and "kredit" in col_map:
            raw_debet = row[col_map["debet"]] if col_map["debet"] < len(row) else ""
            raw_kredit = row[col_map["kredit"]] if col_map["kredit"] < len(row) else ""
            d = _parse_finnish_amount(raw_debet) or 0.0
            k = _parse_finnish_amount(raw_kredit) or 0.0
            if d != 0.0 or k != 0.0:
                # Debet = expense (negative), Kredit = income (positive)
                parsed_amount = k - d if k != 0.0 else -d

        parsed_date = _parse_date(raw_date)

        if parsed_date is None or parsed_amount is None:
            continue  # skip rows we can't parse

        transactions.append(
            {
                "date": parsed_date,
                "description": raw_desc,
                "amount": round(parsed_amount, 2),
                "reference_number": raw_ref if raw_ref else None,
                "iban": raw_iban if raw_iban else None,
            }
        )

    return transactions
