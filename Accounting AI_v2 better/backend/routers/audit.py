from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from auth import get_current_user
from database import get_session
from models import Transaction, User, HousingCompany, AccountCategory, Apartment
from schemas import TransactionRead

router = APIRouter(
    prefix="/audit",
    tags=["Global Audit"],
)

class GlobalAuditItem(TransactionRead):
    company_name: str

@router.get("/inbox", response_model=List[GlobalAuditItem])
def get_global_audit_inbox(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """
    Returns all unverified transactions across ALL companies owned by the current user.
    This is the high-productivity view for accounting professionals managing 100+ clients.
    """
    # Get all companies for this user
    companies = session.exec(select(HousingCompany).where(HousingCompany.owner_id == current_user.id)).all()
    company_ids = [c.id for c in companies]
    id_to_name = {c.id: c.name for c in companies}
    
    if not company_ids:
        return []
        
    # Get all unverified transactions for these companies
    stmt = select(Transaction).where(
        Transaction.company_id.in_(company_ids),
        Transaction.is_verified == False
    ).order_by(Transaction.date.desc())
    
    txs = session.exec(stmt).all()
    
    # Map to enhanced result with company names
    result = []
    for tx in txs:
        # Resolve category if exists
        cat_code = None
        cat_name = None
        if tx.category_id:
            cat = session.get(AccountCategory, tx.category_id)
            if cat:
                cat_code = cat.code
                cat_name = cat.name
        
        # Resolve apartment if exists
        apt_num = None
        if tx.matched_apartment_id:
            apt = session.get(Apartment, tx.matched_apartment_id)
            if apt:
                apt_num = apt.apartment_number

        result.append(
            GlobalAuditItem(
                id=tx.id,
                company_id=tx.company_id,
                company_name=id_to_name.get(tx.company_id, "Unknown"),
                date=tx.date,
                amount=tx.amount,
                description=tx.description,
                reference_number=tx.reference_number,
                transaction_hash=tx.transaction_hash,
                iban=tx.iban,
                service_period=tx.service_period,
                is_partial_payment=tx.is_partial_payment,
                category_id=tx.category_id,
                category_code=cat_code,
                category_name=cat_name,
                matched_apartment_id=tx.matched_apartment_id,
                matched_apartment_number=apt_num,
                match_type=tx.match_type,
                is_verified=tx.is_verified,
                verified_at=tx.verified_at,
                verified_by=tx.verified_by,
                notes=tx.notes,
                receipt_url=tx.receipt_url,
                voucher_number=tx.voucher_number,
                accounting_date=tx.accounting_date
            )
        )
        
    return result
