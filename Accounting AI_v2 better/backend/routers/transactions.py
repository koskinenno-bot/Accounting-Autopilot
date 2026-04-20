import shutil
import uuid
import json
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone, date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status, BackgroundTasks
from sqlmodel import Session, select, delete

from auth import get_current_user
from database import get_session
from models import Transaction, User, ImportJob, MatchType, MatchingRule
from schemas import ImportResult, TransactionRead, TransactionUpdate, ImportJobRead, ReceiptExtractionResult
from services import csv_parser, reconciliation_service, pdf_service, receipt_service

from security_utils import verify_company_access
from models import Transaction, User, ImportJob, MatchType, MatchingRule, HousingCompany

router = APIRouter(
    prefix="/companies/{company_id}/transactions",
    tags=["Transactions"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/", response_model=List[TransactionRead])
def get_transactions(
    company_id: int, 
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    session: Session = Depends(get_session)
):
    query = select(Transaction).where(Transaction.company_id == company_id)
    if start_date:
        query = query.where(Transaction.date >= start_date)
    if end_date:
        query = query.where(Transaction.date <= end_date)
        
    transactions = session.exec(query).all()
    
    better_result = []
    for tx in transactions:
        apartment_num = None
        if tx.matched_apartment_id:
            from models import Apartment
            apt = session.get(Apartment, tx.matched_apartment_id)
            if apt:
                 apartment_num = apt.apartment_number
                 
        better_result.append(
            TransactionRead(
                id=tx.id,
                company_id=tx.company_id,
                date=tx.date,
                amount=tx.amount,
                description=tx.description,
                reference_number=tx.reference_number,
                transaction_hash=tx.transaction_hash,
                iban=tx.iban,
                service_period=tx.service_period,
                is_partial_payment=tx.is_partial_payment,
                category_id=tx.category_id,
                category_code=tx.category.code if tx.category else None,
                category_name=tx.category.name if tx.category else None,
                matched_apartment_id=tx.matched_apartment_id,
                matched_apartment_number=apartment_num,
                match_type=tx.match_type,
                is_verified=tx.is_verified,
                verified_at=tx.verified_at,
                verified_by=tx.verified_by,
                notes=tx.notes,
                receipt_url=tx.receipt_url,
            )
        )
    
    return better_result

@router.post("/import", response_model=ImportResult)
async def import_transactions(
    company_id: int, 
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    session: Session = Depends(get_session)
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
        
    contents = await file.read()
    raw_txs = csv_parser.parse_bank_csv(contents)
    
    if not raw_txs:
        raise HTTPException(status_code=400, detail="Could not parse any transactions from the CSV")
        
    job = ImportJob(company_id=company_id, filename=file.filename, status="PENDING", total_count=len(raw_txs))
    session.add(job)
    session.commit()
    session.refresh(job)

    # 🚀 SCALING: Process in background
    from services.task_service import run_import_reconciliation
    background_tasks.add_task(run_import_reconciliation, job.id, company_id, raw_txs)

    # For UI compatibility during MVP, we return a predicted result if small, 
    # but the job is officially backgrounded.
    return ImportResult(
        total_imported=len(raw_txs),
        reference_matches=0,
        rule_matches=0,
        ai_matches=0,
        unmatched=len(raw_txs)
    )

@router.post("/import-pdf", response_model=ImportResult)
async def import_transactions_pdf(
    company_id: int, 
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    session: Session = Depends(get_session)
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    contents = await file.read()
    
    try:
        raw_txs = pdf_service.parse_pdf_bank_statement(contents)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF Parsing Failed: {str(e)}")
    
    if not raw_txs:
        raise HTTPException(status_code=400, detail="Could not parse any transactions from the PDF")
        
    job = ImportJob(company_id=company_id, filename=file.filename, status="PENDING", total_count=len(raw_txs))
    session.add(job)
    session.commit()
    session.refresh(job)

    from services.task_service import run_import_reconciliation
    background_tasks.add_task(run_import_reconciliation, job.id, company_id, raw_txs)

    return ImportResult(
        total_imported=len(raw_txs),
        reference_matches=0,
        rule_matches=0,
        ai_matches=0,
        unmatched=len(raw_txs)
    )

@router.patch("/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    company_id: int, 
    transaction_id: int, 
    tx_update: TransactionUpdate,
    session: Session = Depends(get_session)
):
    tx = session.get(Transaction, transaction_id)
    if not tx or tx.company_id != company_id:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # KPL Compliance: Locked Period Check
    from models import LockedPeriod
    locked = session.exec(select(LockedPeriod).where(
        LockedPeriod.company_id == company_id,
        LockedPeriod.year == tx.date.year,
        LockedPeriod.month == tx.date.month
    )).first()
    if locked:
        raise HTTPException(status_code=403, detail="LAKISÄÄTEINEN ESTO: Kauden kirjanpito on lukittu. Muokkauksia ei voi enää tehdä.")
        
    # Legal Autopilot: Audit Trail Protection
    if tx.is_verified and tx_update.is_verified is not False:
        if (tx_update.category_id is not None and tx.category_id != tx_update.category_id) or \
           (tx_update.notes is not None and tx.notes != tx_update.notes) or \
           (tx_update.amount is not None and tx.amount != tx_update.amount) or \
           (tx_update.accounting_date is not None and tx.accounting_date != tx_update.accounting_date):
            raise HTTPException(status_code=400, detail="LAKISÄÄTEINEN ESTO: Vahvistettua tapahtumaa ei voi muokata. Poista vahvistus ensin.")

    if tx_update.category_id is not None:
        if tx.is_verified and tx.category_id != tx_update.category_id:
            from models import TransactionAudit
            session.add(TransactionAudit(
                transaction_id=tx.id, field="category_id",
                old_value=str(tx.category_id), new_value=str(tx_update.category_id),
                changed_by="Human"
            ))
        tx.category_id = tx_update.category_id
        tx.match_type = MatchType.MANUAL
        
        # ── AUTO-RULE: IBAN Mapping ──────────────────
        if tx.iban:
            existing_rule = session.exec(select(MatchingRule).where(
                MatchingRule.company_id == company_id,
                MatchingRule.iban == tx.iban
            )).first()
            if not existing_rule:
                new_rule = MatchingRule(
                    company_id=company_id,
                    iban=tx.iban,
                    account_category_id=tx_update.category_id,
                    keyword_pattern=f"AutoIBAN: {tx.description[:20]}"
                )
                session.add(new_rule)
        # ─────────────────────────────────────────────
    
    if tx_update.accounting_date is not None:
        if tx.is_verified and tx.accounting_date != tx_update.accounting_date:
            from models import TransactionAudit
            session.add(TransactionAudit(
                transaction_id=tx.id, field="accounting_date",
                old_value=str(tx.accounting_date), new_value=str(tx_update.accounting_date),
                changed_by="Human"
            ))
        tx.accounting_date = tx_update.accounting_date

    if tx_update.amount is not None:
        if tx.is_verified and tx.amount != tx_update.amount:
            from models import TransactionAudit
            session.add(TransactionAudit(
                transaction_id=tx.id, field="amount",
                old_value=str(tx.amount), new_value=str(tx_update.amount),
                changed_by="Human"
            ))
        tx.amount = tx_update.amount
        
    if tx_update.is_verified is not None:
        tx.is_verified = tx_update.is_verified
        tx.verified_at = datetime.now(timezone.utc)
        tx.verified_by = "Human"

        if tx.is_verified and not tx.voucher_number:
            year = tx.date.year
            from sqlalchemy import func
            stmt = select(func.max(Transaction.voucher_number)).where(
                Transaction.company_id == company_id,
                Transaction.voucher_number.like(f"{year}/%")
            )
            max_v = session.exec(stmt).first()
            if max_v:
                try:
                    last_num = int(max_v.split('/')[1])
                    tx.voucher_number = f"{year}/{str(last_num + 1).zfill(3)}"
                except:
                    tx.voucher_number = f"{year}/001"
            else:
                tx.voucher_number = f"{year}/001"

        if tx.category and tx.category.code.startswith("305") and tx.matched_apartment_id:
            from models import ApartmentLoanShare
            shares = session.exec(select(ApartmentLoanShare).where(ApartmentLoanShare.apartment_id == tx.matched_apartment_id)).all()
            for share in shares:
                share.remaining_share -= tx.amount
                session.add(share)

        # ── KPL 2:1 § Kahdenkertainen kirjanpito ────────────────────────────
        if tx.is_verified and tx.category:
            session.add(tx)
            session.flush()  # ensure tx.id is available for JournalLine FK
            from services.journalizer import journalize_transaction
            try:
                jlines = journalize_transaction(tx, session)
                for jl in jlines:
                    session.add(jl)
            except ValueError as je:
                # Log but don't fail — manual correction possible via audit
                print(f"[JOURNALIZER WARNING] {je}")

    if tx_update.notes is not None:
        if tx.is_verified and tx.notes != tx_update.notes:
            from models import TransactionAudit
            session.add(TransactionAudit(
                transaction_id=tx.id, field="notes",
                old_value=tx.notes, new_value=tx_update.notes,
                changed_by="Human"
            ))
        tx.notes = tx_update.notes
        
    session.add(tx)
    session.commit()
    session.refresh(tx)
    
    from models import Apartment
    apartment_num = None
    if tx.matched_apartment_id:
        apt = session.get(Apartment, tx.matched_apartment_id)
        if apt:
            apartment_num = apt.apartment_number
    
    return TransactionRead(
        id=tx.id,
        company_id=tx.company_id,
        date=tx.date,
        amount=tx.amount,
        description=tx.description,
        reference_number=tx.reference_number,
        transaction_hash=tx.transaction_hash,
        iban=tx.iban,
        service_period=tx.service_period,
        is_partial_payment=tx.is_partial_payment,
        category_id=tx.category_id,
        category_code=tx.category.code if tx.category else None,
        category_name=tx.category.name if tx.category else None,
        matched_apartment_id=tx.matched_apartment_id,
        matched_apartment_number=apartment_num,
        match_type=tx.match_type,
        is_verified=tx.is_verified,
        verified_at=tx.verified_at,
        verified_by=tx.verified_by,
        notes=tx.notes,
        receipt_url=tx.receipt_url,
    )

@router.get("/import-jobs", response_model=List[ImportJobRead])
def get_import_jobs(company_id: int, session: Session = Depends(get_session)):
    jobs = session.exec(
        select(ImportJob).where(ImportJob.company_id == company_id).order_by(ImportJob.created_at.desc())
    ).all()
    return jobs

@router.post("/bulk-verify")
def bulk_verify_transactions(company_id: int, session: Session = Depends(get_session)):
    txs = session.exec(
        select(Transaction)
        .where(Transaction.company_id == company_id)
        .where(Transaction.is_verified == False)
    ).all()
    
    now = datetime.now(timezone.utc)
    voucher_counters = {} 

    for tx in txs:
        tx.is_verified = True
        tx.verified_at = now
        tx.verified_by = "Bulk-Verify"  # KPL 2:8 §: identifiable agent
        
        if not tx.voucher_number:
            year = tx.date.year
            if year not in voucher_counters:
                from sqlalchemy import func
                stmt = select(func.max(Transaction.voucher_number)).where(
                    Transaction.company_id == company_id,
                    Transaction.voucher_number.like(f"{year}/%")
                )
                max_v = session.exec(stmt).first()
                if max_v:
                    try:
                        voucher_counters[year] = int(max_v.split('/')[1])
                    except:
                        voucher_counters[year] = 0
                else:
                    voucher_counters[year] = 0
            
            voucher_counters[year] += 1
            tx.voucher_number = f"{year}/{str(voucher_counters[year]).zfill(3)}"

        if tx.category and tx.category.code.startswith("305") and tx.matched_apartment_id:
            from models import ApartmentLoanShare
            shares = session.exec(select(ApartmentLoanShare).where(ApartmentLoanShare.apartment_id == tx.matched_apartment_id)).all()
            for share in shares:
                share.remaining_share -= tx.amount
                session.add(share)

        # ── KPL 2:1 § Kahdenkertainen kirjanpito (bulk) ────────────────────
        if tx.category:
            session.add(tx)
            session.flush()
            from services.journalizer import journalize_transaction
            try:
                jlines = journalize_transaction(tx, session)
                for jl in jlines:
                    session.add(jl)
            except ValueError as je:
                print(f"[JOURNALIZER WARNING] tx={tx.id}: {je}")

        session.add(tx)

    session.commit()
    return {"status": "success", "message": f"{len(txs)} transactions verified."}

@router.get("/categories")
def get_account_categories(company_id: int, session: Session = Depends(get_session)):
    from models import AccountCategory
    return session.exec(select(AccountCategory).order_by(AccountCategory.code)).all()

@router.delete("/import-jobs/{job_id}")
def delete_import_job(company_id: int, job_id: int, session: Session = Depends(get_session)):
    job = session.get(ImportJob, job_id)
    if not job or job.company_id != company_id:
        raise HTTPException(status_code=404, detail="Import Job not found")
        
    from sqlalchemy import func
    count_stmt = select(func.count(Transaction.id)).where(
        Transaction.import_job_id == job_id,
        Transaction.is_verified == True
    )
    verified_count = session.exec(count_stmt).first()
    if verified_count and verified_count > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"LAKISÄÄTEINEN ESTO: Tuontierä sisältää vahvistettuja tapahtumia."
        )
        
    session.exec(delete(Transaction).where(Transaction.import_job_id == job_id))
    session.delete(job)
    session.commit()
    return {"status": "deleted"}

@router.post("/{transaction_id}/receipt")
async def upload_receipt(
    company_id: int,
    transaction_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    tx = session.get(Transaction, transaction_id)
    if not tx or tx.company_id != company_id:
        raise HTTPException(status_code=404, detail="Transaction not found")

    ext = Path(file.filename).suffix.lower()
    if ext not in [".pdf", ".jpg", ".jpeg", ".png"]:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: PDF, JPG, PNG")

    contents = await file.read()
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Tiedosto on liian suuri. Maksimikoko on 10 MB.")

    unique_filename = f"tx_{transaction_id}_{uuid.uuid4().hex}{ext}"
    upload_dir = Path("uploads/receipts")
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / unique_filename

    with file_path.open("wb") as buffer:
        buffer.write(contents)

    tx.receipt_url = f"/uploads/receipts/{unique_filename}"
    session.add(tx)
    session.commit()
    session.refresh(tx)

    return {"status": "uploaded", "receipt_url": tx.receipt_url}

@router.delete("/{transaction_id}/receipt")
async def delete_receipt(
    company_id: int,
    transaction_id: int,
    session: Session = Depends(get_session)
):
    tx = session.get(Transaction, transaction_id)
    if not tx or tx.company_id != company_id:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if tx.receipt_url:
        relative_path = tx.receipt_url.lstrip("/")
        file_path = Path(relative_path)
        if file_path.exists():
            file_path.unlink()
        
        tx.receipt_url = None
        session.add(tx)
        session.commit()

    return {"status": "deleted"}

@router.post("/scan-receipt", response_model=ReceiptExtractionResult)
async def scan_receipt(
    company_id: int,
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    contents = await file.read()
    ext = Path(file.filename).suffix.lower()
    
    unique_filename = f"scan_{uuid.uuid4().hex}{ext}"
    upload_dir = Path("uploads/receipts")
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / unique_filename

    with file_path.open("wb") as buffer:
        buffer.write(contents)

    receipt_url = f"/uploads/receipts/{unique_filename}"
    mime_type = "application/pdf" if ext == ".pdf" else f"image/{ext.lstrip('.')}"
    if mime_type == "image/jpg": mime_type = "image/jpeg"

    try:
        extracted = receipt_service.extract_receipt_data(contents, mime_type)
    except Exception as e:
        if file_path.exists(): file_path.unlink()
        raise HTTPException(status_code=400, detail=str(e))

    match = receipt_service.match_receipt_to_transactions(extracted, company_id, session)

    from models import date as models_date
    return ReceiptExtractionResult(
        vendor=extracted.get("vendor", "Unknown"),
        amount=extracted.get("amount", 0.0),
        date=extracted.get("date", datetime.now().date()),
        suggested_category_code=extracted.get("suggested_category_code"),
        suggested_transaction_id=match.id if match else None,
        receipt_url=receipt_url
    )
