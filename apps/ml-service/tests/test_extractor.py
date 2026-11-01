"""Aja: python -m unittest discover -s tests   (ml-service-kansiossa)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from extractor import parse_invoice_text  # noqa: E402

SAMPLE = """Helen Oy
Y-tunnus: 2630226-0
Salmisaarenaukio 1, 00180 Helsinki
LASKU
Laskun numero: 7700123
Laskun päivämäärä: 30.9.2026
Eräpäivä: 14.10.2026
Laskutuskausi: 1.9.2026 - 30.9.2026
Kaukolämpö syyskuu 1 452,36 €
ALV 0 % 0,00 €
Yhteensä 1 452,36 €
Viitenumero: 11112 22223
Tilinumero: FI21 1234 5600 0007 85
"""

ACCOUNTS = [{"accountNumber": n, "accountName": "x"} for n in ("1990", "4500", "4600")]


class ParseInvoiceTests(unittest.TestCase):
    def test_fields(self):
        r = parse_invoice_text(SAMPLE, ACCOUNTS)
        self.assertEqual(r["supplierName"], "Helen Oy")
        self.assertEqual(r["supplierBusinessId"], "2630226-0")
        self.assertEqual(r["invoiceNumber"], "7700123")
        self.assertEqual(r["invoiceDate"], "2026-09-30")
        self.assertEqual(r["dueDate"], "2026-10-14")
        self.assertEqual((r["servicePeriodStart"], r["servicePeriodEnd"]), ("2026-09-01", "2026-09-30"))
        self.assertAlmostEqual(r["totalAmount"], 1452.36)
        self.assertEqual(r["referenceNumber"], "1111222223")
        self.assertEqual(r["iban"], "FI2112345600000785")
        self.assertEqual(r["suggestedAccount"], "4500")

    def test_heuristic_never_auto_approvable(self):
        # sääntöpohjainen luku jää aina automaattirajan (0.8) alle
        self.assertLess(parse_invoice_text(SAMPLE, ACCOUNTS)["confidence"], 0.8)

    def test_unknown_account_falls_back_to_suspense(self):
        r = parse_invoice_text(SAMPLE, [{"accountNumber": "1990", "accountName": "x"}])
        self.assertEqual(r["suggestedAccount"], "1990")

    def test_total_on_next_line_and_expense_account_only(self):
        # PDF:ssä oikealle tasattu summa on omalla rivillään; "vesimaksu" ei saa johtaa tuottotiliin 3100
        text = "Esimerkin Vesi Oy\nLaskun päivämäärä: 2.11.2026\nEräpäivä: 16.11.2026\n" \
               "Vesi- ja jätevesimaksu lokakuu 2026\n402,15 €\nYhteensä\n402,15 €\n"
        r = parse_invoice_text(text, [{"accountNumber": n, "accountName": "x"} for n in ("1990", "3100", "4600")])
        self.assertAlmostEqual(r["totalAmount"], 402.15)
        self.assertEqual(r["suggestedAccount"], "4600")

    def test_missing_fields_are_null(self):
        r = parse_invoice_text("Tuntematon Oy\nkiitos tilauksesta")
        self.assertIsNone(r["totalAmount"])
        self.assertIsNone(r["dueDate"])
        self.assertLess(r["confidence"], 0.5)


if __name__ == "__main__":
    unittest.main()
