import sys
import os
from sqlmodel import Session, select
from database import engine, create_db_and_tables
from models import HousingCompany, User, Transaction, ImportJob
from services import csv_parser, reconciliation_service

def populate():
    create_db_and_tables()
    with Session(engine) as session:
        # Check if we have at least one company
        company = session.exec(select(HousingCompany)).first()
        if not company:
            print("No company found. Run seed.py first.")
            return

        print(f"Populating data for {company.name} (ID: {company.id})")
        
        # Read the test CSV
        csv_path = "large_test_statement.csv"
        if not os.path.exists(csv_path):
            print(f"CSV not found at {csv_path}")
            return
            
        with open(csv_path, "rb") as f:
            contents = f.read()
            
        raw_txs = csv_parser.parse_bank_csv(contents)
        print(f"Parsed {len(raw_txs)} transactions.")
        
        # Create an import job
        job = ImportJob(company_id=company.id, filename="manual_populate.csv")
        session.add(job)
        session.commit()
        session.refresh(job)
        
        # Reconcile
        saved, stats = reconciliation_service.reconcile_transactions(raw_txs, company.id, session, job.id)
        print(f"Imported {len(saved)} transactions.")
        print(f"Stats: {stats}")
        
if __name__ == "__main__":
    populate()
