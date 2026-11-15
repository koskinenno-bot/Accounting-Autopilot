"""Aja: python -m unittest discover -s tests   (reporting-service-kansiossa)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from closing import (NOTE_SECTIONS, REPORT_SECTIONS, balance_details, budget_balances,  # noqa: E402
                     budget_comparison, default_notes, default_report, general_ledger, journal_rows,
                     merge_sections)
from closing_pdf import render_balance_details, render_closing_package, render_general_ledger, render_journal  # noqa: E402
from reports import account_balances, build_balance_sheet, build_income_statement, build_maintenance_calculation  # noqa: E402


def entry(date, voucher, *lines, kind="NORMAL", desc="Vienti"):
    return {"entryDate": f"{date}T00:00:00.000Z", "voucherNumber": voucher, "description": desc, "entryType": kind,
            "lines": [{"accountNumber": a, "debit": d, "credit": c} for a, d, c in lines]}


FY = {"id": "fy", "startDate": "2026-01-01T00:00:00.000Z", "endDate": "2026-12-31T00:00:00.000Z", "status": "OPEN"}
LEDGER = [
    entry("2026-01-01", "AV-1", ("1010", "500000", "0"), ("1910", "20000", "0"), ("2000", "0", "100000"),
          ("2500", "0", "420000"), kind="OPENING", desc="Avaus"),
    entry("2026-02-01", "M-1", ("1910", "6000", "0"), ("3000", "0", "6000"), desc="Vastikkeet"),
    entry("2026-03-01", "O-1", ("7000", "1500", "0"), ("1910", "0", "1500"), desc="Kattokorjaus"),
    entry("2026-03-15", "O-2", ("4500", "800", "0"), ("1910", "0", "800"), desc="Lämpö"),
    entry("2026-06-30", "L-1", ("2500", "10000", "0"), ("8000", "900", "0"), ("1910", "0", "10900"), desc="Lainanlyhennys"),
]
NAMES = {"1010": "Rakennukset", "1910": "Pankkitili", "2000": "Osakepääoma", "2500": "Lainat", "3000": "Hoitovastikkeet",
         "4500": "Lämmitys", "7000": "Korjaukset", "8000": "Korkokulut"}
COMPANY = {"name": "As Oy Testi", "businessId": "1234567-8", "companyType": "AS_OY"}


def ctx(budget_lines=None, package=None, prev=None):
    bal = account_balances(LEDGER)
    flows = [e for e in LEDGER if e["entryType"] != "CLOSING"]
    c = {
        "company": COMPANY, "fiscalYear": FY, "previousFiscalYear": None, "package": package or {}, "names": NAMES,
        "incomeStatement": build_income_statement(account_balances(flows), NAMES),
        "balanceSheet": build_balance_sheet(bal, NAMES), "maintenance": build_maintenance_calculation(account_balances(flows), 1000000),
        "budget": budget_comparison(account_balances(flows), budget_lines or [], NAMES), "balances": bal,
        "prevBalances": prev, "openingBalances": account_balances([e for e in LEDGER if e["entryType"] == "OPENING"]),
        "assets": [{"name": "Rakennus", "accountNumber": "1010", "method": "DECLINING", "rate": "4.00", "isActive": True}],
    }
    c["report"] = merge_sections(REPORT_SECTIONS, default_report(c), (package or {}).get("report", {}))
    c["notes"] = merge_sections(NOTE_SECTIONS, default_notes(c), (package or {}).get("notes", {}))
    return c


class ClosingTests(unittest.TestCase):
    def test_balance_details_opening_movement_closing(self):
        rows = {r["account"]: r for r in balance_details(LEDGER, None, NAMES, {"1910": "Tiliote 31.12."})}
        bank = rows["1910"]
        self.assertEqual((bank["opening"], bank["debit"], bank["credit"], bank["closing"]), (20000.0, 6000.0, 13200.0, 12800.0))
        self.assertEqual(bank["note"], "Tiliote 31.12.")
        self.assertEqual(rows["2500"]["closing"], 410000.0)     # vastattavaa positiivisena
        self.assertEqual(rows["2500"]["group"], "Vieras pääoma: pitkäaikainen")
        self.assertNotIn("3000", rows)                            # vain taseen tilit
        self.assertNotIn("previous", bank)

    def test_balance_details_flags_opening_mismatch(self):
        prev = {"1910": 2000000, "1010": 50000000, "2000": -10000000, "2500": -42100000}
        rows = {r["account"]: r for r in balance_details(LEDGER, prev, NAMES, {})}
        self.assertFalse(rows["1910"]["openingMismatch"])
        self.assertTrue(rows["2500"]["openingMismatch"])          # 421 000 vs 420 000

    def test_result_carry_forward_is_not_a_mismatch(self):
        ledger = [entry("2026-01-01", "AV-1", ("1910", "500", "0"), ("2100", "0", "500"), kind="OPENING")]
        rows = {r["account"]: r for r in balance_details(ledger, {"1910": 50000, "2100": -20000, "2200": -30000}, NAMES, {})}
        self.assertFalse(rows["2100"]["openingMismatch"])
        self.assertFalse(rows["2200"]["openingMismatch"])

    def test_migrated_year_result_on_income_accounts(self):
        # Vertailuvuosi siirretty saldoluettelona: tulos 300 on tuotto- ja kulutileillä, ei tilillä 2200
        ledger = [entry("2026-01-01", "AV-1", ("1910", "500", "0"), ("2100", "0", "500"), kind="OPENING")]
        prev = {"1910": 50000, "2100": -20000, "3000": -40000, "4000": 10000}
        rows = {r["account"]: r for r in balance_details(ledger, prev, NAMES, {})}
        self.assertFalse(rows["2100"]["openingMismatch"])

    def test_budget_signs_and_comparison(self):
        self.assertEqual(budget_balances([{"accountNumber": "3000", "amount": 100}, {"accountNumber": "4500", "amount": 40}]),
                         {"3000": -10000, "4500": 4000})
        c = budget_comparison(account_balances(LEDGER), [{"accountNumber": "3000", "amount": 6500}, {"accountNumber": "4500", "amount": 1000}], NAMES)
        s = {r["title"]: r for r in c["summary"]}
        self.assertEqual((s["Hoitotuotot"]["actual"], s["Hoitotuotot"]["budget"], s["Hoitotuotot"]["difference"]), (6000.0, 6500.0, -500.0))
        self.assertEqual(s["Hoitokulut"]["actual"], -2300.0)
        self.assertEqual(s["Hoitokulut"]["budget"], -1000.0)
        self.assertTrue(c["hasBudget"])

    def test_report_texts(self):
        c = ctx(budget_lines=[{"accountNumber": "3000", "amount": 6500}])
        r = {s["key"]: s for s in c["report"]}
        self.assertIn("1 500,00 €", r["repairs"]["text"])
        self.assertIn("Hoitotuotot olivat 6 000,00 € (talousarvio 6 500,00 €)", r["budget"]["text"])
        self.assertIn("410 000,00 €", r["finance"]["text"])
        self.assertIn("ylijäämä on 2 800,00 €", r["proposal"]["text"])
        self.assertTrue(r["general"]["needsInput"])
        self.assertFalse(r["proposal"]["needsInput"])

    def test_saved_text_overrides_auto(self):
        c = ctx(package={"report": {"general": "Oma teksti."}, "auditorName": "Tiina Tarkastaja", "auditorKind": "INSPECTOR"})
        g = next(s for s in c["report"] if s["key"] == "general")
        self.assertEqual(g["text"], "Oma teksti.")
        self.assertTrue(g["edited"])
        self.assertIn("Toiminnantarkastajana toimi Tiina Tarkastaja", g["auto"])

    def test_notes(self):
        n = {s["key"]: s["text"] for s in ctx()["notes"]}
        self.assertIn("Rakennus (tili 1010): menojäännöspoisto 4 %", n["fixed_assets"])
        self.assertIn("Osakepääoma: 1.1.2026 100 000,00 €, 31.12.2026 100 000,00 €", n["equity"])
        self.assertIn("ei vielä siirretty", n["equity"])
        self.assertIn("Lainat: 410 000,00 €", n["loans"])

    def test_journal_and_general_ledger(self):
        j = journal_rows(list(reversed(LEDGER)))
        self.assertEqual([e["voucher"] for e in j], ["AV-1", "M-1", "O-1", "O-2", "L-1"])
        self.assertEqual(j[4]["lines"][0]["account"], "2500")      # debet ensin
        gl = {a["account"]: a for a in general_ledger(LEDGER, NAMES)}
        self.assertEqual([r["balance"] for r in gl["1910"]["rows"]], [20000.0, 26000.0, 24500.0, 23700.0, 12800.0])
        self.assertEqual(gl["1910"]["label"], "1910 Pankkitili")

    def test_pdfs_render(self):
        c = ctx(budget_lines=[{"accountNumber": "3000", "amount": 6500}],
                package={"signers": [{"name": "Pekka Puheenjohtaja", "role": "hallituksen puheenjohtaja"}], "signPlace": "Espoo",
                         "signDate": "2027-03-01T00:00:00.000Z", "notes": {"collateral": "Kiinnitykset 500 000 € <ok> & muut"}})
        for pdf in (render_closing_package(c), render_balance_details(COMPANY, FY, balance_details(LEDGER, None, NAMES, {}), False),
                    render_journal(COMPANY, FY, journal_rows(LEDGER)), render_general_ledger(COMPANY, FY, general_ledger(LEDGER, NAMES))):
            self.assertTrue(pdf.startswith(b"%PDF"))
            self.assertGreater(len(pdf), 1500)


if __name__ == "__main__":
    unittest.main()
