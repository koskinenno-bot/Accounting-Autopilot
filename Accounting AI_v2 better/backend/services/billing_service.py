from datetime import date

def generate_virtuaaliviivakoodi_v4(iban: str, amount: float, reference: str, due_date: date = None) -> str:
    """
    Generates a 54-character Finnish Virtual Barcode (version 4).
    Standard: Pankkiviivakoodi-opas (Finance Finland).
    """
    # 1. Version (4 = IBAN + National Reference)
    version = "4"
    
    # 2. IBAN (16 digits body, skip FIxx)
    clean_iban = iban.replace(" ", "").replace("-", "")
    # Finnish IBAN is 18 chars: FI (2) + Check (2) + Body (14). 
    # Actually wait, standard says 16 digits of account info. 
    # For FI, it's 4th char onwards.
    iban_body = clean_iban[4:].zfill(16)
    
    # 3. Amount (8 digits: 6 euro, 2 cents)
    euro_part = int(amount)
    cent_part = int(round((amount - euro_part) * 100))
    amount_str = f"{euro_part:06d}{cent_part:02d}"
    
    # 4. Reserved (3 chars, always 000)
    reserved = "000"
    
    # 5. Reference (20 digits, right aligned, padded with 0)
    clean_ref = reference.replace(" ", "").replace("-", "")
    ref_str = clean_ref.zfill(20)
    
    # 6. Due Date (6 digits YYMMDD)
    if due_date:
        date_str = due_date.strftime("%y%m%d")
    else:
        date_str = "000000"
    
    barcode = f"{version}{iban_body}{amount_str}{reserved}{ref_str}{date_str}"
    return barcode
