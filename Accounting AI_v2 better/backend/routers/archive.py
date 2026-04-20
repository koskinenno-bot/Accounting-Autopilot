import shutil
import uuid
import os
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form
from sqlmodel import Session, select
from auth import get_current_user
from database import get_session
from models import AuditVaultFile, User, HousingCompany

from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/vault",
    tags=["Audit Vault"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)

@router.get("/", response_model=List[AuditVaultFile])
def get_vault_files(company_id: int, session: Session = Depends(get_session)):
    return session.exec(select(AuditVaultFile).where(AuditVaultFile.company_id == company_id).order_by(AuditVaultFile.created_at.desc())).all()

@router.post("/upload")
async def upload_vault_file(
    company_id: int,
    category: str = Form(...),
    year: int = Form(...),
    notes: str = Form(None),
    file: UploadFile = File(...),
    session: Session = Depends(get_session)
):
    # Ensure directory exists
    upload_dir = Path("uploads/vault")
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    ext = Path(file.filename).suffix.lower()
    unique_filename = f"vault_{uuid.uuid4().hex}{ext}"
    file_path = upload_dir / unique_filename
    
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    db_file = AuditVaultFile(
        company_id=company_id,
        category=category,
        year=year,
        filename=file.filename,
        file_url=f"/uploads/vault/{unique_filename}",
        notes=notes
    )
    session.add(db_file)
    session.commit()
    session.refresh(db_file)
    
    return db_file

@router.delete("/{file_id}")
def delete_vault_file(company_id: int, file_id: int, session: Session = Depends(get_session)):
    db_file = session.get(AuditVaultFile, file_id)
    if not db_file or db_file.company_id != company_id:
        raise HTTPException(status_code=404)
        
    # Remove from disk
    actual_path = Path(db_file.file_url.lstrip("/"))
    if actual_path.exists():
        actual_path.unlink()
        
    session.delete(db_file)
    session.commit()
    return {"status": "deleted"}
