from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import Budget, AccountCategory, AccountType
from schemas import BudgetRead, BudgetCreate, BudgetUpdate

from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/budgets",
    tags=["Budgets"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/{year}", response_model=List[BudgetRead])
def get_budgets(company_id: int, year: int, session: Session = Depends(get_session)):
    stmt = select(Budget).where(Budget.company_id == company_id, Budget.year == year)
    budgets = session.exec(stmt).all()
    
    # Fill in categories with zero budget if they are not set
    # Only for Expense categories as that's primary budgeting target
    categories = session.exec(select(AccountCategory).where(AccountCategory.type == AccountType.EXPENSE)).all()
    
    existing_cat_ids = {b.category_id for b in budgets}
    result = list(budgets)
    
    for cat in categories:
        if cat.id not in existing_cat_ids:
            result.append(Budget(
                company_id=company_id,
                category_id=cat.id,
                year=year,
                amount=0.0,
                id=None # Virtual ID for UI
            ))
            
    return result

@router.post("/", response_model=BudgetRead)
def create_or_update_budget(
    company_id: int, 
    budget: BudgetCreate, 
    session: Session = Depends(get_session)
):
    # Check if exists
    stmt = select(Budget).where(
        Budget.company_id == company_id, 
        Budget.category_id == budget.category_id,
        Budget.year == budget.year
    )
    db_budget = session.exec(stmt).first()
    
    if db_budget:
        db_budget.amount = budget.amount
        session.add(db_budget)
    else:
        db_budget = Budget(
            company_id=company_id,
            category_id=budget.category_id,
            year=budget.year,
            amount=budget.amount
        )
        session.add(db_budget)
        
    session.commit()
    session.refresh(db_budget)
    return db_budget
