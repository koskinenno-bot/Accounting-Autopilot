"""Generoi fiktiiviset ostolasku-PDF:t demoa varten (As Oy Demokoti, marraskuu 2026).

Käyttö:  python scripts/samples/generate_invoices.py
Tulos:   scripts/samples/ostolaskut/*.pdf  ja  scripts/samples/ostolaskut.json (demo-data.js lukee)
Toimittajat, Y-tunnukset ja tilinumerot ovat keksittyjä.
"""
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "ostolaskut")

BUYER = "As Oy Demokoti, Demokuja 1, 00100 Helsinki"

# paid: miten marraskuun tiliotteella maksetaan (demo-data.js): ref = viitteellä, name = summa+nimi,
# amount = pelkkä summa eri nimellä, None = ei vielä maksettu (jää ostovelaksi)
INVOICES = [
    {"file": "kaukolampo-2026-10.pdf", "supplier": "Kaukolämpö Esimerkki Oy", "businessId": "1234567-1",
     "number": "KL-88412", "date": "31.10.2026", "due": "14.11.2026", "period": ("1.10.2026", "31.10.2026"),
     "lines": [("Kaukolämpö lokakuu 2026, 41,2 MWh", "1 389,40")], "total": "1 389,40", "amount": 1389.40,
     "ref": "88412 00017", "iban": "FI55 1234 5600 0011 22", "paid": "ref", "payDate": "2026-11-13"},
    {"file": "vesi-2026-10.pdf", "supplier": "Esimerkin Vesi Oy", "businessId": "2345678-2",
     "number": "2026-10-5531", "date": "2.11.2026", "due": "16.11.2026", "period": ("1.10.2026", "31.10.2026"),
     "lines": [("Vesi- ja jätevesimaksu lokakuu 2026", "402,15")], "total": "402,15", "amount": 402.15,
     "ref": "55310 00026", "iban": "FI66 2345 6700 0022 33", "paid": "name", "payDate": "2026-11-17"},
    {"file": "sahko-2026-10.pdf", "supplier": "Sähköyhtiö Demo Oy", "businessId": "3456780-3",
     "number": "S-301977", "date": "3.11.2026", "due": "17.11.2026", "period": ("1.10.2026", "31.10.2026"),
     "lines": [("Sähkö yhteiset tilat lokakuu 2026", "198,60")], "total": "198,60", "amount": 198.60,
     "ref": "30197 70035", "iban": "FI77 3456 7800 0033 44", "paid": "amount", "payDate": "2026-11-18"},
    {"file": "isannointi-2026-11.pdf", "supplier": "Isännöintitoimisto Malli Oy", "businessId": "4567891-4",
     "number": "IS-2026-11-07", "date": "1.11.2026", "due": "15.11.2026", "period": ("1.11.2026", "30.11.2026"),
     "lines": [("Isännöintipalkkio marraskuu 2026", "650,00")], "total": "650,00", "amount": 650.00,
     "ref": "20261 10074", "iban": "FI88 4567 8900 0044 55", "paid": "ref", "payDate": "2026-11-14"},
    {"file": "siivous-2026-11.pdf", "supplier": "Siivouspalvelu Testi Oy", "businessId": "5678902-5",
     "number": "1127", "date": "20.11.2026", "due": "4.12.2026", "period": ("1.11.2026", "30.11.2026"),
     "lines": [("Porrassiivous marraskuu 2026", "310,00")], "total": "310,00", "amount": 310.00,
     "ref": "11270 00081", "iban": "FI99 5678 9000 0055 66", "paid": None, "payDate": None},
    {"file": "rannit-2026-11.pdf", "supplier": "Rakennuspalvelu Virtanen Tmi", "businessId": "6789013-6",
     "number": "V-0412", "date": "6.11.2026", "due": "20.11.2026", "period": None,
     "lines": [("Rännien puhdistus ja syöksytorvien tarkastus", "245,00")], "total": "245,00", "amount": 245.00,
     "ref": "4120 00096", "iban": "FI10 6789 0100 0066 77", "paid": "ref", "payDate": "2026-11-19"},
]


def draw_invoice(inv: dict, path: str) -> None:
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    y = h - 60

    def line(text: str, size: int = 10, bold: bool = False, dy: int = 16, x: int = 50) -> None:
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(x, y, text)
        y -= dy

    line(inv["supplier"], 16, bold=True, dy=20)
    line(f"Y-tunnus: {inv['businessId']}")
    line("Esimerkkikatu 10, 00100 Helsinki", dy=30)
    line("LASKU", 14, bold=True, dy=22)
    line(f"Laskun numero: {inv['number']}")
    line(f"Laskun päivämäärä: {inv['date']}")
    line(f"Eräpäivä: {inv['due']}")
    if inv["period"]:
        line(f"Laskutuskausi: {inv['period'][0]} - {inv['period'][1]}")
    line(f"Ostaja: {BUYER}", dy=30)
    for desc, amount in inv["lines"]:
        c.setFont("Helvetica", 10)
        c.drawString(50, y, desc)
        c.drawRightString(w - 50, y, f"{amount} €")
        y -= 16
    y -= 10
    line("ALV 0 % (asunto-osakeyhtiö, ei arvonlisäverovelvollinen)          0,00 €")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "Yhteensä")
    c.drawRightString(w - 50, y, f"{inv['total']} €")
    y -= 36
    line(f"Viitenumero: {inv['ref']}")
    line(f"Tilinumero: {inv['iban']}")
    c.showPage()
    c.save()


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    meta = []
    for inv in INVOICES:
        draw_invoice(inv, os.path.join(OUT, inv["file"]))
        meta.append({k: inv[k] for k in ("file", "supplier", "number", "amount", "ref", "iban", "paid", "payDate")})
    with open(os.path.join(HERE, "ostolaskut.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"Kirjoitettiin {len(INVOICES)} laskua kansioon {OUT}")


if __name__ == "__main__":
    main()
