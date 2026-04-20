import io
import re
from datetime import datetime
from typing import List, Dict, Any
from pypdf import PdfReader

def parse_pdf_bank_statement(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Advanced Multi-line PDF bank statement parser for Finnish banks.
    Capable of combining split lines (date on one line, ref on another).
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() + "\n"

    lines = full_text.split("\n")
    transactions = []
    
    current_tx = None
    
    # Standard Finnish date pattern (DD.MM.YYYY or DD.MM.)
    date_regex = r"^(\d{1,2}\.\d{1,2}\.(\d{4})?)"
    # Amount pattern (-123,45 or 1 234,56)
    amount_regex = r"(-?\d+[\s\.]?\d*,\d{2})"
    
    for line in lines:
        line = line.strip()
        if not line: continue
        
        # Check if line starts a new transaction (starts with a date)
        date_match = re.match(date_regex, line)
        if date_match:
            # If we had a previous transaction in the works, save it
            if current_tx:
                transactions.append(current_tx)
            
            # Start new transaction
            raw_date = date_match.group(1)
            parsed_date = _parse_finnish_date(raw_date)
            
            # Extract possible amount on the same line
            amount_match = re.search(amount_regex, line)
            amount = 0.0
            if amount_match:
                amount = _clean_amount(amount_match.group(0))
            
            # Initial description
            desc = line[len(date_match.group(0)):].strip()
            if amount_match:
                desc = desc.replace(amount_match.group(0), "").strip()
            
            current_tx = {
                "date": parsed_date,
                "amount": amount,
                "description": desc,
                "reference_number": None,
                "iban": None
            }
        
        elif current_tx:
            # Continuation line - look for missing info
            
            # Look for reference number (Viite)
            ref_match = re.search(r"(Viitenumero|Viite):?\s*(\d[\d\s]+)", line, re.IGNORECASE)
            if ref_match:
                current_tx["reference_number"] = ref_match.group(2).replace(" ", "")
            
            # Look for IBAN
            iban_match = re.search(r"FI\d{16}", line.replace(" ", ""))
            if iban_match:
                current_tx["iban"] = iban_match.group(0)
                
            # Look for amount if it wasn't on the first line
            if current_tx["amount"] == 0.0:
                amount_match = re.search(amount_regex, line)
                if amount_match:
                    current_tx["amount"] = _clean_amount(amount_match.group(0))
            
            # Append to description if it's not a reference line
            if not ref_match and not iban_match:
                current_tx["description"] += " " + line

    # Append the last one
    if current_tx:
        transactions.append(current_tx)
        
    return transactions

def _clean_amount(raw: str) -> float:
    return float(raw.replace(" ", "").replace(".", "").replace(",", "."))

def _parse_finnish_date(date_str: str) -> datetime.date:
    date_str = date_str.strip(".")
    parts = date_str.split(".")
    day = int(parts[0])
    month = int(parts[1])
    year = int(parts[2]) if len(parts) > 2 and parts[2] else datetime.now().year
    return datetime(year, month, day).date()
