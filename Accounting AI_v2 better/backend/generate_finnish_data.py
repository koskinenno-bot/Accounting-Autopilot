import csv
import random
from datetime import date, timedelta
from database import engine
from sqlmodel import Session, select
from models import Apartment

def generate_finnish_reference(base_number: str) -> str:
    weights = [7, 3, 1]
    total = sum(int(char) * weights[idx % 3] for idx, char in enumerate(reversed(base_number)))
    check = (10 - (total % 10)) % 10
    return f"{base_number}{check}"

def generate_fake_data(filename: str, num_rows: int = 2000):
    # Try grabbing real apartments from the DB if it exists
    try:
        with Session(engine) as session:
            apartments = session.exec(select(Apartment)).all()
            if apartments:
                apartment_pool = [
                    (apt.monthly_fee, apt.reference_number)
                    for apt in apartments
                ]
            else:
                raise ValueError("No apartments in DB")
    except Exception:
         # Fallback pool
         apartment_pool = [
             (250.00, generate_finnish_reference("10001")),
             (180.00, generate_finnish_reference("10002")),
             (210.00, generate_finnish_reference("10003")),
         ]
         
    # Finnish businesses / Entities 
    # Weighted:
    # Rule engine recognizable: Fortum, Helen, Lassila & Tikanoja, HSY jne
    # AI recognizable: K-Rauta, Verohallinto, Kone
    expenses = [
        ("FORTUM OYJ SAHKOLASKU", -150.0, -800.0),
        ("Helen Oy Sahko", -100.0, -500.0),
        ("LASSILA & TIKANOJA SIIVOUS OY", -200.0, -400.0),
        ("Isannointitoimisto Paakirja Oy", -850.0, -850.0),
        ("Pääkirja Taloushallinto", -300.0, -500.0),
        ("HSY VESI JA VIEMARI", -100.0, -300.0),
        ("K-Rauta rautakauppa", -20.0, -200.0),
        ("Verohallinto Kiinteistovero", -1000.0, -2500.0),
        ("Kone Hissihuolto", -150.0, -400.0),
        ("S-Rauta Maalia ja tarvikkeita", -15.0, -100.0),
        ("DNA Oyj Laajakaista", -120.0, -120.0),
        ("Pankin Palvelumaksu", -12.50, -12.50)
    ]

    start_date = date(2023, 1, 1)

    with open(filename, mode="w", newline="", encoding="utf-8-sig") as file:
        file.write("Kirjauspäivä;Selite;Summa;Viitenumero\n")

        for _ in range(num_rows):
            # Random date progression
            current_date = start_date + timedelta(days=random.randint(0, 365))
            
            # Format date as native Finnish DD.MM.YYYY
            date_str = current_date.strftime("%d.%m.%Y")
            
            if random.random() < 0.6:
                # 60% chance it's a maintenance fee (Income)
                fee, ref = random.choice(apartment_pool)
                desc = f"Hoitovastike {ref}"
                # Format money with Finnish comma decimal
                amount_str = f"{fee:.2f}".replace(".", ",")
                file.write(f"{date_str};{desc};{amount_str};{ref}\n")
            else:
                # 40% chance it's an expense
                company, min_val, max_val = random.choice(expenses)
                expense_val = random.uniform(max_val, min_val) # Negative numbers
                amount_str = f"{expense_val:.2f}".replace(".", ",")
                file.write(f"{date_str};{company};{amount_str};\n")

    print(f"Generated {num_rows} perfectly formatted Finnish transactions in '{filename}'.")

if __name__ == "__main__":
    # Generate a massive test file mimicking a full year of operation
    generate_fake_data("massive_finnish_bank_export.csv", 5000)
    print("Done! You can upload massive_finnish_bank_export.csv to the web app.")
