"""
AsOyL 10:5 § — Vastikerahoituslaskelma (Income Financing Statement)
Lakisääteinen raportti asunto-osakeyhtiöille.

Osoittaa miten hoitovastikkeet ja muut tuotot on käytetty kattamaan yhtiön
hoitokulut tilikauden aikana.
"""
from datetime import date
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import JournalLine, Transaction, AccountCategory, HousingCompany
from security_utils import verify_company_access

router = APIRouter(
    prefix="/companies/{company_id}/reports/vastikelaskelma",
    tags=["Vastikelaskelma"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)


def _sum_journal_lines(
    company_id: int,
    code_start: int,
    code_end: int,
    side: str,
    year: int,
    session: Session,
) -> Dict[str, float]:
    """Sum JournalLine amounts by account_code for given code range, year, and side."""
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)

    # Get all transactions for company in year
    txs = session.exec(
        select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.date >= start_date,
            Transaction.date <= end_date,
            Transaction.is_verified == True,
        )
    ).all()
    tx_ids = [t.id for t in txs]

    if not tx_ids:
        return {}

    # Get journal lines for these transactions
    lines = session.exec(
        select(JournalLine).where(
            JournalLine.transaction_id.in_(tx_ids),
            JournalLine.side == side,
        )
    ).all()

    result: Dict[str, float] = {}
    for line in lines:
        try:
            code_int = int(line.account_code)
            if code_start <= code_int <= code_end:
                result[line.account_code] = result.get(line.account_code, 0.0) + line.amount
        except ValueError:
            continue
    return result


