"""Raporttien PDF-tuloste (reportlab: toimii Windowsilla ilman järjestelmäkirjastoja)."""
import io
from datetime import date
from typing import Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _eur(v: float) -> str:
    s = f"{v:,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} €"


def _period(fy: Optional[Dict]) -> str:
    if not fy:
        return "Kaikki tilikaudet"
    def fmt(iso: str) -> str:  # 2026-01-01 -> 1.1.2026
        return ".".join(str(int(p)) for p in reversed(iso[:10].split("-")))

    status = " (suljettu)" if fy.get("status") == "CLOSED" else ""
    return f"Tilikausi {fmt(fy['startDate'])}–{fmt(fy['endDate'])}{status}"


def _table(rows: List[List], bold_rows: List[int]) -> Table:
    t = Table(rows, colWidths=[125 * mm, 45 * mm])
    style = [
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    for i in bold_rows:
        style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"), ("LINEABOVE", (0, i), (-1, i), 0.5, colors.grey)]
    t.setStyle(TableStyle(style))
    return t


def _section_rows(sections: List[Dict]):
    rows, bold = [], []
    for s in sections:
        if s.get("subtotal"):
            bold.append(len(rows))
            rows.append([s["title"].upper(), _eur(s["total"])])
            continue
        rows.append([s["title"], ""])
        bold.append(len(rows) - 1)
        for r in s.get("rows", []):
            rows.append([f"   {r['label']}", _eur(r["amount"])])
        rows.append([f"   {s['title']} yhteensä", _eur(s["total"])])
    return rows, bold


def render_report(kind: str, data: Dict, company_name: str, fiscal_year: Optional[Dict]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"{company_name} {kind}")
    styles = getSampleStyleSheet()
    titles = {"income-statement": "Tuloslaskelma", "balance-sheet": "Tase", "maintenance-calculation": "Vastikelaskelma"}
    story = [
        Paragraph(company_name, styles["Title"]),
        Paragraph(f"{titles[kind]} – {_period(fiscal_year)}", styles["Heading2"]),
        Spacer(1, 6 * mm),
    ]

    if kind == "income-statement":
        rows, bold = _section_rows(data["sections"])
        story.append(_table(rows, bold))
    elif kind == "balance-sheet":
        for side, title in (("assets", "VASTAAVAA"), ("liabilities", "VASTATTAVAA")):
            rows, bold = _section_rows(data["sections"][side])
            total = data["assets"]["total"] if side == "assets" else data["equity"]["total"]
            rows.append([f"{title} YHTEENSÄ", _eur(total)])
            bold.append(len(rows) - 1)
            story += [Paragraph(title, styles["Heading3"]), _table(rows, bold), Spacer(1, 5 * mm)]
        if not data.get("balanced"):
            story.append(Paragraph("HUOM: tase ei täsmää.", styles["Normal"]))
    else:
        mf, cf = data["maintenance_fund"], data["capital_fund"]
        rows = [
            ["Hoitorahoitus", ""], ["   Hoitotuotot", _eur(mf["income"])], ["   Hoitokulut (ilman poistoja)", _eur(-mf["expenses"])],
            ["   Hoitorahoituksen yli-/alijäämä", _eur(mf["surplus"])],
            ["Pääomarahoitus", ""], ["   Pääomavastikkeet ja rahoitustuotot", _eur(cf["income"])],
            ["   Lainojen lyhennykset", _eur(-cf.get("loanRepayments", 0))],
            ["   Rahoituskulut", _eur(-(cf["expenses"] - cf.get("loanRepayments", 0)))],
            ["   Pääomarahoituksen yli-/alijäämä", _eur(cf["surplus"])],
        ]
        story.append(_table(rows, [0, 3, 4, 8]))
        story += [Spacer(1, 5 * mm), Paragraph("Vastikelaskelma asunto-osakeyhtiölain 10 luvun 5 §:n mukaisesti.", styles["Italic"])]

    story += [Spacer(1, 10 * mm), Paragraph(f"Tulostettu {date.today().strftime('%d.%m.%Y')} – AI Accountant v3", styles["Normal"])]
    doc.build(story)
    return buf.getvalue()
