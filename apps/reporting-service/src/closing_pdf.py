"""Tilinpäätöspaketin, tase-erittelyjen, päiväkirjan ja pääkirjan PDF-tulosteet (reportlab)."""
import io
from datetime import date
from typing import Dict, List, Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from closing import fmt_date, period_text
from pdf import _eur, report_flowables

WIDTH = 170 * mm


def _styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle("Body", parent=s["Normal"], fontSize=10, leading=14, spaceAfter=6))
    s.add(ParagraphStyle("Small", parent=s["Normal"], fontSize=8, leading=10, textColor=colors.HexColor("#444444")))
    s.add(ParagraphStyle("Cell", parent=s["Normal"], fontSize=8, leading=10))
    s.add(ParagraphStyle("Draft", parent=s["Normal"], fontSize=11, alignment=1, textColor=colors.HexColor("#B91C1C")))
    for name in ("Heading1", "Heading3", "Heading4"):
        s.add(ParagraphStyle(f"Cover{name}", parent=s[name], alignment=1))
    return s


def _p(text: str, style) -> Paragraph:
    return Paragraph(escape(text or "").replace("\n", "<br/>"), style)


def _doc(buf, title: str, footer: str) -> SimpleDocTemplate:
    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.grey)
        canvas.drawString(20 * mm, 10 * mm, footer)
        canvas.drawRightString(190 * mm, 10 * mm, f"Sivu {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm,
                            bottomMargin=18 * mm, title=title)
    doc._on_page = on_page  # type: ignore[attr-defined]
    return doc


def _build(doc: SimpleDocTemplate, story: List) -> None:
    doc.build(story, onFirstPage=doc._on_page, onLaterPages=doc._on_page)  # type: ignore[attr-defined]


def _grid(rows: List[List], widths: List[float], header_rows: int = 1, bold_rows: Optional[List[int]] = None,
          right_from: int = 1, font: float = 8) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=header_rows)
    style = [
        ("FONTSIZE", (0, 0), (-1, -1), font),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (right_from, 0), (-1, -1), "RIGHT"),
        ("TEXTCOLOR", (0, 0), (-1, header_rows - 1), colors.grey),
        ("LINEBELOW", (0, header_rows - 1), (-1, header_rows - 1), 0.5, colors.grey),
    ]
    for i in bold_rows or []:
        style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"), ("LINEABOVE", (0, i), (-1, i), 0.4, colors.grey)]
    t.setStyle(TableStyle(style))
    return t


def _budget_table(budget: Dict) -> Table:
    rows = [["", "Toteuma", "Talousarvio", "Ero"]]
    bold = []
    for s in budget["sections"]:
        if s.get("subtotal"):
            bold.append(len(rows))
            rows.append([s["title"], _eur(s["total"]), _eur(s["previousTotal"]), _eur(s["total"] - s["previousTotal"])])
            continue
        if not s.get("rows") and not s["total"] and not s["previousTotal"]:
            continue
        for r in s.get("rows", []):
            rows.append([f"   {r['label']}", _eur(r["amount"]), _eur(r.get("previous", 0)), _eur(r["amount"] - r.get("previous", 0))])
        bold.append(len(rows))
        rows.append([f"{s['title']} yhteensä", _eur(s["total"]), _eur(s["previousTotal"]), _eur(s["total"] - s["previousTotal"])])
    return _grid(rows, [86 * mm, 28 * mm, 28 * mm, 28 * mm], bold_rows=bold)


