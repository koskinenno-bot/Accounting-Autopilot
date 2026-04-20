
from sqlmodel import Session, select
from database import engine
from models import HousingCompany, Apartment, AccountCategory
from services import reconciliation_service
import datetime

def test_offline_reconciliation():
    print("--- TESTING OFFLINE RECONCILIATION ---")
    with Session(engine) as session:
        company = session.exec(select(HousingCompany)).first()
        if not company:
            print("No company found. Run seed.py first.")
            return

        # Synthetic transactions
        raw_txs = [
            # 1. Reference match (Finnish Checksum)
            {
                "date": datetime.date.today(),
                "amount": 250.00,
                "description": "Vastike A1",
                "reference_number": "100018" 
            },
            # 2. Global Rule Match (Helen)
            {
                "date": datetime.date.today(),
                "amount": -145.20,
                "description": "Helen Oy Sähkölasku",
                "reference_number": None
            },
            # 3. Local Fuzzy Match (Siivous)
            {
                "date": datetime.date.today(),
                "amount": -300.00,
                "description": "Portaikon Siivouspalvelu",
                "reference_number": None
            },
            # 4. Unmatched
            {
                "date": datetime.date.today(),
                "amount": -50.00,
                "description": "Mysteerimaksut Oy",
                "reference_number": None
            }
        ]

        print(f"Processing {len(raw_txs)} transactions without Gemini...")
        saved, stats = reconciliation_service.reconcile_transactions(raw_txs, company.id, session)
        
        print("\nResults:")
        for tx in saved:
            cat_name = tx.category.name if tx.category else "UNMATCHED"
            print(f"- {tx.description}: {cat_name} ({tx.match_type.value})")
        
        print(f"\nStats: {stats}")
        
        # Verify no AI was used
        if stats.get("ai_matches", 0) == 0:
            print("\nSTATUS: 100% OFFLINE RECONCILIATION SUCCESSFUL")

if __name__ == "__main__":
    test_offline_reconciliation()
