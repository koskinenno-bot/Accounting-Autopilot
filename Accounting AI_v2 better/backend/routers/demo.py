from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from auth import get_current_user
from database import get_session
from models import HousingCompany, Apartment, MatchingRule, User, AccountCategory
import datetime

router = APIRouter(
    prefix="/demo",
    tags=["Demo"],
)

@router.post("/seed")
def seed_demo_data(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """
    Sets up a perfect demo company 'As Oy Demokoti' with matching rules
    and apartments. Designed for a flawless sales demo.
    """
    # 1. Create Company
    demo_company = HousingCompany(
        name="As Oy Demokoti",
        business_id="0737546-2",       # Valid Y-tunnus (eri kuin seed-data)
        bank_account="FI4550009420888888",  # Valid Finnish IBAN format
        owner_id=current_user.id
    )
    session.add(demo_company)
    session.commit()
    session.refresh(demo_company)
    
    # 2. Add Apartments
    apts = [
        ("A 1", "Meikäläinen Matti", 250.0, "12344"),
        ("A 2", "Virtanen Ville", 320.0, "22349"),
        ("B 3", "Korhonen Kaisa", 280.0, "32344"),
        ("B 4", "Mäkinen Mikko", 350.0, "42349"),
    ]
    
    for num, owner, fee, ref in apts:
        apt = Apartment(
            company_id=demo_company.id,
            apartment_number=num,
            owner_name=owner,
            monthly_fee=fee,
            reference_number=ref
        )
        session.add(apt)
        
    # 3. Add Rules
    rules = [
        ("Nordea", "9400"), # Pankkikulut (9400)
        ("Fortum", "4700"), # Sähkö
        ("Helsingin kaupunki", "5100"), # Tonttivuokra / Vero
    ]
    
    for pattern, code in rules:
        cat = session.exec(select(AccountCategory).where(AccountCategory.code == code)).first()
        if cat:
            rule = MatchingRule(
                company_id=demo_company.id,
                keyword_pattern=pattern,
                account_category_id=cat.id
            )
            session.add(rule)
            
    session.commit()
    
    # Return instructions for the demo
    return {
        "status": "success",
        "company_id": demo_company.id,
        "message": "Demo data seeded! Use the following CSV rows in a file named 'demo.csv' to show the automation:",
        "csv_sample": (
            "Pvm;Summa;Saaja/Maksaja;Viite\n"
            f"{datetime.date.today().strftime('%d.%m.%Y')};250,00;Meikäläinen Matti;12344\n"
            f"{datetime.date.today().strftime('%d.%m.%Y')};320,00;Virtanen Ville;22349\n"
            f"{datetime.date.today().strftime('%d.%m.%Y')};-12,50;Nordea Palvelumaksu;\n"
            f"{datetime.date.today().strftime('%d.%m.%Y')};-85,20;Fortum Oyj;\n"
        )
    }
