"""Avainsanapohjainen tiliöintiehdotus (ei riippuvuuksia, testattavissa)."""
import re
from typing import Dict, List

# Avainsana -> tili. Tilinumerot vastaavat accounting-servicen TATO_TEMPLATE-tilikarttaa
# (apps/accounting-service/src/services/chartOfAccountsService.ts). Pidä synkronissa.
# Aiemmin tilit (5000, 5100, 8000, 9999 ...) puuttuivat tilikartasta, joten jokainen
# ehdotus päätyi selvitettäviin eriin.
KNOWLEDGE_BASE = {
    "vastike": {"code": "3000", "label": "Hoitovastikkeet"},
    "vesimaksu": {"code": "3100", "label": "Vesimaksut"},
    "pysäk": {"code": "3200", "label": "Autopaikkamaksut"},
    "autopaikka": {"code": "3200", "label": "Autopaikkamaksut"},
    "sauna": {"code": "3300", "label": "Saunamaksut"},
    "isännöin": {"code": "4000", "label": "Hallinto ja isännöinti"},
    "huolto": {"code": "4100", "label": "Kiinteistönhoito ja huolto"},
    "hsy": {"code": "4300", "label": "Puhtaanapito ja jätehuolto (HSY)"},
    "jäte": {"code": "4300", "label": "Puhtaanapito ja jätehuolto"},
    # Pidemmät yhdyssanat voittavat lyhyemmät osumat: "jätevesi" on vettä (ei "jäte"),
    # "jätehuolto" on jätehuoltoa (ei kiinteistön "huolto").
    "jätevesi": {"code": "4600", "label": "Vesi ja jätevesi"},
    "jätehuolto": {"code": "4300", "label": "Puhtaanapito ja jätehuolto"},
    "kiinteistöhuolto": {"code": "4100", "label": "Kiinteistönhoito ja huolto"},
    # Siivouksella on oma tili ja kaavan rivi (aiemmin 4300 jätehuolto)
    "siivous": {"code": "4250", "label": "Siivous"},
    "lumityö": {"code": "4210", "label": "Lumityöt ja liukkauden torjunta"},
    "hiekoitus": {"code": "4210", "label": "Lumityöt ja liukkauden torjunta"},
    "liukkauden": {"code": "4210", "label": "Lumityöt ja liukkauden torjunta"},
    "tilintarkastus": {"code": "4030", "label": "Tilintarkastus ja toiminnantarkastus"},
    "toiminnantarkastus": {"code": "4030", "label": "Tilintarkastus ja toiminnantarkastus"},
    "hissi": {"code": "4120", "label": "Hissien huolto"},
    "kiinteistövero": {"code": "4870", "label": "Kiinteistövero"},
    "lämpö": {"code": "4500", "label": "Lämmitys"},
    "kaukolämpö": {"code": "4500", "label": "Lämmitys"},
    "helen": {"code": "4500", "label": "Lämmitys (Helen)"},
    "vesi": {"code": "4600", "label": "Vesi ja jätevesi"},
    "sähkö": {"code": "4700", "label": "Sähkö ja kaasu"},
    "fortum": {"code": "4700", "label": "Sähkö ja kaasu (Fortum)"},
    "vakuutus": {"code": "4800", "label": "Vakuutukset"},
    "if": {"code": "4800", "label": "Vakuutukset (If)"},
    # Pelkkä "pankki" osui myös maksun saajan nimeen (esim. "Rahoituspankki Oyj"), jolloin lainan
    # lyhennykset ja korot kirjautuivat pankkikuluiksi. Nyt vain kuluun viittaavat sanat.
    "pankkikulu": {"code": "4900", "label": "Pankkikulut"},
    "palvelumaksu": {"code": "4900", "label": "Pankkikulut"},
    "tilinhoitomaksu": {"code": "4900", "label": "Pankkikulut"},
    "korjaus": {"code": "7000", "label": "Korjaukset"},
    "remontti": {"code": "7000", "label": "Korjaukset"},
    "korko": {"code": "8000", "label": "Lainojen korot"},
    # Lainan lyhennys pienentää velkaa (tase), se ei ole kulu
    "lyhennys": {"code": "2500", "label": "Lainat rahoituslaitoksilta (lyhennys)"},
}

# Lähtevän maksun sallitut tilit: kulut sekä lainan lyhennys
LOAN_ACCOUNTS = {"2500"}

SUSPENSE_ACCOUNT = {"code": "1990", "label": "Selvitettävät erät"}

# Lyhyet avainsanat (esim. "if") osuisivat moniin sanoihin ("tarif..."), joten ne vaativat kokonaisen sanan.
_WHOLE_WORD_MAX_LEN = 3


def keyword_matches(keyword: str, text: str) -> bool:
    if len(keyword) <= _WHOLE_WORD_MAX_LEN:
        return re.search(rf"(?<![\wåäö]){re.escape(keyword)}(?![\wåäö])", text) is not None
    return keyword in text


def is_expense_account(code: str) -> bool:
    """Hoito- ja rahoituskulut 4000-8999 (TATO-tilikartan numeroalueet)."""
    return code.isdigit() and 4000 <= int(code) <= 8999


def is_outgoing_payment_account(code: str) -> bool:
    """Lähtevän pankkimaksun tili: kulu tai lainan lyhennys."""
    return is_expense_account(code) or code in LOAN_ACCOUNTS


def is_revenue_account(code: str) -> bool:
    return code.isdigit() and 3000 <= int(code) <= 3999


def match_keywords(text: str) -> List[Dict]:
    """Palauttaa osuneet tiedot, pisin (tarkin) avainsana ensin."""
    text = text.lower()
    hits = [(kw, info) for kw, info in KNOWLEDGE_BASE.items() if keyword_matches(kw, text)]
    hits.sort(key=lambda kv: len(kv[0]), reverse=True)
    return [info for _, info in hits]
