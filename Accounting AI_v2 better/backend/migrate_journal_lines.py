"""
Retroaktiivinen JournalLine-migraatio.
Luo kahdenkertaiset kirjanpitoviennit kaikille jo vahvistetuille tapahtumille.

Aja kerran:
    cd backend
    python migrate_journal_lines.py

Turvallinen: ei poista mitään, vain lisää puuttuvat JournalLine-rivit.
"""
import sys
from sqlmodel import Session, select, create_engine
from dotenv import load_dotenv
import os

load_dotenv()

# Use the same SQLite DB as the main app
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./accounting.db")
engine = create_engine(DATABASE_URL, echo=False)

def run_migration():
    from models import Transaction, JournalLine
    from services.journalizer import journalize_transaction

    with Session(engine) as session:
        # Get all verified transactions that don't yet have journal lines
        verified_txs = session.exec(
            select(Transaction).where(Transaction.is_verified == True)
        ).all()

        total = len(verified_txs)
        journalized = 0
        skipped = 0
        errors = 0

        print(f"\nLöydettiin {total} vahvistettua tapahtumaa.\n")

        for tx in verified_txs:
            # Check if already journalized
            existing = session.exec(
                select(JournalLine).where(JournalLine.transaction_id == tx.id)
            ).first()
            if existing:
                skipped += 1
                continue

            if not tx.category:
                print(f"  [OHITETTU] tx={tx.id} — ei kategoriaa ({tx.description[:40]})")
                skipped += 1
                continue

            try:
                lines = journalize_transaction(tx, session)
                if lines:
                    for line in lines:
                        session.add(line)
                    journalized += 1
                    if journalized % 100 == 0:
                        print(f"  ... {journalized} kirjattu")
                        session.commit()
            except ValueError as e:
                print(f"  [VIRHE] tx={tx.id}: {e}")
                errors += 1

        session.commit()

        print(f"\n{'='*50}")
        print(f"Migraatio valmis!")
        print(f"  Journalisoitiin:  {journalized}")
        print(f"  Ohitettu (jo ok): {skipped}")
        print(f"  Virheitä:         {errors}")
        print(f"{'='*50}\n")

        if errors > 0:
            print("HUOMIO: Virheelliset tapahtumat vaativat manuaalista tarkistusta.")
            print("Ne ovat todennäköisesti tapahtumia, joilla on väärä kategoria.")

if __name__ == "__main__":
    # Import all models to register them with SQLModel metadata
    import models  # noqa: F401
    run_migration()
