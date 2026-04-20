from datetime import date
from sqlmodel import Session, create_engine, SQLModel
from services.receipt_service import match_receipt_to_transactions
from models import Transaction, MatchType

# Setup memory DB for testing
engine = create_engine("sqlite://")
SQLModel.metadata.create_all(engine)

def test_matching():
    with Session(engine) as session:
        # 1. Setup test data
        tx1 = Transaction(
            company_id=1,
            date=date(2026, 4, 10),
            amount=-45.50,
            description="PRISMA SELLO",
            match_type=MatchType.UNMATCHED,
            is_verified=False
        )
        session.add(tx1)
        session.commit()
        session.refresh(tx1)

        # 2. Mock extracted data
        extracted = {
            "vendor": "Prisma",
            "amount": -45.50,
            "date": "2026-04-12" # Within 5 days
        }

        # 3. Running matcher
        match = match_receipt_to_transactions(extracted, 1, session)

        if match and match.id == tx1.id:
            print("Match Success: Found Prisma transaction by amount and fuzzy description.")
        else:
            print(f"Match Failed: {match}")

        # 4. Test amount mismatch
        extracted["amount"] = -100.0
        match = match_receipt_to_transactions(extracted, 1, session)
        if match is None:
            print("Correctly rejected amount mismatch.")
        else:
            print(f"Error: Matched despite amount mismatch: {match}")

if __name__ == "__main__":
    test_matching()
