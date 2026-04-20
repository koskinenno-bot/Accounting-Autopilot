import os
import zipfile
import csv
from io import BytesIO, StringIO
from pathlib import Path
from datetime import datetime, timezone
from sqlmodel import Session, select
from models import Transaction, AccountCategory

def generate_statutory_archive(company_id: int, year: int, session: Session):
    """
    KPL 2:10 § Universal Archive Export.
    Generates a ZIP containing human-readable CSV records and all linked PDFs.
    """
    # 1. Fetch all transactions for the year
    start_date = datetime(year, 1, 1)
    end_date = datetime(year, 12, 31)
    txs = session.exec(
        select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.date >= start_date,
            Transaction.date <= end_date
        ).order_by(Transaction.date, Transaction.id)
    ).all()

    if not txs:
        return None

    # 2. Create ZIP in memory
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        
        # ── CREATE JOURNAL CSV ──
        csv_buffer = StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow([
            "Pvm", "Tositenumero", "Selite", "Summa", "Tili (Koodi)", "Tili (Nimi)", 
            "Viite", "IBAN", "Vahvistettu", "Kuitti-tiedosto"
        ])
        
        for t in txs:
            receipt_filename = ""
            if t.receipt_url:
                actual_path = t.receipt_url.replace("/files/", "uploads/").replace("/uploads/", "uploads/").lstrip("/")
                if os.path.exists(actual_path):
                    ext = Path(actual_path).suffix
                    arcname = f"kuitit/tosite_{t.voucher_number.replace('/', '_') if t.voucher_number else t.id}{ext}"
                    zip_file.write(actual_path, arcname)
                    receipt_filename = arcname

            writer.writerow([
                t.date.strftime("%d.%m.%Y"),
                t.voucher_number or "",
                t.description,
                f"{t.amount:.2f}",
                t.category.code if t.category else "",
                t.category.name if t.category else "",
                t.reference_number or "",
                t.iban or "",
                "KYLLÄ" if t.is_verified else "EI",
                receipt_filename
            ])
        
        # utf-8-sig = UTF-8 with BOM — required for correct ä/ö/å in Windows Excel
        zip_file.writestr("paivakirja.csv", csv_buffer.getvalue().encode("utf-8-sig"))

        # ── CREATE README ──
        readme = f"""Lakisääteinen Kirjanpitoarkisto (KPL 2:10 §)
==============================================
Yhtiö ID: {company_id}
Tilikausi: {year}
Luotu: {datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M")} UTC

Tämä arkisto sisältää yhtiön täydellisen kirjanpitoaineiston standardissa muodossa.
- paivakirja.csv: Kaikki tilikauden tapahtumat ja tilöinnit.
- kuitit/: Alkuperäiset tositteet PDF/kuvamuodossa.

Aineisto on säilytettävä 10 vuotta tilikauden päättymisestä.
"""
        zip_file.writestr("LUE_MINUT.txt", readme)

    zip_buffer.seek(0)
    return zip_buffer