def render_closing_package(ctx: Dict) -> bytes:
    """ctx: company, fiscalYear, previousFiscalYear, report, notes (merge_sections), incomeStatement, balanceSheet,
    maintenance (tai None), budget, package (allekirjoittajat ym.)."""
    company, fy, prev_fy, pkg = ctx["company"], ctx["fiscalYear"], ctx.get("previousFiscalYear"), ctx["package"]
    s = _styles()
    buf = io.BytesIO()
    doc = _doc(buf, f"{company['name']} tilinpäätös {period_text(fy)}",
               f"{company['name']} – Tilinpäätös {period_text(fy)}")
    draft = fy.get("status") != "CLOSED"
    is_koy = company.get("companyType") == "KOY"

    contents = ["Toimintakertomus", "Tuloslaskelma", "Tase"]
    if not is_koy:
        contents.append("Vastikelaskelma")
    contents += ["Liitetiedot", "Allekirjoitukset ja tilinpäätösmerkintä"]
    story: List = [Spacer(1, 50 * mm), Paragraph(escape(company["name"]), s["Title"])]
    if company.get("businessId"):
        story.append(Paragraph(f"Y-tunnus {escape(company['businessId'])}", s["CoverHeading4"]))
    story += [Spacer(1, 12 * mm), Paragraph("TILINPÄÄTÖS", s["CoverHeading1"]),
              Paragraph(f"Tilikausi {period_text(fy)}", s["CoverHeading3"]), Spacer(1, 15 * mm)]
    if draft:
        story += [Paragraph("LUONNOS – tilikausi on vielä avoinna, luvut voivat muuttua.", s["Draft"]), Spacer(1, 8 * mm)]
    story += [Paragraph("Sisältö", s["Heading4"])] + [Paragraph(f"{i + 1}. {c}", s["Body"]) for i, c in enumerate(contents)]
    story.append(Spacer(1, 30 * mm))
    story.append(Paragraph("Tilinpäätös säilytetään vähintään 10 vuotta tilikauden päättymisestä (kirjanpitolaki 2 luku 10 §).", s["Small"]))
    story.append(PageBreak())

    story.append(Paragraph("Toimintakertomus", s["Heading1"]))
    for sec in ctx["report"]:
        story += [Paragraph(escape(sec["title"]), s["Heading3"]), _p(sec["text"], s["Body"])]
        if sec["key"] == "budget" and ctx["budget"]["hasBudget"]:
            story += [Spacer(1, 2 * mm), _budget_table(ctx["budget"]), Spacer(1, 3 * mm)]
    story.append(PageBreak())

    for kind, data in (("income-statement", ctx["incomeStatement"]), ("balance-sheet", ctx["balanceSheet"])):
        story += [Paragraph({"income-statement": "Tuloslaskelma", "balance-sheet": "Tase"}[kind], s["Heading1"]),
                  Paragraph(f"Tilikausi {period_text(fy)}", s["Normal"]), Spacer(1, 4 * mm)]
        story += report_flowables(kind, data, s, prev_fy, fy)
        story.append(PageBreak())
    if not is_koy and ctx.get("maintenance"):
        story += [Paragraph("Vastikelaskelma", s["Heading1"]), Spacer(1, 4 * mm)]
        story += report_flowables("maintenance-calculation", ctx["maintenance"], s, prev_fy, fy)
        story.append(PageBreak())

    story.append(Paragraph("Liitetiedot", s["Heading1"]))
    for sec in ctx["notes"]:
        story.append(KeepTogether([Paragraph(escape(sec["title"]), s["Heading3"]), _p(sec["text"], s["Body"])]))
    story.append(PageBreak())

    story.append(Paragraph("Tilinpäätöksen ja toimintakertomuksen allekirjoitus", s["Heading2"]))
    place = pkg.get("signPlace") or "____________________"
    when = fmt_date(pkg["signDate"]) if pkg.get("signDate") else "____.____.________"
    story += [Paragraph(f"{escape(place)}, {when}", s["Body"]), Spacer(1, 14 * mm)]
    signers = pkg.get("signers") or [{"name": "", "role": "hallituksen puheenjohtaja"}, {"name": "", "role": "hallituksen jäsen"},
                                       {"name": "", "role": "hallituksen jäsen"}, {"name": "", "role": "isännöitsijä"}]
    cells = [[Paragraph("_" * 34 + "<br/>" + escape(x["name"] or " ") + "<br/>" + escape(x.get("role") or ""), s["Cell"])
              for x in signers[i:i + 2]] for i in range(0, len(signers), 2)]
    for row in cells:
        if len(row) == 1:
            row.append("")
    sig = Table(cells, colWidths=[85 * mm, 85 * mm])
    sig.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 16), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [sig, Spacer(1, 14 * mm)]

    kind = "toiminnantarkastuksesta" if pkg.get("auditorKind") == "INSPECTOR" else "tilintarkastuksesta"
    title = "Toiminnantarkastusmerkintä" if pkg.get("auditorKind") == "INSPECTOR" else "Tilinpäätösmerkintä"
    who = "toiminnantarkastaja" if pkg.get("auditorKind") == "INSPECTOR" else "tilintarkastaja"
    story += [
        Paragraph(title, s["Heading3"]),
        Paragraph(f"Suoritetusta {kind} on annettu tänään kertomus.", s["Body"]),
        Paragraph("____________________, ____.____.________", s["Body"]), Spacer(1, 14 * mm),
        Paragraph("_" * 34 + "<br/>" + escape(pkg.get("auditorName") or " ") + "<br/>" + who, s["Cell"]),
    ]
    story += [Spacer(1, 12 * mm), Paragraph(f"Tulostettu {date.today().strftime('%d.%m.%Y')} – AI Accountant v3", s["Small"])]
    _build(doc, story)
    return buf.getvalue()


