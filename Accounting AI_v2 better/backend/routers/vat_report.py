"""
ALV-raportti (routers/vat_report.py)
Vain ALV-rekisteröidyille yhtiöille.

Laskee:
- ALV-saatavat (ostojen ALV, tili 1780) per kausi
- ALV-velat (myynnin ALV, tili 2700) per kausi
- Netto-ALV (maksettava / palautettava)
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import JournalLine, Transaction, HousingCompany
from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/compliance/vat",
    tags=["ALV"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

VAT_RECEIVABLE_CODE = "1780"  # ALV-saatava (ostojen ALV)
VAT_PAYABLE_CODE = "2700"     # ALV-velka (myynnin ALV)


@router.get("/{year}")
def get_vat_report(
    company_id: int,
    year: int,
    quarter: Optional[int] = None,  # 1-4, tai None = koko vuosi
    session: Session = Depends(get_session),
):
    """
    ALV-raportti tietokaudelle.
    Vaatii: yhtiö.is_vat_registered == True
    """
    company = session.get(HousingCompany, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Yhtiötä ei löydy")

    if not company.is_vat_registered:
        raise HTTPException(
            status_code=400,
            detail="Yhtiö ei ole ALV-rekisteröity. ALV-raportti ei ole käytettävissä."
        )

    # Determine date range
    if quarter:
        if quarter not in (1, 2, 3, 4):
            raise HTTPException(status_code=400, detail="Vuosineljännes tulee olla 1–4")
        q_start_month = (quarter - 1) * 3 + 1
        q_end_month = q_start_month + 2
        start_date = date(year, q_start_month, 1)
        import calendar
        end_date = date(year, q_end_month, calendar.monthrange(year, q_end_month)[1])
        period_label = f"Q{quarter}/{year}"
    else:
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
        period_label = str(year)

    # Get verified transactions in period
    txs = session.exec(
        select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.date >= start_date,
            Transaction.date <= end_date,
            Transaction.is_verified == True,
        )
    ).all()
    tx_ids = [t.id for t in txs]

    if not tx_ids:
        return {
            "company_name": company.name,
            "period": period_label,
            "vat_receivable": 0.0,
            "vat_payable": 0.0,
            "net_vat": 0.0,
            "status": "Ei tapahtumia valitulle kaudelle.",
        }

    # Sum VAT amounts from JournalLines
    vat_lines = session.exec(
        select(JournalLine).where(
            JournalLine.transaction_id.in_(tx_ids),
            JournalLine.account_code.in_([VAT_RECEIVABLE_CODE, VAT_PAYABLE_CODE]),
        )
    ).all()

    vat_receivable = sum(l.amount for l in vat_lines if l.account_code == VAT_RECEIVABLE_CODE and l.side == "DEBIT")
    vat_payable = sum(l.amount for l in vat_lines if l.account_code == VAT_PAYABLE_CODE and l.side == "CREDIT")
    net_vat = vat_payable - vat_receivable  # positive = maksetaan Verohallinnolle

    # Detailed breakdown per transaction
    detail = []
    for tx in txs:
        tx_vat = [l for l in vat_lines if l.transaction_id == tx.id]
        if tx_vat:
            detail.append({
                "date": tx.date.isoformat(),
                "voucher_number": tx.voucher_number,
                "description": tx.description,
                "vat_receivable": round(sum(l.amount for l in tx_vat if l.account_code == VAT_RECEIVABLE_CODE), 2),
                "vat_payable": round(sum(l.amount for l in tx_vat if l.account_code == VAT_PAYABLE_CODE), 2),
            })

    return {
        "company_name": company.name,
        "business_id": company.business_id,
        "period": period_label,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "vat_receivable": round(vat_receivable, 2),
        "vat_payable": round(vat_payable, 2),
        "net_vat": round(net_vat, 2),
        "net_vat_label": "Maksettava ALV" if net_vat >= 0 else "Palautettava ALV",
        "transactions": detail,
    }


@router.patch("/register")
def toggle_vat_registration(
    company_id: int,
    is_registered: bool,
    session: Session = Depends(get_session),
):
    """Päivittää yhtiön ALV-rekisteröinnin tilan."""
    company = session.get(HousingCompany, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Yhtiötä ei löydy")
    company.is_vat_registered = is_registered
    session.add(company)
    session.commit()
    return {
        "status": "success",
        "is_vat_registered": company.is_vat_registered,
        "message": f"ALV-rekisteröinti {'aktivoitu' if is_registered else 'poistettu käytöstä'}."
    }
