from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select

from auth import ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token, get_current_user, get_password_hash, verify_password
from database import get_session
from models import User
from schemas import Token, UserCreate, UserRead

router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
)

@router.post("/register", response_model=UserRead)
def register(user: UserCreate, session: Session = Depends(get_session)):
    existing_user = session.exec(select(User).where(User.email == user.email)).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    db_user = User(
        email=user.email,
        hashed_password=get_password_hash(user.password)
    )
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user

@router.post("/login", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session)
):
    user = session.exec(select(User).where(User.email == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.delete("/purge-data", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_account(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """
    GDPR: Right to be Forgotten.
    Permanently deletes all data associated with the user across all companies.
    """
    from models import HousingCompany, Transaction, Apartment, AuditVaultFile
    
    # 1. Find all companies owned by this user
    companies = session.exec(select(HousingCompany).where(HousingCompany.owner_id == current_user.id)).all()
    
    for company in companies:
        # Delete files from disk first
        txs = session.exec(select(Transaction).where(Transaction.company_id == company.id)).all()
        for tx in txs:
            if tx.receipt_url:
                actual_path = tx.receipt_url.replace("/files/", "uploads/").lstrip("/")
                try: 
                    import os
                    if os.path.exists(actual_path): os.unlink(actual_path)
                except: pass
        
        vault_files = session.exec(select(AuditVaultFile).where(AuditVaultFile.company_id == company.id)).all()
        for vf in vault_files:
            actual_path = vf.file_url.replace("/files/", "uploads/").lstrip("/")
            try:
                import os
                if os.path.exists(actual_path): os.unlink(actual_path)
            except: pass
            
        # Delete company (SQLModel should handle children if cascade works, but let's be safe)
        session.delete(company)
        
    session.delete(current_user)
    session.commit()
    return None
