"""Aja: python -m unittest discover -s tests   (reporting-service-kansiossa)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from reports import (account_balances, build_balance_sheet, build_income_statement,  # noqa: E402
                     build_maintenance_calculation)


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
        self.assertEqual(r["capital_fund"], {"income": 200.0, "expenses": 50.0, "surplus": 150.0})

    def test_non_numeric_account_is_ignored(self):
        r = build_maintenance_calculation({"ABC": 100})
        self.assertEqual(r["maintenance_fund"]["income"], 0)


if __name__ == "__main__":
    unittest.main()
