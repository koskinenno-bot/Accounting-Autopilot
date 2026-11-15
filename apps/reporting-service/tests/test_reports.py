"""Aja: python -m unittest discover -s tests   (reporting-service-kansiossa)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from reports import (account_balances, build_balance_sheet, build_income_statement,  # noqa: E402
                     build_maintenance_calculation, loan_repayments)


def entry(*lines):
    return {"lines": [{"accountNumber": a, "debit": d, "credit": c} for a, d, c in lines]}


LEDGER = [
    entry(("1700", "450.00", "0"), ("3000", "0", "450.00")),     # vastikelasku
    entry(("1900", "450.00", "0"), ("1700", "0", "450.00")),     # suoritus
    entry(("4500", "120.10", "0"), ("2800", "0", "120.10")),     # lämpölasku
    entry(("3900", "0", "200.00"), ("1900", "200.00", "0")),     # pääomavastike
    entry(("8000", "50.00", "0"), ("1900", "0", "50.00")),       # lainan korko
]


class ReportTests(unittest.TestCase):
    def test_balances_in_cents(self):
        b = account_balances([entry(("1900", "0.10", "0"), ("1900", "0.20", "0"), ("3000", "0", "0.30"))])
        self.assertEqual(b["1900"], 30)
        self.assertEqual(b["3000"], -30)

    def test_income_statement(self):
        r = build_income_statement(account_balances(LEDGER), {"3000": "Hoitovastikkeet"})
        self.assertEqual(r["revenue"]["total"], 650.0)
        self.assertEqual(r["revenue"]["accounts"]["3000 Hoitovastikkeet"], 450.0)
        self.assertEqual(r["expenses"]["total"], 170.1)
        self.assertEqual(r["netProfit"], 479.9)

    def test_balance_sheet_balances(self):
        r = build_balance_sheet(account_balances(LEDGER), {})
        self.assertTrue(r["balanced"])
        self.assertEqual(r["assets"]["total"], r["equity"]["total"])
        self.assertEqual(r["assets"]["accounts"]["1900"], 600.0)

    def test_maintenance_calculation_separates_funds(self):
        r = build_maintenance_calculation(account_balances(LEDGER))
        self.assertEqual(r["maintenance_fund"], {"income": 450.0, "expenses": 120.1, "surplus": 329.9})
        self.assertEqual(r["capital_fund"], {"income": 200.0, "expenses": 50.0, "surplus": 150.0, "loanRepayments": 0.0})

    def test_income_statement_housing_company_format(self):
        ledger = LEDGER + [entry(("6900", "100.00", "0"), ("1010", "0", "100.00"))]  # poisto
        sections = {s["title"]: s["total"] for s in build_income_statement(account_balances(ledger), {})["sections"]}
        self.assertEqual(sections["Hoitotuotot"], 450.0)
        self.assertEqual(sections["Hoitokulut"], -120.1)
        self.assertEqual(sections["Hoitokate"], 329.9)
        self.assertEqual(sections["Poistot ja arvonalentumiset"], -100.0)
        self.assertEqual(sections["Liikevoitto (-tappio)"], 229.9)
        self.assertEqual(sections["Rahoitustuotot ja -kulut"], 150.0)
        self.assertEqual(sections["Tilikauden voitto (tappio)"], 379.9)

    def test_depreciation_and_loan_repayments_in_maintenance_calculation(self):
        ledger = LEDGER + [
            entry(("6900", "100.00", "0"), ("1010", "0", "100.00")),            # poisto: ei vastikerahoitusta
            {"entryType": "NORMAL", "lines": [{"accountNumber": "2500", "debit": "300.00", "credit": "0"},
                                              {"accountNumber": "1900", "debit": "0", "credit": "300.00"}]},
            {"entryType": "OPENING", "lines": [{"accountNumber": "2500", "debit": "999.00", "credit": "0"}]},
        ]
        r = build_maintenance_calculation(account_balances(ledger), loan_repayments(ledger))
        self.assertEqual(r["maintenance_fund"]["expenses"], 120.1)
        self.assertEqual(r["capital_fund"]["expenses"], 350.0)
        self.assertEqual(r["capital_fund"]["loanRepayments"], 300.0)

    def test_balance_sheet_sections(self):
        r = build_balance_sheet(account_balances(LEDGER), {})
        cash = r["sections"]["assets"][2]
        self.assertEqual(cash["total"], 600.0)
        short = r["sections"]["liabilities"][2]
        self.assertEqual(short["total"], 120.1)

    def test_non_numeric_account_is_ignored(self):
        r = build_maintenance_calculation({"ABC": 100})
        self.assertEqual(r["maintenance_fund"]["income"], 0)



class FormulaTests(unittest.TestCase):
    def test_expense_groups_follow_formula(self):
        b = account_balances([
            entry(("4000", "100", "0"), ("4500", "300", "0"), ("4510", "20", "0"), ("4300", "40", "0"),
                  ("7000", "500", "0"), ("4010", "60", "0"), ("1900", "0", "1020")),
        ])
        r = build_income_statement(b, {"4500": "Lämmitys"})
        exp = r["sections"][1]
        titles = [g["title"] for g in exp["groups"]]
        self.assertEqual(titles, ["Henkilöstökulut", "Hallinto", "Lämmitys", "Jätehuolto", "Korjaukset"])
        heat = next(g for g in exp["groups"] if g["title"] == "Lämmitys")
        self.assertEqual(heat["total"], -320.0)
        self.assertEqual(sum(g["total"] for g in exp["groups"]), exp["total"])
        self.assertEqual(exp["total"], -1020.0)
        self.assertEqual([r["account"] for r in exp["rows"]], ["4010", "4000", "4500", "4510", "4300", "7000"])

    def test_every_expense_account_lands_in_one_group(self):
        from reports import MAINT_EXPENSE, MAINT_EXPENSE_GROUPS, MAINT_INCOME, MAINT_INCOME_GROUPS
        for main, groups in ((MAINT_EXPENSE, MAINT_EXPENSE_GROUPS), (MAINT_INCOME, MAINT_INCOME_GROUPS)):
            for n in range(3000, 10000):
                in_main = any(lo <= n <= hi for lo, hi in main)
                hits = sum(any(lo <= n <= hi for lo, hi in rs) for _, rs in groups)
                self.assertEqual(hits, 1 if in_main else 0, n)

    def test_comparison_year(self):
        prev = account_balances([entry(("1900", "300", "0"), ("3000", "0", "300")),
                                 entry(("4600", "80", "0"), ("1900", "0", "80"))])
        cur = account_balances(LEDGER)
        r = build_income_statement(cur, {}, prev)
        inc = r["sections"][0]
        self.assertEqual(inc["previousTotal"], 300.0)
        self.assertEqual(inc["total"], 450.0)
        exp = r["sections"][1]
        water = next(row for row in exp["rows"] if row["account"] == "4600")
        self.assertEqual((water["amount"], water["previous"]), (0.0, -80.0))  # vain vertailuvuonna
        self.assertEqual(r["previousNetProfit"], 220.0)
        self.assertEqual(r["sections"][-1]["previousTotal"], 220.0)
        # Ilman vertailuvuotta avaimia ei ole (vanha muoto ennallaan)
        plain = build_income_statement(cur, {})
        self.assertNotIn("previousTotal", plain["sections"][0])
        self.assertNotIn("previous", plain["sections"][0]["rows"][0])

    def test_balance_sheet_comparison_and_groups(self):
        prev = account_balances([entry(("1010", "1000", "0"), ("2500", "0", "1000"))])
        cur = account_balances([entry(("1010", "1000", "0"), ("2500", "0", "1000")),
                                entry(("1100", "50", "0"), ("1900", "0", "50"))])
        r = build_balance_sheet(cur, {}, prev)
        fixed = r["sections"]["assets"][0]
        self.assertEqual([g["title"] for g in fixed["groups"]], ["Aineelliset hyödykkeet", "Sijoitukset"])
        self.assertEqual((fixed["total"], fixed["previousTotal"]), (1050.0, 1000.0))
        self.assertEqual(r["previousTotal"], 1000.0)
        liab_prev = sum(s["previousTotal"] for s in r["sections"]["liabilities"])
        self.assertEqual(liab_prev, 1000.0)

    def test_pdf_with_comparison(self):
        from pdf import render_report
        fy = {"startDate": "2026-01-01", "endDate": "2026-12-31", "status": "OPEN"}
        pfy = {"startDate": "2025-01-01", "endDate": "2025-12-31", "status": "CLOSED"}
        b = account_balances(LEDGER)
        for kind, data in (("income-statement", build_income_statement(b, {}, b)),
                           ("balance-sheet", build_balance_sheet(b, {}, b)),
                           ("maintenance-calculation", {**build_maintenance_calculation(b),
                                                        "previous": build_maintenance_calculation(b)})):
            pdf = render_report(kind, data, "As Oy Testi", fy, pfy)
            self.assertTrue(pdf.startswith(b"%PDF"), kind)
            self.assertTrue(render_report(kind, data, "As Oy Testi", fy).startswith(b"%PDF"))

if __name__ == "__main__":
    unittest.main()