@router.get("/{year}")
def get_vastikelaskelma(
    company_id: int,
    year: int,
    session: Session = Depends(get_session),
):
    """
    AsOyL 10:5 § — Vastikerahoituslaskelma

    Lakisääteinen raportti joka osoittaa:
    - Hoitovastikkeiden kertymä (3000–3099)
    - Muut hoitotuotot (3100–3899)
    - Hoitokulut ryhmittäin (4000–8999)
    - Hoitokate (tuotot - kulut)

    Käytetään JournalLine-taulua (kahdenkertainen kirjanpito).
    """
    company = session.get(HousingCompany, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Yhtiötä ei löydy")

    # ── Revenue groups (CREDIT side) ──────────────────────────────────────────
    # 3000-3099 = Hoitovastikkeet
    # 3100-3999 = Muut hoitotuotot (vuokrat, saunamaksut, jne.)
    hoitovastikkeet = _sum_journal_lines(company_id, 3000, 3099, "CREDIT", year, session)
    muut_hoitotuotot = _sum_journal_lines(company_id, 3100, 3999, "CREDIT", year, session)

    # ── Expense groups (DEBIT side) — TALO-2024 4xxx–5xxx ────────────────────
    # AsOyL 10:5 § edellyttää seuraavan ryhmittelyn:
    henkilostokulut = _sum_journal_lines(company_id, 4000, 4099, "DEBIT", year, session)  # 4000, 4050
    hallintokulut   = _sum_journal_lines(company_id, 4100, 4199, "DEBIT", year, session)  # 4110, 4130, 4160
    kaytto_huolto   = _sum_journal_lines(company_id, 4200, 4299, "DEBIT", year, session)  # 4200
    ulkoalueet      = _sum_journal_lines(company_id, 4300, 4399, "DEBIT", year, session)  # 4300
    siivous         = _sum_journal_lines(company_id, 4400, 4499, "DEBIT", year, session)  # 4400
    lammitys        = _sum_journal_lines(company_id, 4500, 4599, "DEBIT", year, session)  # 4500
    vesi            = _sum_journal_lines(company_id, 4600, 4699, "DEBIT", year, session)  # 4600
    sahko           = _sum_journal_lines(company_id, 4700, 4799, "DEBIT", year, session)  # 4700
    jatehuolto      = _sum_journal_lines(company_id, 4800, 4899, "DEBIT", year, session)  # 4800
    vakuutukset     = _sum_journal_lines(company_id, 4900, 4999, "DEBIT", year, session)  # 4900
    kiinteistovero  = _sum_journal_lines(company_id, 5100, 5199, "DEBIT", year, session)  # 5100
    korjaukset      = _sum_journal_lines(company_id, 5200, 5999, "DEBIT", year, session)  # 5200-5230
    rahoituskulut   = _sum_journal_lines(company_id, 9300, 9990, "DEBIT", year, session)  # 9300, 9400

    # Get category names for display
    categories = {c.code: c.name for c in session.exec(select(AccountCategory)).all()}

    def _to_lines(code_dict: Dict[str, float]):
        return [
            {"code": code, "name": categories.get(code, code), "amount": round(amt, 2)}
            for code, amt in sorted(code_dict.items())
        ]

    total_tuotot = sum(hoitovastikkeet.values()) + sum(muut_hoitotuotot.values())
    total_kulut = (
        sum(henkilostokulut.values()) + sum(hallintokulut.values()) +
        sum(kaytto_huolto.values()) + sum(ulkoalueet.values()) +
        sum(siivous.values()) + sum(lammitys.values()) +
        sum(vesi.values()) + sum(sahko.values()) +
        sum(jatehuolto.values()) + sum(vakuutukset.values()) +
        sum(kiinteistovero.values()) + sum(korjaukset.values()) +
        sum(rahoituskulut.values())
    )
    hoitokate = round(total_tuotot - total_kulut, 2)

    return {
        "company_name": company.name,
        "business_id": company.business_id,
        "year": year,
        "legal_basis": "AsOyL 10:5 §",
        "generated_at": date.today().isoformat(),
        "tuotot": {
            "hoitovastikkeet":   {"lines": _to_lines(hoitovastikkeet),  "total": round(sum(hoitovastikkeet.values()), 2)},
            "muut_hoitotuotot":  {"lines": _to_lines(muut_hoitotuotot), "total": round(sum(muut_hoitotuotot.values()), 2)},
            "total": round(total_tuotot, 2),
        },
        "kulut": {
            "henkilostokulut":   {"lines": _to_lines(henkilostokulut),  "total": round(sum(henkilostokulut.values()), 2)},
            "hallintokulut":     {"lines": _to_lines(hallintokulut),    "total": round(sum(hallintokulut.values()), 2)},
            "kaytto_ja_huolto":  {"lines": _to_lines(kaytto_huolto),    "total": round(sum(kaytto_huolto.values()), 2)},
            "ulkoalueet":        {"lines": _to_lines(ulkoalueet),        "total": round(sum(ulkoalueet.values()), 2)},
            "siivous":           {"lines": _to_lines(siivous),           "total": round(sum(siivous.values()), 2)},
            "lammitys":          {"lines": _to_lines(lammitys),          "total": round(sum(lammitys.values()), 2)},
            "vesi":              {"lines": _to_lines(vesi),              "total": round(sum(vesi.values()), 2)},
            "sahko_ja_kaasu":    {"lines": _to_lines(sahko),             "total": round(sum(sahko.values()), 2)},
            "jatehuolto":        {"lines": _to_lines(jatehuolto),        "total": round(sum(jatehuolto.values()), 2)},
            "vakuutukset":       {"lines": _to_lines(vakuutukset),       "total": round(sum(vakuutukset.values()), 2)},
            "kiinteistovero":    {"lines": _to_lines(kiinteistovero),    "total": round(sum(kiinteistovero.values()), 2)},
            "korjaukset":        {"lines": _to_lines(korjaukset),        "total": round(sum(korjaukset.values()), 2)},
            "rahoituskulut":     {"lines": _to_lines(rahoituskulut),     "total": round(sum(rahoituskulut.values()), 2)},
            "total": round(total_kulut, 2),
        },
        "hoitokate": hoitokate,
        "hoitokate_selite": "Ylijäämä (tuotot > kulut)" if hoitokate >= 0 else "Alijäämä (kulut > tuotot)",
        "note": "AsOyL 10:5 §: Vastikerahoituslaskelma osoittaa hoitovastikkeiden riittävyyden.",
    }
