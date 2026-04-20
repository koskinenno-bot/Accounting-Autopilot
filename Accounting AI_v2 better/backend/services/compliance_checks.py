"""
KPL-yhteensopivuustarkistukset — Big 4 tilintarkastusvalmiuteen.

Sisältää:
  - Trial balance (debet = kredit -täsmäytys)
  - Voucher gap analysis (tositeketjun aukkojen tunnistus)
  - Period lock enforcement helper
"""
from datetime import date
from typing import Optional
from fastapi import HTTPException
from sqlmodel import Session, select, func

from models import JournalLine, Transaction, LockedPeriod


# ── Period Lock Enforcement ────────────────────────────────────────────────────

def check_period_not_locked(
    company_id: int,
    tx_date: date,
    session: Session,
    operation: str = "muokata"
) -> None:
    """
    KPL 2:8 § — Tarkistaa, onko tapahtuman kirjauspäivä lukitulla kaudella.
    Heittää HTTPException 423 jos kausi on lukittu.
    
    Args:
        company_id: Yhtiön ID
        tx_date: Tapahtuman päivämäärä
        session: Tietokantasessio
        operation: Kuvaus operaatiosta virheilmoitukseen ("muokata", "poistaa", jne.)
    """
    locked = session.exec(
        select(LockedPeriod).where(
            LockedPeriod.company_id == company_id,
            LockedPeriod.year == tx_date.year,
            LockedPeriod.month == tx_date.month,
        )
    ).first()

    if locked:
        raise HTTPException(
            status_code=423,  # 423 Locked
            detail=(
                f"KPL 2:8 § ESTO: Kausi {tx_date.month}/{tx_date.year} on lukittu "
                f"({locked.locked_at.strftime('%d.%m.%Y')}). "
                f"Tapahtumaa ei voi {operation} lukitulla kaudella. "
                f"Ota yhteyttä kirjanpitäjään kauden avaamiseksi."
            )
        )


# ── Trial Balance (Täsmäytys) ──────────────────────────────────────────────────

def compute_trial_balance(company_id: int, year: int, session: Session) -> dict:
    """
    KPL 2:1 § — Laskee debet- ja kreditsummien täsmäytyksen.
    Palauttaa myös tilikohtaisen erittelyn.
    
    Big 4 tilintarkastaja tarkistaa: ∑DEBET = ∑KREDIT.
    Mikä tahansa poikkeama on kirjanpidollinen virhe.
    """
    start = date(year, 1, 1)
    end = date(year, 12, 31)

    # Kaikki journal-rivit tälle tilikaudelle
    jlines = session.exec(
        select(JournalLine)
        .join(Transaction, JournalLine.transaction_id == Transaction.id)
        .where(
            Transaction.company_id == company_id,
            Transaction.date >= start,
            Transaction.date <= end,
        )
    ).all()

    total_debit = 0.0
    total_credit = 0.0
    accounts: dict = {}

    for jl in jlines:
        code = jl.account_code
        name = jl.account_name
        if code not in accounts:
            accounts[code] = {"code": code, "name": name, "debit": 0.0, "credit": 0.0, "balance": 0.0}
        
        if jl.side == "DEBIT":
            total_debit += jl.amount
            accounts[code]["debit"] += jl.amount
            accounts[code]["balance"] += jl.amount
        else:
            total_credit += jl.amount
            accounts[code]["credit"] += jl.amount
            accounts[code]["balance"] -= jl.amount

    total_debit = round(total_debit, 2)
    total_credit = round(total_credit, 2)
    difference = round(total_debit - total_credit, 2)
    is_balanced = abs(difference) < 0.02  # Sallitaan 1 sentin pyöristysero

    return {
        "year": year,
        "total_debit": total_debit,
        "total_credit": total_credit,
        "difference": difference,
        "is_balanced": is_balanced,
        "status": "TASAPAINOSSA ✅" if is_balanced else f"EPÄTASAPAINO ❌ — ero: {difference:.2f} €",
        "legal_basis": "KPL 2:1 §",
        "accounts": sorted(accounts.values(), key=lambda x: x["code"]),
        "entry_count": len(jlines),
    }


# ── Voucher Gap Analysis (Tositeaukot) ─────────────────────────────────────────

def analyze_voucher_gaps(company_id: int, year: int, session: Session) -> dict:
    """
    KPL 2:2 § — Tarkistaa tositetunnisteiden ketjun eheyden.
    Etsii puuttuvat numerot sarjasta YYYY/NNN.
    
    Big 4 tilintarkastaja tarkistaa aina, onko tositeketjussa aukkoja.
    Aukko voi viitata poistettuun tai piilotettuun kirjaukseen.
    """
    txs = session.exec(
        select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.is_verified == True,
            Transaction.voucher_number != None,
            Transaction.date >= date(year, 1, 1),
            Transaction.date <= date(year, 12, 31),
        ).order_by(Transaction.voucher_number)
    ).all()

    # Parse voucher numbers: YYYY/NNN → integer NNN
    numbers = []
    malformed = []
    for tx in txs:
        if not tx.voucher_number:
            continue
        parts = tx.voucher_number.split("/")
        if len(parts) == 2 and parts[1].isdigit():
            numbers.append(int(parts[1]))
        else:
            malformed.append(tx.voucher_number)

    numbers = sorted(set(numbers))
    gaps = []
    if numbers:
        expected = set(range(numbers[0], numbers[-1] + 1))
        missing = sorted(expected - set(numbers))
        gaps = [f"{year}/{str(n).zfill(3)}" for n in missing]

    return {
        "year": year,
        "voucher_count": len(numbers),
        "first_voucher": f"{year}/{str(numbers[0]).zfill(3)}" if numbers else None,
        "last_voucher": f"{year}/{str(numbers[-1]).zfill(3)}" if numbers else None,
        "gaps": gaps,
        "gap_count": len(gaps),
        "malformed_vouchers": malformed,
        "status": "KETJUSSA EI AUKKOJA ✅" if not gaps else f"HUOMIO: {len(gaps)} aukkoa tositeketjussa ⚠️",
        "legal_basis": "KPL 2:2 §",
    }


# ── Unverified Transactions Check ─────────────────────────────────────────────

def check_unverified_transactions(company_id: int, year: int, session: Session) -> dict:
    """
    Tarkistaa, onko tilikaudella vahvistamattomia tapahtumia.
    Tilinpäätöksessä kaikki tapahtumat tulee olla vahvistettuja.
    """
    total_count = session.exec(
        select(func.count(Transaction.id)).where(
            Transaction.company_id == company_id,
            Transaction.date >= date(year, 1, 1),
            Transaction.date <= date(year, 12, 31),
        )
    ).one()

    unverified_count = session.exec(
        select(func.count(Transaction.id)).where(
            Transaction.company_id == company_id,
            Transaction.is_verified == False,
            Transaction.date >= date(year, 1, 1),
            Transaction.date <= date(year, 12, 31),
        )
    ).one()

    return {
        "year": year,
        "total_transactions": total_count,
        "verified": total_count - unverified_count,
        "unverified": unverified_count,
        "status": "KAIKKI VAHVISTETTU ✅" if unverified_count == 0 else f"HUOMIO: {unverified_count} vahvistamatonta tapahtumaa ⚠️",
    }
