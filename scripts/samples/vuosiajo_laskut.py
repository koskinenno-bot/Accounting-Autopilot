"""Ostolasku-PDF:t vuosiajoa varten (scripts/vuosiajo.js kutsuu tätä).

Käyttö:  python scripts/samples/vuosiajo_laskut.py <laskut.json> <kohdekansio>
laskut.json: lista laskuja { file, supplier, businessId, number, date, due, period, lines, net, vatRate, vat, total, ref, iban, buyer }
Summat merkkijonoina suomalaisessa muodossa (1 234,56). Toimittajat ja tilinumerot ovat keksittyjä.
"""
import json
import os
import sys

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def draw(inv: dict, path: str) -> None:
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    y = h - 60

    def line(text: str, size: int = 10, bold: bool = False, dy: int = 16) -> None:
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(50, y, text)
        y -= dy

    line(inv["supplier"], 16, bold=True, dy=20)
    line(f"Y-tunnus: {inv['businessId']}")
    line("Esimerkkikatu 10, 00100 Helsinki", dy=30)
    line("LASKU", 14, bold=True, dy=22)
    line(f"Laskun numero: {inv['number']}")
    line(f"Laskun päivämäärä: {inv['date']}")
    line(f"Eräpäivä: {inv['due']}")
    if inv.get("period"):
        line(f"Laskutuskausi: {inv['period'][0]} - {inv['period'][1]}")
    line(f"Ostaja: {inv['buyer']}", dy=30)
    for desc, amount in inv["lines"]:
        c.setFont("Helvetica", 10)
        c.drawString(50, y, desc)
        c.drawRightString(w - 50, y, f"{amount} €")
        y -= 16
    y -= 10
    if inv.get("vatRate"):
        line(f"Veroton yhteensä {inv['net']} €")
        line(f"ALV {inv['vatRate']} % {inv['vat']} €")
    else:
        line("ALV 0 % (arvonlisäveroton palvelu) 0,00 €")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "Yhteensä")
    c.drawRightString(w - 50, y, f"{inv['total']} €")
    y -= 36
    line(f"Viitenumero: {inv['ref']}")
    line(f"Tilinumero: {inv['iban']}")
    c.showPage()
    c.save()


def main() -> None:
    spec, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    with open(spec, encoding="utf-8") as f:
        invoices = json.load(f)
    for inv in invoices:
        draw(inv, os.path.join(out, inv["file"]))
    print(f"{len(invoices)} laskua -> {out}")


if __name__ == "__main__":
    main()
