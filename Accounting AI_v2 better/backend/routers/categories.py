from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlmodel import Session, select
from typing import List, Optional

from database import get_session
from models import AccountCategory, AccountType
from services.chart_parser import parse_chart_of_accounts
from auth import get_current_user
from security_utils import verify_company_access
from schemas import AccountCategoryCreate, AccountCategoryUpdate

router = APIRouter(
    prefix="/companies/{company_id}/categories",
    tags=["Account Categories"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

SUPPORTED_EXTENSIONS = {'.csv', '.pdf', '.tkt', '.txt'}
SUPPORTED_MIMETYPES = {
    'text/csv', 'application/vnd.ms-excel',   # CSV
    'application/pdf',                          # PDF
    'text/plain', 'application/octet-stream',   # TKT / TXT
}

@router.get("/", response_model=List[AccountCategory])
def get_account_categories(company_id: int, session: Session = Depends(get_session)):
    return session.exec(select(AccountCategory).order_by(AccountCategory.code)).all()


@router.post("/", status_code=status.HTTP_201_CREATED, response_model=AccountCategory)
def create_category(
    company_id: int,
    data: AccountCategoryCreate,
    session: Session = Depends(get_session),
):
    """Luo uusi tilikartta-tili."""
    existing = session.exec(select(AccountCategory).where(AccountCategory.code == data.code)).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Tili '{data.code}' on jo olemassa.")

    cat = AccountCategory(
        code=data.code,
        name=data.name,
        type=data.type,
        normal_balance=data.normal_balance,
        vat_percentage=data.vat_percentage,
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


@router.patch("/{category_id}", response_model=AccountCategory)
def update_category(
    company_id: int,
    category_id: int,
    data: AccountCategoryUpdate,
    session: Session = Depends(get_session),
):
    """Päivitä tilikartta-tilin tiedot (nimi, tyyppi, ALV-%)."""
    cat = session.get(AccountCategory, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Tiliä ei löydy.")

    if data.name is not None:
        cat.name = data.name
    if data.type is not None:
        cat.type = data.type
    if data.normal_balance is not None:
        cat.normal_balance = data.normal_balance
    if data.vat_percentage is not None:
        cat.vat_percentage = data.vat_percentage
    if data.vat_percentage == 0:
        cat.vat_percentage = None  # 0 → ALV-vapaa

    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


@router.post("/upload", status_code=status.HTTP_201_CREATED)
def upload_chart_of_accounts(
    company_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    """Upload a chart of accounts file.
    
    Supported formats:
    - CSV: columns code, name, type (handles Finnish headers too)
    - PDF: AI-extracted using Gemini (any Finnish tilikartta PDF)
    - TKT: Finnish accounting software export format
    """
    filename = file.filename or "unknown.csv"
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    
    if f'.{ext}' not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported format: .{ext}. Supported: CSV, PDF, TKT"
        )
    
    file_bytes = file.file.read()
    
    try:
        accounts = parse_chart_of_accounts(file_bytes, filename)
    except Exception as e:
        print(f"Error parsing chart: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    
    if not accounts:
        raise HTTPException(status_code=400, detail="No accounts found in file. Check the format.")
    
    # Upsert: skip existing codes, add or update
    added = 0
    updated = 0
    for acc in accounts:
        code = str(acc.get('code', '')).strip()
        name = str(acc.get('name', '')).strip()
        acct_type = str(acc.get('type', 'Expense')).strip()
        nb = str(acc.get('normal_balance', 'DEBIT')).strip()
        vat = acc.get('vat_percentage', None)

        if not code or not name:
            continue
        if acct_type not in ('Revenue', 'Expense', 'Asset', 'Liability'):
            acct_type = 'Expense'
        if nb not in ('DEBIT', 'CREDIT'):
            # Auto-assign based on type
            nb = 'CREDIT' if acct_type in ('Revenue', 'Liability') else 'DEBIT'
        
        existing = session.exec(
            select(AccountCategory).where(AccountCategory.code == code)
        ).first()
        
        if existing:
            if existing.name != name or existing.type != acct_type:
                existing.name = name
                existing.type = acct_type
                existing.normal_balance = nb
                if vat is not None:
                    existing.vat_percentage = float(vat)
                session.add(existing)
                updated += 1
            continue
        
        category = AccountCategory(
            code=code,
            name=name,
            type=acct_type,
            normal_balance=nb,
            vat_percentage=float(vat) if vat is not None else None,
        )
        session.add(category)
        added += 1
    
    session.commit()
    
    return {
        "status": "uploaded",
        "format": ext.upper(),
        "total_parsed": len(accounts),
        "added": added,
        "updated": updated,
    }


@router.post("/template", status_code=status.HTTP_201_CREATED)
def apply_template(company_id: int, session: Session = Depends(get_session)):
    """Palauta standardi suomalainen TALO-2024 tilikartta."""
    from seed import seed_db  # Import-vapaa: seed_db() on idempotent
    
    # Inline the standard accounts to avoid import coupling with seed module
    STANDARD_ACCOUNTS = [
        # (code, name, type, normal_balance)
        ("1910", "Pankkitili (Hoitotili)", AccountType.ASSET, "DEBIT"),
        ("1780", "ALV-saatava (Ostojen ALV)", AccountType.ASSET, "DEBIT"),
        ("2700", "ALV-velka (Myynnin ALV)", AccountType.LIABILITY, "CREDIT"),
        ("3000", "Hoitovastikkeet", AccountType.REVENUE, "CREDIT"),
        ("3100", "Vuokrat (Huoneistot)", AccountType.REVENUE, "CREDIT"),
        ("4000", "Palkat ja palkkiot", AccountType.EXPENSE, "DEBIT"),
        ("4110", "Isännöintipalkkiot", AccountType.EXPENSE, "DEBIT"),
        ("4500", "Lämmitys (Kaukolämpö)", AccountType.EXPENSE, "DEBIT"),
        ("4600", "Vesi ja jätevesi", AccountType.EXPENSE, "DEBIT"),
        ("4700", "Sähkö ja kaasu", AccountType.EXPENSE, "DEBIT"),
        ("4900", "Vahinkovakuutukset", AccountType.EXPENSE, "DEBIT"),
        ("5100", "Kiinteistövero", AccountType.EXPENSE, "DEBIT"),
        ("5200", "Vuosikorjaukset (Yleiset)", AccountType.EXPENSE, "DEBIT"),
    ]
    
    added = 0
    for code, name, acct_type, nb in STANDARD_ACCOUNTS:
        existing = session.exec(
            select(AccountCategory).where(AccountCategory.code == code)
        ).first()
        
        if existing:
            existing.normal_balance = nb
            session.add(existing)
            continue
            
        category = AccountCategory(code=code, name=name, type=acct_type, normal_balance=nb)
        session.add(category)
        added += 1
    
    session.commit()
    return {"status": "success", "added": added}
