from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import MatchingRule, User, AccountCategory
from schemas import MatchingRuleRead, MatchingRuleCreate

from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/rules",
    tags=["Rules"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/", response_model=List[MatchingRuleRead])
def get_rules(company_id: int, session: Session = Depends(get_session)):
    rules = session.exec(
        select(MatchingRule).where(MatchingRule.company_id == company_id)
    ).all()
    
    result = []
    for r in rules:
        cat = session.get(AccountCategory, r.account_category_id)
        result.append(
            MatchingRuleRead(
                id=r.id,
                company_id=r.company_id,
                keyword_pattern=r.keyword_pattern,
                iban=r.iban,
                account_category_id=r.account_category_id,
                category_code=cat.code if cat else None,
                category_name=cat.name if cat else None,
            )
        )
    return result

@router.post("/", response_model=MatchingRuleRead)
def create_rule(
    company_id: int, 
    rule_in: MatchingRuleCreate, 
    session: Session = Depends(get_session)
):
    # Verify category exists
    cat = session.get(AccountCategory, rule_in.account_category_id)
    if not cat:
        raise HTTPException(status_code=400, detail="Invalid Account Category")
        
    rule = MatchingRule(
        company_id=company_id,
        keyword_pattern=rule_in.keyword_pattern,
        iban=rule_in.iban,
        account_category_id=rule_in.account_category_id
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    
    return MatchingRuleRead(
        id=rule.id,
        company_id=rule.company_id,
        keyword_pattern=rule.keyword_pattern,
        iban=rule.iban,
        account_category_id=rule.account_category_id,
        category_code=cat.code,
        category_name=cat.name,
    )

@router.delete("/{rule_id}")
def delete_rule(
    company_id: int, 
    rule_id: int, 
    session: Session = Depends(get_session)
):
    rule = session.get(MatchingRule, rule_id)
    if not rule or rule.company_id != company_id:
        raise HTTPException(status_code=404, detail="Matching Rule not found")
        
    session.delete(rule)
    session.commit()
    return {"status": "deleted"}
