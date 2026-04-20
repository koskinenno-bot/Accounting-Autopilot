from fastapi import HTTPException, Depends
from sqlmodel import Session, select
from database import get_session
from auth import get_current_user
from models import HousingCompany, User

def verify_company_access(company_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """
    Dependency to ensure the requested company exists and belongs to the authenticated user.
    Prevents BOLA (Broken Object Level Authorization) vulnerabilities.
    """
    company = session.get(HousingCompany, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Housing Company not found")
    
    if company.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="LAKISÄÄTEINEN ESTO: Pääsy evätty. Et ole tämän yhtiön valtuutettu hallinnoija.")
    
    return company
