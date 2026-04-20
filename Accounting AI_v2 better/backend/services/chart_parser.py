import os
import json
import csv
import io
from typing import List, Dict, Any

from google import genai
from google.genai import types


def parse_chart_of_accounts(file_bytes: bytes, filename: str) -> List[Dict[str, Any]]:
    """
    Parse a chart of accounts from CSV, PDF, or TKT format.
    Returns a list of dicts with keys: code, name, type.
    """
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    
    if ext == 'csv':
        return _parse_csv(file_bytes)
    elif ext == 'pdf':
        return _parse_with_ai(file_bytes, mime_type="application/pdf")
    elif ext == 'tkt':
        return _parse_tkt(file_bytes)
    elif ext == 'txt':
        # Some TKT exports come as .txt
        return _parse_tkt(file_bytes)
    else:
        raise ValueError(f"Unsupported file format: .{ext}. Supported: CSV, PDF, TKT")


def _parse_csv(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse a standard CSV with columns: code, name, type."""
    content = file_bytes.decode("utf-8-sig")  # utf-8-sig handles BOM
    reader = csv.DictReader(io.StringIO(content), delimiter=_detect_delimiter(content))
    
    # Normalize column names (handle Finnish headers too)
    results = []
    for row in reader:
        # Try to find the right columns
        code = _find_column(row, ['code', 'koodi', 'tili', 'tilinumero', 'nro', 'numero'])
        name = _find_column(row, ['name', 'nimi', 'tilin nimi', 'selite', 'kuvaus'])
        acct_type = _find_column(row, ['type', 'tyyppi', 'laji', 'tililaji'])
        
        if not code or not name:
            continue
            
        # Map Finnish type names to our enum
        mapped_type = _map_account_type(acct_type or '')
        
        results.append({
            'code': code.strip(),
            'name': name.strip(),
            'type': mapped_type,
        })
    
    return results


def _parse_tkt(file_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Parse a TKT (Tilikartta) file.
    
    TKT files come in several variants:
    - Fivaldi (FIVALDITK2.11): Complex semicolon-separated with account codes embedded
    - Tikon/Lemonsoft: Simpler semicolon or tab-separated
    - Simple text: "code name" per line
    
    For complex Fivaldi formats, we extract what we can and fall back to AI.
    """
    # Try multiple encodings
    for encoding in ['utf-8-sig', 'latin-1', 'cp1252', 'iso-8859-1']:
        try:
            content = file_bytes.decode(encoding)
            break
        except (UnicodeDecodeError, ValueError):
            continue
    else:
        content = file_bytes.decode('latin-1', errors='replace')
    
    lines = content.strip().split('\n')
    
    # Detect Fivaldi format
    if lines and 'FIVALDITK' in lines[0]:
        # Fivaldi TKT is too complex for simple parsing — use AI
        print(f"Detected Fivaldi TKT format ({len(lines)} lines). Using AI extraction...")
        return _parse_with_ai(file_bytes, mime_type="text/plain")
    
    # Try simple parsing for non-Fivaldi TKTs
    results = []
    import re
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#') or line.startswith('//'):
            continue
        
        # Semicolon-separated: code;name;type
        if ';' in line:
            parts = line.split(';')
            if len(parts) >= 2 and re.match(r'^\d{3,5}$', parts[0].strip()):
                code = parts[0].strip()
                name = parts[1].strip()
                acct_type = _map_account_type(parts[2].strip() if len(parts) > 2 else '')
                if not acct_type:
                    acct_type = _infer_type_from_code(code)
                results.append({'code': code, 'name': name, 'type': acct_type})
                continue
        
        # Tab-separated
        if '\t' in line:
            parts = line.split('\t')
            if len(parts) >= 2 and re.match(r'^\d{3,5}$', parts[0].strip()):
                code = parts[0].strip()
                name = parts[1].strip()
                acct_type = _map_account_type(parts[2].strip() if len(parts) > 2 else '')
                if not acct_type:
                    acct_type = _infer_type_from_code(code)
                results.append({'code': code, 'name': name, 'type': acct_type})
                continue
        
        # Fixed-width: "1000 Aineettomat hyödykkeet"
        match = re.match(r'^(\d{3,5})\s+(.+)$', line)
        if match:
            code = match.group(1).strip()
            name = match.group(2).strip()
            results.append({
                'code': code,
                'name': name,
                'type': _infer_type_from_code(code),
            })
    
    # If simple parsing found nothing useful, fall back to AI
    if len(results) < 3:
        print(f"Simple TKT parsing found only {len(results)} accounts. Falling back to AI...")
        return _parse_with_ai(file_bytes, mime_type="text/plain")
    
    return results



def _parse_with_ai(file_bytes: bytes, mime_type: str) -> List[Dict[str, Any]]:
    """Use Gemini AI to extract chart of accounts from PDF or unstructured text."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY required for PDF/TKT parsing")

    client = genai.Client(api_key=api_key)

    prompt = """
    You are a Finnish accounting expert. I am providing you with a chart of accounts 
    (tilikartta) document. 

    Extract EVERY account into a JSON array. Each object must have exactly:
    - "code": The account number/code as a string (e.g. "3000", "4110")
    - "name": The account name in Finnish (e.g. "Hoitovastikkeet", "Isännöintipalkkiot")
    - "type": One of EXACTLY these values: "Revenue", "Expense", "Asset", "Liability"

    Rules for type classification:
    - Codes 1000-1999: "Asset" (Vastaavaa / Pysyvät & Vaihtuvat vastaavat)
    - Codes 2000-2999: "Liability" (Vastattavaa / Oma pääoma & Vieras pääoma)
    - Codes 3000-3999: "Revenue" (Tuotot / Hoitotuotot & Rahoitustuotot)
    - Codes 4000-9999: "Expense" (Kulut / Hoitokulut & Rahoituskulut)

    Output ONLY the raw JSON array. No markdown, no explanation.
    """

    file_part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)

    import time
    models_to_try = ['gemini-3-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite']
    last_err = None
    
    for model_name in models_to_try:
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[file_part, prompt],
                    config=types.GenerateContentConfig(temperature=0.0)
                )
                text = response.text.strip()
                if text:
                    # Success
                    break
            except Exception as e:
                last_err = e
                if "503" in str(e) or "429" in str(e):
                    print(f"Gemini {model_name} busy (attempt {attempt+1}/3), waiting...")
                    time.sleep(2 * (attempt + 1))
                    continue
                else:
                    break
        else:
            # All 3 attempts failed for this model, try next model
            continue
        
        # If we broke out of the attempt loop (success), break the model loop
        break
    else:
        # All models failed
        raise last_err or ValueError("AI models are currently unavailable.")
    
    # Strip markdown wrappers
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        accounts = json.loads(text)
        # Validate each entry
        valid = []
        for acc in accounts:
            if 'code' in acc and 'name' in acc:
                acc['type'] = acc.get('type', _infer_type_from_code(acc['code']))
                # Validate type
                if acc['type'] not in ('Revenue', 'Expense', 'Asset', 'Liability'):
                    acc['type'] = _infer_type_from_code(acc['code'])
                valid.append(acc)
        return valid
    except json.JSONDecodeError:
        raise ValueError("AI failed to extract chart of accounts. Please try CSV format.")


# ── Helper functions ──────────────────────────────────────────────────────────

def _detect_delimiter(content: str) -> str:
    """Detect CSV delimiter (comma, semicolon, or tab)."""
    first_line = content.split('\n')[0]
    if ';' in first_line:
        return ';'
    elif '\t' in first_line:
        return '\t'
    return ','


def _find_column(row: dict, candidates: list) -> str | None:
    """Find a column value by trying multiple possible header names."""
    for key in row:
        if key.lower().strip() in candidates:
            return row[key]
    return None


def _map_account_type(raw: str) -> str:
    """Map Finnish/English account type strings to our standard enum."""
    raw_lower = raw.lower().strip()
    
    mapping = {
        # English
        'revenue': 'Revenue', 'income': 'Revenue', 'tuotto': 'Revenue',
        'expense': 'Expense', 'cost': 'Expense', 'kulu': 'Expense',
        'asset': 'Asset', 'vastaava': 'Asset', 'omaisuus': 'Asset',
        'liability': 'Liability', 'vastattava': 'Liability', 'velka': 'Liability',
        # Finnish abbreviations
        'tu': 'Revenue', 'ku': 'Expense', 'va': 'Asset', 'vt': 'Liability',
        'tulos': 'Revenue', 'tase': 'Asset',
    }
    
    for key, value in mapping.items():
        if key in raw_lower:
            return value
    
    return ''


def _infer_type_from_code(code: str) -> str:
    """Infer account type from Finnish standard code ranges."""
    try:
        num = int(code[:1])  # First digit
        if num == 1:
            return 'Asset'
        elif num == 2:
            return 'Liability'
        elif num == 3:
            return 'Revenue'
        else:  # 4-9
            return 'Expense'
    except (ValueError, IndexError):
        return 'Expense'  # Safe default
