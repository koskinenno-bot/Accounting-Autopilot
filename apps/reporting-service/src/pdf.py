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
    # round + 0.0: ei negatiivista nollaa ("-0,00 €")
    s = f"{round(v, 2) + 0.0:,.2f}".replace(",", " ").replace(".", ",")
    return f"{s} €"


def _period(fy: Optional[Dict]) -> str:
    if not fy:
        return "Kaikki tilikaudet"
    def fmt(iso: str) -> str:  # 2026-01-01 -> 1.1.2026
        return ".".join(str(int(p)) for p in reversed(iso[:10].split("-")))

    status = " (suljettu)" if fy.get("status") == "CLOSED" else ""
    return f"Tilikausi {fmt(fy['startDate'])}–{fmt(fy['endDate'])}{status}"


def _year(fy: Optional[Dict], point: bool = False) -> str:
    """Sarakeotsikko: tuloslaskelmassa kausi, taseessa tilikauden viimeinen päivä (tase on hetkitilanne)."""
    if not fy:
        return ""
    def fmt(iso: str) -> str:
        return ".".join(str(int(p)) for p in reversed(iso[:10].split("-")))
    if point:
        return fmt(fy['endDate'])
    return f"{fmt(fy['startDate'])}–\n{fmt(fy['endDate'])}"


def _table(rows: List[List], bold_rows: List[int], cmp: bool, header: Optional[List[str]] = None,
           italic_rows: Optional[List[int]] = None) -> Table:
    if header:
        rows = [header] + rows
        bold_rows = [i + 1 for i in bold_rows]
        italic_rows = [i + 1 for i in (italic_rows or [])]
    widths = [100 * mm, 35 * mm, 35 * mm] if cmp else [125 * mm, 45 * mm]
    t = Table(rows, colWidths=widths)
    style = [
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    if cmp:
        style.append(("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#555555")))
    if header:
        style += [("FONTSIZE", (0, 0), (-1, 0), 8), ("TEXTCOLOR", (0, 0), (-1, 0), colors.grey),
                  ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey)]
    for i in bold_rows:
        style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"), ("LINEABOVE", (0, i), (-1, i), 0.5, colors.grey)]
    for i in italic_rows or []:
        style.append(("FONTNAME", (0, i), (0, i), "Helvetica-Oblique"))
    t.setStyle(TableStyle(style))
    return t


def _amounts(item: Dict, key: str, prev_key: str, cmp: bool) -> List[str]:
    cur = _eur(item[key])
    if not cmp:
        return [cur]
    prev = item.get(prev_key)
    return [cur, _eur(prev) if prev is not None else ""]


def _section_rows(sections: List[Dict], cmp: bool):
    rows, bold, italic = [], [], []
    blank = [""] * (2 if cmp else 1)
    for s in sections:
        if s.get("subtotal"):
            bold.append(len(rows))
            rows.append([s["title"].upper()] + _amounts(s, "total", "previousTotal", cmp))
            continue
        bold.append(len(rows))
        rows.append([s["title"]] + blank)
        groups = s.get("groups")
        if groups:
            # Kaavan erittelyryhmät: ryhmän otsikko kursiivilla ja ryhmän summa, tilit sisennettyinä
            for g in groups:
                italic.append(len(rows))
                rows.append([f"   {g['title']}"] + _amounts(g, "total", "previousTotal", cmp))
                if len(g["rows"]) > 1 or g["rows"][0]["label"].split(" ", 1)[-1] != g["title"]:
                    for r in g["rows"]:
                        rows.append([f"      {r['label']}"] + _amounts(r, "amount", "previous", cmp))
        else:
            for r in s.get("rows", []):
                rows.append([f"   {r['label']}"] + _amounts(r, "amount", "previous", cmp))
        rows.append([f"   {s['title']} yhteensä"] + _amounts(s, "total", "previousTotal", cmp))
    return rows, bold, italic


TITLES = {"income-statement": "Tuloslaskelma", "balance-sheet": "Tase", "maintenance-calculation": "Vastikelaskelma"}


def report_flowables(kind: str, data: Dict, styles, previous_year: Optional[Dict], fiscal_year: Optional[Dict]) -> List:
    """Yhden raportin taulukot (käytetään sekä erillisessä PDF:ssä että tilinpäätöspaketissa)."""
    story: List = []
    cmp = previous_year is not None
    point = kind == "balance-sheet"
    header = ["", _year(fiscal_year, point), _year(previous_year, point)] if cmp else None

    if kind == "income-statement":
        rows, bold, italic = _section_rows(data["sections"], cmp)
        story.append(_table(rows, bold, cmp, header, italic))
    elif kind == "balance-sheet":
        for side, title in (("assets", "VASTAAVAA"), ("liabilities", "VASTATTAVAA")):
            rows, bold, italic = _section_rows(data["sections"][side], cmp)
            total = data["assets"]["total"] if side == "assets" else data["equity"]["total"]
            prev_total = sum(sec.get("previousTotal", 0) for sec in data["sections"][side])
            rows.append([f"{title} YHTEENSÄ", _eur(total)] + ([_eur(prev_total)] if cmp else []))
            bold.append(len(rows) - 1)
            story += [Paragraph(title, styles["Heading3"]), _table(rows, bold, cmp, header, italic), Spacer(1, 5 * mm)]
        if not data.get("balanced"):
            story.append(Paragraph("HUOM: tase ei täsmää.", styles["Normal"]))
    else:
        def lines(d: Dict) -> List[float]:
            mf, cf = d["maintenance_fund"], d["capital_fund"]
            return [mf["income"], -mf["expenses"], mf["surplus"], cf["income"], -cf.get("loanRepayments", 0),
                    -(cf["expenses"] - cf.get("loanRepayments", 0)), cf["surplus"]]
        cur = lines(data)
        prev = lines(data["previous"]) if cmp and data.get("previous") else None
        cmp = prev is not None
        labels = ["Hoitotuotot", "Hoitokulut (ilman poistoja)", "Hoitorahoituksen yli-/alijäämä",
                  "Pääomavastikkeet ja rahoitustuotot", "Lainojen lyhennykset", "Rahoituskulut",
                  "Pääomarahoituksen yli-/alijäämä"]
        vals = [[f"   {lbl}", _eur(c)] + ([_eur(p)] if cmp else []) for lbl, c, p in zip(labels, cur, prev or cur)]
        blank = [""] * (2 if cmp else 1)
        rows = [["Hoitorahoitus"] + blank] + vals[:3] + [["Pääomarahoitus"] + blank] + vals[3:]
        story.append(_table(rows, [0, 3, 4, 8], cmp, header if cmp else None))
        story += [Spacer(1, 5 * mm), Paragraph("Vastikelaskelma asunto-osakeyhtiölain 10 luvun 5 §:n mukaisesti.", styles["Italic"])]
    return story


def render_report(kind: str, data: Dict, company_name: str, fiscal_year: Optional[Dict],
                  previous_year: Optional[Dict] = None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
                            title=f"{company_name} {kind}")
    styles = getSampleStyleSheet()
    story = [
        Paragraph(company_name, styles["Title"]),
        Paragraph(f"{TITLES[kind]} – {_period(fiscal_year)}", styles["Heading2"]),
        Spacer(1, 6 * mm),
    ]
    story += report_flowables(kind, data, styles, previous_year, fiscal_year)
    story += [Spacer(1, 10 * mm), Paragraph(f"Tulostettu {date.today().strftime('%d.%m.%Y')} – AI Accountant v3", styles["Normal"])]
    doc.build(story)
    return buf.getvalue()
