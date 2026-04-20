from sqlmodel import Session, select
from database import engine
from services import csv_parser, reconciliation_service
from models import HousingCompany, ImportJob
import os

def force_import():
    with Session(engine) as session:
        company = session.exec(select(HousingCompany).where(HousingCompany.id == 1)).first()
        if not company:
            print("Company 1 not found.")
            return

        csv_path = r"c:\Users\koski\Documents\Accounting AI_v2 better\backend\massive_finnish_bank_export.csv"
        if not os.path.exists(csv_path):
            print(f"CSV not found at {csv_path}")
            return

        with open(csv_path, "rb") as f:
            contents = f.read()
        
        raw_txs = csv_parser.parse_bank_csv(contents)
        print(f"Parsed {len(raw_txs)} transactions.")

        job = ImportJob(company_id=company.id, filename="massive_verify.csv")
        session.add(job)
        session.commit()
        session.refresh(job)

        saved, stats = reconciliation_service.reconcile_transactions(raw_txs, company.id, session, job.id)
        print(f"Import complete: {stats}")

if __name__ == "__main__":
    force_import()
