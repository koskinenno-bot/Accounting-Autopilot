"""Raporttien puhtaat laskentafunktiot (ei riippuvuuksia, testattavissa)."""
from typing import Dict, List


def account_balances(ledger: List[Dict]) -> Dict[str, int]:
    """Tilikohtainen saldo (debet - kredit) SENTTEINÄ, jotta liukulukuvirheet eivät kerry."""
    balances: Dict[str, int] = {}
    for entry in ledger:
        for line in entry.get("lines", []):
            acc = str(line.get("accountNumber", ""))
            cents = round(float(line.get("debit") or 0) * 100) - round(float(line.get("credit") or 0) * 100)
            balances[acc] = balances.get(acc, 0) + cents
    return balances


def _num(acc: str) -> int:
    return int(acc[:4]) if acc[:4].isdigit() else -1


def _label(acc: str, names: Dict[str, str]) -> str:
    return f"{acc} {names[acc]}" if acc in names else acc


def _eur(cents: int) -> float:
    return round(cents / 100, 2)


def build_income_statement(balances: Dict[str, int], names: Dict[str, str]) -> Dict:
    revenue: Dict[str, float] = {}
    expenses: Dict[str, float] = {}
    rev_total = exp_total = 0
    for acc, cents in sorted(balances.items()):
        n = _num(acc)
        if 3000 <= n <= 3999:
            revenue[_label(acc, names)] = _eur(-cents)
            rev_total -= cents
        elif 4000 <= n <= 9999:
            expenses[_label(acc, names)] = _eur(cents)
            exp_total += cents
    return {
        "revenue": {"accounts": revenue, "total": _eur(rev_total)},
        "expenses": {"accounts": expenses, "total": _eur(exp_total)},
        "netProfit": _eur(rev_total - exp_total),
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
    if result_cents:
        equity["Tilikauden tulos (kirjaamaton)"] = _eur(result_cents)
        equity_total += result_cents
    return {
        "assets": {"accounts": assets, "total": _eur(assets_total)},
        "equity": {"accounts": equity, "total": _eur(equity_total)},
        "balanced": assets_total == equity_total,
    }


def build_maintenance_calculation(balances: Dict[str, int]) -> Dict:
    # Hoito- ja pääomarahoituksen erottelu (AOYL 10:5 §):
    # 3000-3899 hoitotuotot, 3900-3999 pääomavastikkeet/rahoitustuotot,
    # 4000-7999 hoitokulut, 8000-8999 rahoituskulut.
    m_income = m_exp = c_income = c_exp = 0
    for acc, cents in balances.items():
        n = _num(acc)
        if 3000 <= n <= 3899:
            m_income -= cents
        elif 3900 <= n <= 3999:
            c_income -= cents
        elif 4000 <= n <= 7999:
            m_exp += cents
        elif 8000 <= n <= 8999:
            c_exp += cents
    return {
        "maintenance_fund": {"income": _eur(m_income), "expenses": _eur(m_exp), "surplus": _eur(m_income - m_exp)},
        "capital_fund": {"income": _eur(c_income), "expenses": _eur(c_exp), "surplus": _eur(c_income - c_exp)},
    }
