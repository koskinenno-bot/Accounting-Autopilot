from datetime import datetime, timezone, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import LockedPeriod, HousingCompany, TransactionAudit, Transaction, FinancialNote, ActivityReport
from schemas import ActivityReportRead, ActivityReportCreate

from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/compliance",
    tags=["Compliance"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/locked-periods", response_model=List[LockedPeriod])
def get_locked_periods(company_id: int, session: Session = Depends(get_session)):
    return session.exec(select(LockedPeriod).where(LockedPeriod.company_id == company_id)).all()

@router.post("/lock-period")
def lock_period(
    company_id: int,
    year: int,
    month: int,
    current_user = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    KPL 3:3 § — Lukitsee kirjanpitokauden. Lukittua kautta ei voi enää muokata.
    Tallentaa lukitsijan käyttäjän sähköpostin audit-traceability vaatimuksen mukaisesti.
    """
    # Check if already locked
    existing = session.exec(select(LockedPeriod).where(
        LockedPeriod.company_id == company_id,
        LockedPeriod.year == year,
        LockedPeriod.month == month
    )).first()

    if existing:
        return {"status": "already_locked", "message": "Kausi on jo lukittu."}

    locked_by = getattr(current_user, "email", str(getattr(current_user, "id", "system")))

    lp = LockedPeriod(
        company_id=company_id,
        year=year,
        month=month,
        locked_by=locked_by,  # KPL 2:8 § — tallenna kuka lukitsi
    )
    session.add(lp)
    session.commit()
    session.refresh(lp)

    return {
        "status": "success",
        "message": f"Kausi {month}/{year} on nyt lukittu.",
        "locked_by": locked_by,
        "legal_basis": "KPL 3:3 §"
    }

@router.delete("/unlock-period")
def unlock_period(
    company_id: int, 
    year: int, 
    month: int, 
    session: Session = Depends(get_session)
):
    # In a real app, only high-level admins can do this
    existing = session.exec(select(LockedPeriod).where(
        LockedPeriod.company_id == company_id,
        LockedPeriod.year == year,
        LockedPeriod.month == month
    )).first()
    
    if not existing:
        raise HTTPException(status_code=404, detail="Kautta ei ole lukittu.")
        
    session.delete(existing)
    session.commit()
    
    return {"status": "success", "message": f"Kausi {month}/{year} on avattu muokkauksille."}


# ── Activity Report (Toimintakertomus) ───────────────────────────────────────
from models import ActivityReport
from schemas import ActivityReportRead, ActivityReportCreate

@router.get("/activity-report/{year}", response_model=Optional[ActivityReportRead])
def get_activity_report(company_id: int, year: int, session: Session = Depends(get_session)):
    return session.exec(select(ActivityReport).where(
        ActivityReport.company_id == company_id,
        ActivityReport.year == year
    )).first()

@router.post("/activity-report", response_model=ActivityReportRead)
def save_activity_report(
    company_id: int, 
    report_in: ActivityReportCreate, 
    session: Session = Depends(get_session)
):
    existing = session.exec(select(ActivityReport).where(
        ActivityReport.company_id == company_id,
        ActivityReport.year == report_in.year
    )).first()
    
    if existing:
        existing.content_json = report_in.content_json
        existing.updated_at = datetime.now(timezone.utc)
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing
    
    new_report = ActivityReport(
        company_id=company_id,
        year=report_in.year,
        content_json=report_in.content_json
    )
    session.add(new_report)
    session.commit()
    session.refresh(new_report)
    return new_report

# ── Financial Statement Notes (PMA 1753/2015) ─────────────────────────────────
from models import FinancialNote
from pydantic import BaseModel

class FinancialNoteUpdate(BaseModel):
    note_type: str
    content: str

@router.get("/financial-notes/{year}", response_model=List[FinancialNote])
def get_financial_notes(company_id: int, year: int, session: Session = Depends(get_session)):
    return session.exec(select(FinancialNote).where(
        FinancialNote.company_id == company_id,
        FinancialNote.year == year
    )).all()

@router.post("/financial-notes")
def save_financial_note(
    company_id: int,
    year: int,
    note_in: FinancialNoteUpdate,
    session: Session = Depends(get_session)
):
    existing = session.exec(select(FinancialNote).where(
        FinancialNote.company_id == company_id,
        FinancialNote.year == year,
        FinancialNote.note_type == note_in.note_type
    )).first()
    
    if existing:
        existing.content = note_in.content
        existing.updated_at = datetime.now(timezone.utc)
        session.add(existing)
    else:
        new_note = FinancialNote(
            company_id=company_id,
            year=year,
            note_type=note_in.note_type,
            content=note_in.content
        )
        session.add(new_note)
        
    session.commit()
    return {"status": "success"}

@router.get("/export-archive/{year}")
def export_archive(company_id: int, year: int, session: Session = Depends(get_session)):
    # 1. Get Company details
    company = session.get(HousingCompany, company_id)
    
    # 2. Get all Transactions for the year
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)
    txs = session.exec(select(Transaction).where(
        Transaction.company_id == company_id,
        Transaction.date >= start_date,
        Transaction.date <= end_date
    )).all()
    
    # 3. Get Audit Logs
    audit_logs = []
    for tx in txs:
        logs = session.exec(select(TransactionAudit).where(TransactionAudit.transaction_id == tx.id)).all()
        if logs:
            audit_logs.extend(logs)
            
    # 4. Get Financial Notes
    notes = session.exec(select(FinancialNote).where(
        FinancialNote.company_id == company_id,
        FinancialNote.year == year
    )).all()
    
    # 5. Get Activity Report
    activity = session.exec(select(ActivityReport).where(
        ActivityReport.company_id == company_id,
        ActivityReport.year == year
    )).first()

    archive_data = {
        "export_metadata": {
            "version": "TALO-2024-COMPLIANCE",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "year": year
        },
        "company": company.dict() if company else {},
        "transactions": [tx.dict() for tx in txs],
        "audit_logs": [log.dict() for log in audit_logs],
        "financial_notes": [note.dict() for note in notes],
        "activity_report": activity.dict() if activity else None
    }
    
    return archive_data

@router.get("/transactions/{transaction_id}/audit-log", response_model=List[TransactionAudit])
def get_transaction_audit_log(
    transaction_id: int, 
    session: Session = Depends(get_session)
):
    return session.exec(select(TransactionAudit).where(
        TransactionAudit.transaction_id == transaction_id
    ).order_by(TransactionAudit.changed_at.desc())).all()

from services.closing_service import generate_opening_balances, close_fiscal_year
from services.compliance_checks import (
    compute_trial_balance,
    analyze_voucher_gaps,
    check_unverified_transactions,
)

@router.post("/generate-opening-balances/{year}")
def generate_year_opening_balances(year: int, company_id: int, session: Session = Depends(get_session)):
    """
    Automatisoi KPL:n 'Tiliinotto' (Opening entries).
    Ottaa joulukuun 31. päivän saldot edelliseltä vuodelta ja luo tammikuun 1. viennit.
    """
    return generate_opening_balances(company_id, year, session)


@router.post("/close-fiscal-year/{year}")
def close_year(year: int, company_id: int, session: Session = Depends(get_session)):
    """
    KPL 3:6 § — Tilikauden päätöskirjaus.
    Siirtää tilikauden tuloksen tilille 2070. Aja ennen avauskirjauksia.
    """
    return close_fiscal_year(company_id, year, session)


@router.get("/trial-balance/{year}")
def get_trial_balance(year: int, company_id: int, session: Session = Depends(get_session)):
    """
    KPL 2:1 § — Täsmäytyslaskelma (Trial Balance).
    Tarkistaa että ∑DEBET = ∑KREDIT jokaiselle tilikaudelle.
    Big 4 tilintarkastaja ajaa tämän ensimmäisenä.
    """
    return compute_trial_balance(company_id, year, session)


@router.get("/gap-analysis/{year}")
def get_gap_analysis(year: int, company_id: int, session: Session = Depends(get_session)):
    """
    KPL 2:2 § — Tositeaukkoanalyysi.
    Etsii puuttuvat tositenumerot ketjusta YYYY/NNN.
    Aukko tositeketjussa on tilintarkastuksellinen punainen lippu.
    """
    return analyze_voucher_gaps(company_id, year, session)


@router.get("/audit-summary/{year}")
def get_audit_summary(year: int, company_id: int, session: Session = Depends(get_session)):
    """
    Yhteenveto kaikista compliance-tarkistuksista yhdelle tilikaudelle.
    Käytetään tilintarkastuksen valmistautumisessa.
    """
    trial = compute_trial_balance(company_id, year, session)
    gaps = analyze_voucher_gaps(company_id, year, session)
    unverified = check_unverified_transactions(company_id, year, session)

    # Locked periods for this year
    locks = session.exec(
        select(LockedPeriod).where(
            LockedPeriod.company_id == company_id,
            LockedPeriod.year == year,
        )
    ).all()

    all_months_locked = len(locks) == 12
    score = 100
    issues = []

    if not trial["is_balanced"]:
        score -= 40
        issues.append(f"KRIITTINEN: Kirjanpito ei täsmää — ero {trial['difference']:.2f} € (KPL 2:1 §)")
    if gaps["gap_count"] > 0:
        score -= min(30, gaps["gap_count"] * 5)
        issues.append(f"HUOMIO: {gaps['gap_count']} aukkoa tositeketjussa (KPL 2:2 §)")
    if unverified["unverified"] > 0:
        score -= min(20, unverified["unverified"])
        issues.append(f"HUOMIO: {unverified['unverified']} vahvistamatonta tapahtumaa")
    if not all_months_locked:
        score -= 10
        issues.append(f"HUOMIO: Vain {len(locks)}/12 kuukautta lukittu")

    return {
        "year": year,
        "audit_score": max(0, score),
        "audit_grade": "A" if score >= 95 else "B" if score >= 80 else "C" if score >= 60 else "D",
        "is_big4_ready": score >= 90 and trial["is_balanced"] and gaps["gap_count"] == 0,
        "issues": issues,
        "locked_months": len(locks),
        "trial_balance": trial,
        "gap_analysis": gaps,
        "unverified_check": unverified,
    }
