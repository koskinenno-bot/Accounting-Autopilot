
def generate_virtuaaliviivakoodi_v4(iban: str, amount: float, reference: str, due_date: str = "000000"):
    """
    Generates a 54-character Finnish Virtual Barcode (version 4).
    iban: FI...
    amount: float
    reference: string (numeric)
    due_date: YYMMDD
    """
    # 1. Version
    version = "4"
    
    # 2. IBAN (16 digits from the body, skip FIxx)
    # Finnish IBAN: FI 12 345678 12345678 -> 18 chars total
    clean_iban = iban.replace(" ", "").replace("-", "")
    iban_body = clean_iban[4:].zfill(16)
    
    # 3. Amount (8 digits: 6 euro, 2 cents)
    euro_part = int(amount)
    cent_part = int(round((amount - euro_part) * 100))
    amount_str = f"{euro_part:06d}{cent_part:02d}"
    
    # 4. Reserved (3 chars, always 000)
    reserved = "000"
    
    # 5. Reference (20 digits, right aligned, padded with 0)
    # Note: Finnish reference numbers are numeric.
    clean_ref = reference.replace(" ", "").replace("-", "")
    ref_str = clean_ref.zfill(20)
    
    # 6. Due Date (6 digits YYMMDD)
    date_str = due_date.zfill(6)
    
    barcode = f"{version}{iban_body}{amount_str}{reserved}{ref_str}{date_str}"
    return barcode

# Test
test_iban = "FI12 3456 7812 3456 78"
test_amt = 125.50
test_ref = "1234561"
test_date = "241231"

code = generate_virtuaaliviivakoodi_v4(test_iban, test_amt, test_ref, test_date)
print(f"Barcode: {code}")
print(f"Length:  {len(code)}")
