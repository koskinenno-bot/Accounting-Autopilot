import os
import json
import re
import io
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from pypdf import PdfReader

from sqlmodel import Session, select
from models import Transaction, AccountCategory, MatchType


def extract_receipt_data(file_bytes: bytes, mime_type: str) -> Dict[str, Any]:
    """
    Offline receipt data extraction. 
    Uses native regex for Finnish Virtual Barcodes (Virtuaaliviivakoodi).
    """
    text = ""
    if mime_type == "application/pdf":
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                text += page.extract_text() + "\n"
        except:
            pass
    else:
        # For images, we'd need Tesseract OCR. For now, we return manual.
        pass

    # ── VIRTUAL BARCODE (Finnish Standard) ──────────────────────────────────
    # Starts with 4 or 5, length 54
    barcode_match = re.search(r"[45]\d{53}", text.replace(" ", ""))
    if barcode_match:
        bc = barcode_match.group(0)
        # Position mapping:
        # 0: Version
        # 1-16: IBAN (partial)
        # 17: Padding
        # 18-25: Amount Euro (6) + Cents (2)
        # 28-47: Reference
        # 48-53: Due Date (YYMMDD)
        
        try:
            raw_amount = bc[18:24].lstrip('0') + "." + bc[24:26]
            amount = float(raw_amount) if raw_amount != "." else 0.0
            
            raw_ref = bc[28:48].lstrip('0')
            # Reference check digit math could be verified here
            
            raw_date = bc[48:54]
            due_date = f"20{raw_date[0:2]}-{raw_date[2:4]}-{raw_date[4:6]}"
            
            return {
                "vendor": "Maksupalvelu (Barcode Match)",
                "amount": amount,
                "date": due_date,
                "reference_number": raw_ref,
                "match_source": "BARCODE"
            }
        except:
            pass

    return {
        "vendor": "Käsittely vaaditaan",
        "amount": 0.0,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "suggested_category_code": "4100"
    }


def match_receipt_to_transactions(
    extracted_data: Dict[str, Any], 
    company_id: int, 
    session: Session
) -> Optional[Transaction]:
    """
    Searches for a matching transaction in the database.
    Now supports Reference Number matching for Virtual Barcodes.
    """
    amount = float(extracted_data.get("amount", 0))
    ref = extracted_data.get("reference_number")
    date_str = extracted_data.get("date")
    
    # Priority 1: Reference Number (Exact)
    if ref:
        stmt = select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.reference_number == ref,
            Transaction.is_verified == False
        )
        match = session.exec(stmt).first()
        if match: return match

    if not date_str: return None
        
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except:
        return None

    # Search window
    start_date = target_date - timedelta(days=7)
    end_date = target_date + timedelta(days=7)

    # Priority 2: Fuzzy matching (Amount + Window)
    stmt = select(Transaction).where(
        Transaction.company_id == company_id,
        Transaction.date >= start_date,
        Transaction.date <= end_date,
        Transaction.is_verified == False
    )
    
    candidates = session.exec(stmt).all()
    
    best_match = None
    min_diff = 1000.0
    
    for tx in candidates:
        diff = abs(tx.amount - amount)
        if diff < 0.05:
            # Check description for vendor match if source is not barcode
            vendor = extracted_data.get("vendor", "").lower()
            if "barcode" not in extracted_data.get("match_source", ""):
                 if vendor in tx.description.lower() or tx.description.lower() in vendor:
                    return tx 
            
            if diff < min_diff:
                min_diff = diff
                best_match = tx

    return best_match
