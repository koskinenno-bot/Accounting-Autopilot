"""Raporttien puhtaat laskentafunktiot (ei riippuvuuksia, testattavissa).

Tuloslaskelma ja tase asunto-osakeyhtiön kaavan mukaan (KPA-asetus 1753/2015, taloyhtiöiden
tilikarttapohja): hoitotuotot - hoitokulut = hoitokate, poistot, rahoituserät, tilikauden tulos.
Vastikelaskelma AOYL 10:5 §:n mukaan hoito- ja pääomarahoitukseen eriteltynä.
"""
from typing import Dict, List, Optional, Tuple


def account_balances(ledger: List[Dict]) -> Dict[str, int]:
    """Tilikohtainen saldo (debet - kredit) SENTTEINÄ, jotta liukulukuvirheet eivät kerry."""
    balances: Dict[str, int] = {}
    for entry in ledger:
        for line in entry.get("lines", []):
            acc = str(line.get("accountNumber", ""))
            cents = round(float(line.get("debit") or 0) * 100) - round(float(line.get("credit") or 0) * 100)
            balances[acc] = balances.get(acc, 0) + cents
    return balances


def loan_repayments(ledger: List[Dict]) -> int:
    """Lainojen lyhennykset senteinä: debet-kirjaukset pitkäaikaisille lainatileille (2400-2699),
    pois lukien avaus- ja tilinpäätösviennit."""
    total = 0
    for entry in ledger:
        if entry.get("entryType") in ("OPENING", "CLOSING"):
            continue
        for line in entry.get("lines", []):
            if 2400 <= _num(str(line.get("accountNumber", ""))) <= 2699:
                total += round(float(line.get("debit") or 0) * 100)
    return total


def _num(acc: str) -> int:
    return int(acc[:4]) if acc[:4].isdigit() else -1


def _label(acc: str, names: Dict[str, str]) -> str:
    return f"{acc} {names[acc]}" if acc in names else acc


def _eur(cents: int) -> float:
    return round(cents / 100, 2)


def _rows(balances: Dict[str, int], names: Dict[str, str], ranges: List[Tuple[int, int]], sign: int,
          exclude: Optional[List[Tuple[int, int]]] = None) -> Tuple[List[Dict], int]:
    rows, total = [], 0
    for acc, cents in sorted(balances.items()):
        n = _num(acc)
        if cents == 0 or not any(lo <= n <= hi for lo, hi in ranges):
            continue
        if exclude and any(lo <= n <= hi for lo, hi in exclude):
            continue
        rows.append({"account": acc, "label": _label(acc, names), "amount": _eur(sign * cents)})
        total += sign * cents
    return rows, total


# Numeroalueet (TATO-pohja, ks. accounting-service chartOfAccountsService.ts)
MAINT_INCOME = [(3000, 3899)]
MAINT_EXPENSE = [(4000, 6899), (7000, 7999)]
DEPRECIATION = [(6900, 6999)]
FIN_INCOME = [(3900, 3999)]
FIN_EXPENSE = [(8000, 8999)]
TAXES = [(9000, 9999)]


def build_income_statement(balances: Dict[str, int], names: Dict[str, str]) -> Dict:
    m_inc, m_inc_t = _rows(balances, names, MAINT_INCOME, -1)
    m_exp, m_exp_t = _rows(balances, names, MAINT_EXPENSE, 1)
    dep, dep_t = _rows(balances, names, DEPRECIATION, 1)
    f_inc, f_inc_t = _rows(balances, names, FIN_INCOME, -1)
    f_exp, f_exp_t = _rows(balances, names, FIN_EXPENSE, 1)
    tax, tax_t = _rows(balances, names, TAXES, 1)

    gross = m_inc_t - m_exp_t            # hoitokate
    operating = gross - dep_t            # liikevoitto (-tappio)
    before_tax = operating + f_inc_t - f_exp_t
    net = before_tax - tax_t

    revenue_t = m_inc_t + f_inc_t
    expense_t = m_exp_t + dep_t + f_exp_t + tax_t
    # Kaavassa kulut esitetään miinusmerkkisinä (rivit ja välisummat samalla merkillä)
    neg = lambda rows: [{**r, "amount": -r["amount"]} for r in rows]  # noqa: E731
    return {
        # Yksinkertainen muoto (yhteensopiva aiemman dashboardin kanssa)
        "revenue": {"accounts": {r["label"]: r["amount"] for r in m_inc + f_inc}, "total": _eur(revenue_t)},
        "expenses": {"accounts": {r["label"]: r["amount"] for r in m_exp + dep + f_exp + tax}, "total": _eur(expense_t)},
        "netProfit": _eur(net),
        # Taloyhtiön tuloslaskelmakaava
        "sections": [
            {"title": "Hoitotuotot", "rows": m_inc, "total": _eur(m_inc_t)},
            {"title": "Hoitokulut", "rows": neg(m_exp), "total": _eur(-m_exp_t)},
            {"title": "Hoitokate", "subtotal": True, "total": _eur(gross)},
            {"title": "Poistot ja arvonalentumiset", "rows": neg(dep), "total": _eur(-dep_t)},
            {"title": "Liikevoitto (-tappio)", "subtotal": True, "total": _eur(operating)},
            {"title": "Rahoitustuotot ja -kulut", "rows": f_inc + neg(f_exp), "total": _eur(f_inc_t - f_exp_t)},
            {"title": "Voitto (tappio) ennen tilinpäätössiirtoja ja veroja", "subtotal": True, "total": _eur(before_tax)},
            {"title": "Tuloverot", "rows": neg(tax), "total": _eur(-tax_t)},
            {"title": "Tilikauden voitto (tappio)", "subtotal": True, "total": _eur(net)},
        ],
    }


