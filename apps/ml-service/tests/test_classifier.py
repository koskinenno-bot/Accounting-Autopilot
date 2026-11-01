"""Aja: python -m unittest discover -s tests   (ml-service-kansiossa)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from classifier import KNOWLEDGE_BASE, match_keywords  # noqa: E402

# Pidä synkronissa: apps/accounting-service/src/services/chartOfAccountsService.ts
TATO_ACCOUNTS = {"1990", "3000", "3100", "3200", "3300", "3900", "3950", "4000", "4100", "4300",
                 "4500", "4600", "4700", "4800", "4900", "7000", "8000"}


class ClassifierTests(unittest.TestCase):
    def test_all_codes_exist_in_chart_of_accounts(self):
        for kw, info in KNOWLEDGE_BASE.items():
            self.assertIn(info["code"], TATO_ACCOUNTS, f"avainsanan '{kw}' tili puuttuu tilikartasta")

    def test_longest_keyword_wins(self):
        self.assertEqual(match_keywords("Vesimaksu huhtikuu")[0]["code"], "3100")
        self.assertEqual(match_keywords("Kaukolämpö 03/2026")[0]["code"], "4500")

    def test_compound_words(self):
        # pankkitapahtuman kuvaus = saaja + viesti (accounting-servicen bankConsumer)
        self.assertEqual(match_keywords("hsy vesi ja jätevesi 09/2026")[0]["code"], "4600")
        self.assertEqual(match_keywords("hsy jätehuolto jätehuolto 09/2026")[0]["code"], "4300")
        self.assertEqual(match_keywords("kiinteistöhuolto oy esimerkki huolto 10/2026")[0]["code"], "4100")

    def test_short_keyword_needs_whole_word(self):
        self.assertEqual(match_keywords("If Vahinkovakuutus")[0]["code"], "4800")
        self.assertEqual(match_keywords("tariffimuutos"), [])

    def test_no_match(self):
        self.assertEqual(match_keywords("tuntematon lasku"), [])


if __name__ == "__main__":
    unittest.main()
