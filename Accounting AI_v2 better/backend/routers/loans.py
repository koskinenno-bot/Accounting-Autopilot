from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from auth import get_current_user
from database import get_session
from models import CompanyLoan, ApartmentLoanShare, User, HousingCompany, Apartment
from schemas import CompanyLoanRead, CompanyLoanCreate, ApartmentLoanShareRead

from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/loans",
    tags=["Loans"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/", response_model=List[CompanyLoanRead])
def get_loans(company_id: int, session: Session = Depends(get_session)):
    loans = session.exec(select(CompanyLoan).where(CompanyLoan.company_id == company_id)).all()
    return loans

@router.post("/", response_model=CompanyLoanRead)
def create_loan(company_id: int, loan: CompanyLoanCreate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    company = session.get(HousingCompany, company_id)
    if not company or company.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Company not found")
        
    db_loan = CompanyLoan.model_validate(loan)
    db_loan.company_id = company_id
    session.add(db_loan)
    session.commit()
    session.refresh(db_loan)
    
    # Initialize apartment shares to 0
    apartments = session.exec(select(Apartment).where(Apartment.company_id == company_id)).all()
    for apt in apartments:
        share = ApartmentLoanShare(
            apartment_id=apt.id,
            loan_id=db_loan.id,
            initial_share=0.0,
            remaining_share=0.0
        )
        session.add(share)
    
    session.commit()
    session.refresh(db_loan)
    return db_loan

@router.patch("/shares/{share_id}", response_model=ApartmentLoanShareRead)
def update_loan_share(share_id: int, remaining_share: float, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    share = session.get(ApartmentLoanShare, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    
    # Simple security check: verify company owner
    loan = session.get(CompanyLoan, share.loan_id)
    company = session.get(HousingCompany, loan.company_id)
    if company.owner_id != current_user.id:
        raise HTTPException(status_code=403)
        
    share.remaining_share = remaining_share
    session.add(share)
    session.commit()
    session.refresh(share)
    return share