def render_balance_details(company: Dict, fy: Dict, rows: List[Dict], has_previous: bool) -> bytes:
    s = _styles()
    buf = io.BytesIO()
    doc = _doc(buf, f"{company['name']} tase-erittelyt", f"{company['name']} – Tase-erittelyt {period_text(fy)}")
    story: List = [Paragraph(escape(company["name"]), s["Title"]),
                   Paragraph(f"Tase-erittelyt {fmt_date(fy['endDate'])}", s["Heading2"]),
                   Paragraph("Tase-erittelyt eivät ole julkisia. Ne säilytetään 10 vuotta (kirjanpitolaki 2 luku 10 §).", s["Small"]),
                   Spacer(1, 5 * mm)]
    group = None
    for r in rows:
        if r["group"] != group:
            group = r["group"]
            story.append(Paragraph(escape(group), s["Heading3"]))
        head = ["Avaava saldo", "Debet", "Kredit", "Päättävä saldo"] + (["Edellinen kausi"] if has_previous else [])
        vals = [_eur(r["opening"]), _eur(r["debit"]), _eur(r["credit"]), _eur(r["closing"])] + ([_eur(r.get("previous", 0))] if has_previous else [])
        w = 170 * mm / len(head)
        block = [Paragraph(f"<b>{escape(r['label'])}</b>", s["Normal"]), _grid([head, vals], [w] * len(head), right_from=0)]
        note = r.get("note") or ""
        if r.get("openingMismatch"):
            note = ("HUOM: avaava saldo poikkeaa edellisen tilikauden päättävästä saldosta.\n" + note).strip()
        block.append(_p(note or "Erittely: ____________________________________________", s["Small"]))
        block.append(Spacer(1, 4 * mm))
        story.append(KeepTogether(block))
    _build(doc, story)
    return buf.getvalue()


def render_journal(company: Dict, fy: Dict, entries: List[Dict]) -> bytes:
    s = _styles()
    buf = io.BytesIO()
    doc = _doc(buf, f"{company['name']} päiväkirja", f"{company['name']} – Päiväkirja {period_text(fy)}")
    rows: List[List] = [["Päivä", "Tosite", "Selite", "Tili", "Debet", "Kredit"]]
    debit = credit = 0.0
    for e in entries:
        for i, l in enumerate(e["lines"]):
            text = e["description"] if i == 0 else (l["description"] if l["description"] != e["description"] else "")
            rows.append([fmt_date(e["date"]) if i == 0 else "", e["voucher"] if i == 0 else "",
                         Paragraph(escape(text[:120]), s["Cell"]), l["account"],
                         _eur(l["debit"]) if l["debit"] else "", _eur(l["credit"]) if l["credit"] else ""])
            debit += l["debit"]
            credit += l["credit"]
    rows.append(["", "", f"Yhteensä {len(entries)} vientiä", "", _eur(debit), _eur(credit)])
    story: List = [Paragraph(escape(company["name"]), s["Title"]),
                   Paragraph(f"Päiväkirja – tilikausi {period_text(fy)}", s["Heading2"]), Spacer(1, 4 * mm),
                   _grid(rows, [18 * mm, 24 * mm, 66 * mm, 12 * mm, 25 * mm, 25 * mm], bold_rows=[len(rows) - 1], right_from=4)]
    _build(doc, story)
    return buf.getvalue()


def render_general_ledger(company: Dict, fy: Dict, accounts: List[Dict]) -> bytes:
    s = _styles()
    buf = io.BytesIO()
    doc = _doc(buf, f"{company['name']} pääkirja", f"{company['name']} – Pääkirja {period_text(fy)}")
    story: List = [Paragraph(escape(company["name"]), s["Title"]),
                   Paragraph(f"Pääkirja – tilikausi {period_text(fy)}", s["Heading2"]), Spacer(1, 4 * mm)]
    for a in accounts:
        rows: List[List] = [["Päivä", "Tosite", "Selite", "Debet", "Kredit", "Saldo"]]
        for r in a["rows"]:
            rows.append([fmt_date(r["date"]), r["voucher"], Paragraph(escape(r["description"][:110]), s["Cell"]),
                         _eur(r["debit"]) if r["debit"] else "", _eur(r["credit"]) if r["credit"] else "", _eur(r["balance"])])
        rows.append(["", "", "Yhteensä", _eur(a["debit"]), _eur(a["credit"]), _eur(a["balance"])])
        story += [Paragraph(f"<b>{escape(a['label'])}</b>", s["Heading4"]),
                  _grid(rows, [18 * mm, 24 * mm, 56 * mm, 24 * mm, 24 * mm, 24 * mm], bold_rows=[len(rows) - 1], right_from=3),
                  Spacer(1, 4 * mm)]
    _build(doc, story)
    return buf.getvalue()