def build_balance_sheet(balances: Dict[str, int], names: Dict[str, str]) -> Dict:
    assets: Dict[str, float] = {}
    equity: Dict[str, float] = {}
    assets_total = equity_total = 0
    result_cents = 0
    for acc, cents in sorted(balances.items()):
        n = _num(acc)
        if 1000 <= n <= 1999:
            assets[_label(acc, names)] = _eur(cents)
            assets_total += cents
        elif 2000 <= n <= 2999:
            equity[_label(acc, names)] = _eur(-cents)
            equity_total -= cents
        elif 3000 <= n <= 9999:
            result_cents -= cents  # tuotot (kredit) positiivisina
    # Kirjaamaton tilikauden tulos kuuluu omaan pääomaan, muuten tase ei täsmää.
    # (Tilinpäätösvienti siirtää tuloksen tilille 2200, jolloin tämä on nolla.)
    if result_cents:
        equity["Tilikauden tulos (kirjaamaton)"] = _eur(result_cents)
        equity_total += result_cents

    fixed, fixed_t = _rows(balances, names, [(1000, 1499)], 1)
    receivables, rec_t = _rows(balances, names, [(1500, 1899), (1990, 1999)], 1)
    cash, cash_t = _rows(balances, names, [(1900, 1989)], 1)
    own, own_t = _rows(balances, names, [(2000, 2399)], -1)
    if result_cents:
        own.append({"account": "", "label": "Tilikauden voitto (tappio), kirjaamaton", "amount": _eur(result_cents)})
        own_t += result_cents
    long_term, long_t = _rows(balances, names, [(2400, 2699)], -1)
    short_term, short_t = _rows(balances, names, [(2700, 2999)], -1)

    return {
        "assets": {"accounts": assets, "total": _eur(assets_total)},
        "equity": {"accounts": equity, "total": _eur(equity_total)},
        "balanced": assets_total == equity_total,
        "sections": {
            "assets": [
                {"title": "Pysyvät vastaavat", "rows": fixed, "total": _eur(fixed_t)},
                {"title": "Vaihtuvat vastaavat: saamiset", "rows": receivables, "total": _eur(rec_t)},
                {"title": "Vaihtuvat vastaavat: rahat ja pankkisaamiset", "rows": cash, "total": _eur(cash_t)},
            ],
            "liabilities": [
                {"title": "Oma pääoma", "rows": own, "total": _eur(own_t)},
                {"title": "Vieras pääoma: pitkäaikainen", "rows": long_term, "total": _eur(long_t)},
                {"title": "Vieras pääoma: lyhytaikainen", "rows": short_term, "total": _eur(short_t)},
            ],
        },
    }


def build_maintenance_calculation(balances: Dict[str, int], repayments_cents: int = 0) -> Dict:
    # Hoito- ja pääomarahoituksen erottelu (AOYL 10:5 §):
    # 3000-3899 hoitotuotot, 3900-3999 pääomavastikkeet/rahoitustuotot,
    # 4000-7999 hoitokulut (poistot 6900-6999 eivät ole rahoitusta vaativia menoja),
    # 8000-8999 rahoituskulut + lainojen lyhennykset pääomarahoituksessa.
    m_income = m_exp = c_income = c_exp = 0
    for acc, cents in balances.items():
        n = _num(acc)
        if 3000 <= n <= 3899:
            m_income -= cents
        elif 3900 <= n <= 3999:
            c_income -= cents
        elif 4000 <= n <= 7999 and not 6900 <= n <= 6999:
            m_exp += cents
        elif 8000 <= n <= 8999:
            c_exp += cents
    c_exp += repayments_cents
    return {
        "maintenance_fund": {"income": _eur(m_income), "expenses": _eur(m_exp), "surplus": _eur(m_income - m_exp)},
        "capital_fund": {"income": _eur(c_income), "expenses": _eur(c_exp), "surplus": _eur(c_income - c_exp),
                         "loanRepayments": _eur(repayments_cents)},
    }
