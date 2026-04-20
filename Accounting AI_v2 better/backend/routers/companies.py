from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func

from auth import get_current_user
from database import get_session
from models import HousingCompany, User, Transaction, Apartment
from schemas import HousingCompanyCreate, HousingCompanyRead, PortfolioCompanyRead

router = APIRouter(
    prefix="/companies",
    tags=["Companies"],
)

@router.get("/portfolio-stats", response_model=List[PortfolioCompanyRead])
def get_portfolio_stats(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    companies = session.exec(select(HousingCompany).where(HousingCompany.owner_id == current_user.id)).all()
    
    results = []
    for c in companies:
        unverified_count = session.exec(
            select(func.count(Transaction.id))
            .where(Transaction.company_id == c.id)
            .where(Transaction.is_verified == False)
        ).one()
        
        # Calculate total cash for this company (sum of all transactions)
        total_cash = session.exec(
            select(func.sum(Transaction.amount))
            .where(Transaction.company_id == c.id)
        ).one() or 0.0
        
        total_apts = session.exec(select(func.count(Apartment.id)).where(Apartment.company_id == c.id)).one()
        paid_apts = session.exec(
            select(func.count(func.distinct(Transaction.matched_apartment_id)))
            .where(Transaction.company_id == c.id)
            .where(Transaction.matched_apartment_id != None)
        ).one()
        unpaid = total_apts - paid_apts
        
        results.append(
            PortfolioCompanyRead(
                id=c.id,
                name=c.name,
                business_id=c.business_id,
                bank_account=c.bank_account,
                unverified_transactions=unverified_count,
                unpaid_apartments=max(0, unpaid),
                total_cash=total_cash
            )
        )
    return results

@router.get("/", response_model=List[HousingCompanyRead])
def get_companies(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    companies = session.exec(select(HousingCompany).where(HousingCompany.owner_id == current_user.id)).all()
    return companies

@router.post("/", response_model=HousingCompanyRead)
def create_company(company: HousingCompanyCreate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    db_company = HousingCompany.model_validate(company)
    db_company.owner_id = current_user.id
    session.add(db_company)
    session.commit()
    session.refresh(db_company)
    return db_company

@router.get("/{company_id}", response_model=HousingCompanyRead)
def get_company(company_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    company = session.get(HousingCompany, company_id)
    if not company or company.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Company not found")
    return company
