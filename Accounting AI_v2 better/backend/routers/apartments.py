import csv
import io
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select
from auth import get_current_user
from database import get_session
from models import Apartment, User, HousingCompany
from schemas import ApartmentCreate, ApartmentRead

from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/apartments",
    tags=["Apartments"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/", response_model=List[ApartmentRead])
def get_apartments(company_id: int, session: Session = Depends(get_session)):
    apartments = session.exec(select(Apartment).where(Apartment.company_id == company_id)).all()
    return apartments

@router.post("/", response_model=ApartmentRead)
def create_apartment(
    company_id: int, apartment: ApartmentCreate, session: Session = Depends(get_session)
):
    db_apartment = Apartment.model_validate(apartment)
    db_apartment.company_id = company_id
    session.add(db_apartment)
    session.commit()
    session.refresh(db_apartment)
    return db_apartment

@router.post("/bulk-import")
async def bulk_import_apartments(
    company_id: int, 
    file: UploadFile = File(...), 
    session: Session = Depends(get_session)
):
    """
    Import apartments from CSV. 
    Expected format: apartment_number;owner_name;monthly_fee;reference_number
    """
    contents = await file.read()
    decoded = contents.decode("utf-8")
    reader = csv.reader(io.StringIO(decoded), delimiter=";")
    
    # Skip header if exists
    header = next(reader, None)
    if header and "numero" not in header[0].lower():
        # It wasn't a header, reuse it
        io_stream = io.StringIO(decoded)
        reader = csv.reader(io_stream, delimiter=";")
    
    imported_count = 0
    for row in reader:
        if len(row) < 4: continue
        try:
            apt = Apartment(
                company_id=company_id,
                apartment_number=row[0].strip(),
                owner_name=row[1].strip(),
                monthly_fee=float(row[2].replace(",", ".")),
                reference_number=row[3].strip()
            )
            session.add(apt)
            imported_count += 1
        except:
            continue
            
    session.commit()
    return {"status": "success", "count": imported_count}

@router.get("/{apartment_id}", response_model=ApartmentRead)
def get_apartment(company_id: int, apartment_id: int, session: Session = Depends(get_session)):
    apartment = session.get(Apartment, apartment_id)
    if not apartment or apartment.company_id != company_id:
        raise HTTPException(status_code=404, detail="Apartment not found")
    return apartment
