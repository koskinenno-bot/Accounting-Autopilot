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
    return round(cents / 100, 2) + 0.0  # + 0.0 muuttaa -0.0:n nollaksi


def _flip(v: float) -> float:
    return -v + 0.0


Ranges = List[Tuple[int, int]]


def _in(n: int, ranges: Ranges) -> bool:
    return any(lo <= n <= hi for lo, hi in ranges)


def _rows(balances: Dict[str, int], names: Dict[str, str], ranges: Ranges, sign: int,
          prev: Optional[Dict[str, int]] = None) -> Tuple[List[Dict], int, int]:
    """Alueen tilirivit. Vertailuvuoden kanssa mukana myös tilit, joilla on saldoa vain edellisenä vuonna.
    Palauttaa (rivit, summa, vertailuvuoden summa) senteinä."""
    accounts = set(balances) | set(prev or {})
    rows, total, prev_total = [], 0, 0
    for acc in sorted(accounts):
        cur, old = balances.get(acc, 0), (prev or {}).get(acc, 0)
        if (cur == 0 and old == 0) or not _in(_num(acc), ranges):
            continue
        row = {"account": acc, "label": _label(acc, names), "amount": _eur(sign * cur)}
        if prev is not None:
            row["previous"] = _eur(sign * old)
        rows.append(row)
        total += sign * cur
        prev_total += sign * old
    return rows, total, prev_total


def _section(title: str, rows: List[Dict], total: int, prev_total: int, prev: bool, **extra) -> Dict:
    sec = {"title": title, "rows": rows, "total": _eur(total), **extra}
    if prev:
        sec["previousTotal"] = _eur(prev_total)
    return sec


def _subtotal(title: str, total: int, prev_total: int, prev: bool) -> Dict:
    return _section(title, [], total, prev_total, prev, subtotal=True)


def _grouped(balances: Dict[str, int], names: Dict[str, str], groups: List[Tuple[str, Ranges]], sign: int,
             prev: Optional[Dict[str, int]]) -> Tuple[List[Dict], List[Dict], int, int]:
    """Kaavan erittelyryhmät (esim. hoitokulut: hallinto, lämmitys...). Tyhjät ryhmät jätetään pois."""
    out, all_rows, total, prev_total = [], [], 0, 0
    for title, ranges in groups:
        rows, t, pt = _rows(balances, names, ranges, sign, prev)
        if not rows:
            continue
        out.append(_section(title, rows, t, pt, prev is not None))
        all_rows += rows
        total += t
        prev_total += pt
    return out, all_rows, total, prev_total


def _neg(rows: List[Dict]) -> List[Dict]:
    return [{**r, "amount": _flip(r["amount"]), **({"previous": _flip(r["previous"])} if "previous" in r else {})} for r in rows]


def _neg_groups(groups: List[Dict]) -> List[Dict]:
    out = []
    for g in groups:
        ng = {**g, "rows": _neg(g["rows"]), "total": _flip(g["total"])}
        if "previousTotal" in g:
            ng["previousTotal"] = _flip(g["previousTotal"])
        out.append(ng)
    return out


# Numeroalueet (TATO-pohja, ks. accounting-service chartOfAccountsService.ts)
MAINT_INCOME = [(3000, 3899)]
MAINT_EXPENSE = [(4000, 6899), (7000, 7999)]
DEPRECIATION = [(6900, 6999)]
FIN_INCOME = [(3900, 3999)]
FIN_EXPENSE = [(8000, 8999)]
TAXES = [(9000, 9999)]

# Taloyhtiön tuloslaskelmakaavan erittelyt (KPA-asetus 1753/2015, liite: asunto-osakeyhtiön kaava).
# Ryhmien alueet kattavat koko pääalueen, joten jokainen tili osuu täsmälleen yhteen ryhmään.
MAINT_INCOME_GROUPS: List[Tuple[str, Ranges]] = [
    ("Vastikkeet", [(3000, 3099)]),
    ("Käyttökorvaukset", [(3100, 3499)]),
    ("Vuokratuotot", [(3500, 3599)]),
    ("Muut hoitotuotot", [(3600, 3899)]),
]
MAINT_EXPENSE_GROUPS: List[Tuple[str, Ranges]] = [
    ("Henkilöstökulut", [(4010, 4029)]),
    ("Hallinto", [(4000, 4009), (4030, 4099), (4900, 4999)]),
    ("Käyttö ja huolto", [(4100, 4199)]),
    ("Ulkoalueiden hoito", [(4200, 4249)]),
    ("Siivous", [(4250, 4299)]),
    ("Lämmitys", [(4500, 4599)]),
    ("Vesi ja jätevesi", [(4600, 4699)]),
    ("Sähkö ja kaasu", [(4700, 4799)]),
    ("Jätehuolto", [(4300, 4499)]),
    ("Vahinkovakuutukset", [(4800, 4849)]),
    ("Vuokrat", [(4850, 4869)]),
    ("Kiinteistövero", [(4870, 4899)]),
    ("Korjaukset", [(7000, 7899)]),
    ("Muut hoitokulut", [(5000, 6899), (7900, 7999)]),
]


def build_income_statement(balances: Dict[str, int], names: Dict[str, str],
                           prev: Optional[Dict[str, int]] = None) -> Dict:
    """Tuloslaskelma taloyhtiön kaavalla. prev = edellisen tilikauden saldot vertailutiedoiksi (KPL 3:1a §)."""
    p = prev is not None
    inc_groups, m_inc, m_inc_t, m_inc_p = _grouped(balances, names, MAINT_INCOME_GROUPS, -1, prev)
    exp_groups, m_exp, m_exp_t, m_exp_p = _grouped(balances, names, MAINT_EXPENSE_GROUPS, 1, prev)
    dep, dep_t, dep_p = _rows(balances, names, DEPRECIATION, 1, prev)
    f_inc, f_inc_t, f_inc_p = _rows(balances, names, FIN_INCOME, -1, prev)
    f_exp, f_exp_t, f_exp_p = _rows(balances, names, FIN_EXPENSE, 1, prev)
    tax, tax_t, tax_p = _rows(balances, names, TAXES, 1, prev)

    gross, gross_p = m_inc_t - m_exp_t, m_inc_p - m_exp_p              # hoitokate
    operating, operating_p = gross - dep_t, gross_p - dep_p            # liikevoitto (-tappio)
    before_tax, before_tax_p = operating + f_inc_t - f_exp_t, operating_p + f_inc_p - f_exp_p
    net, net_p = before_tax - tax_t, before_tax_p - tax_p

    revenue_t = m_inc_t + f_inc_t
    expense_t = m_exp_t + dep_t + f_exp_t + tax_t
    result = {
        # Yksinkertainen muoto (yhteensopiva aiemman dashboardin kanssa)
        "revenue": {"accounts": {r["label"]: r["amount"] for r in m_inc + f_inc}, "total": _eur(revenue_t)},
        "expenses": {"accounts": {r["label"]: r["amount"] for r in m_exp + dep + f_exp + tax}, "total": _eur(expense_t)},
        "netProfit": _eur(net),
        # Taloyhtiön tuloslaskelmakaava; kulut miinusmerkkisinä (rivit ja välisummat samalla merkillä)
        "sections": [
            _section("Hoitotuotot", m_inc, m_inc_t, m_inc_p, p, groups=inc_groups),
            _section("Hoitokulut", _neg(m_exp), -m_exp_t, -m_exp_p, p, groups=_neg_groups(exp_groups)),
            _subtotal("Hoitokate", gross, gross_p, p),
            _section("Poistot ja arvonalentumiset", _neg(dep), -dep_t, -dep_p, p),
            _subtotal("Liikevoitto (-tappio)", operating, operating_p, p),
            _section("Rahoitustuotot ja -kulut", f_inc + _neg(f_exp), f_inc_t - f_exp_t, f_inc_p - f_exp_p, p),
            _subtotal("Voitto (tappio) ennen tilinpäätössiirtoja ja veroja", before_tax, before_tax_p, p),
            _section("Tuloverot", _neg(tax), -tax_t, -tax_p, p),
            _subtotal("Tilikauden voitto (tappio)", net, net_p, p),
        ],
    }
    if p:
        result["previousNetProfit"] = _eur(net_p)
    return result


def _unbooked_result(balances: Dict[str, int]) -> int:
    """Tuloslaskelmatilien saldo, jota ei ole vielä siirretty omaan pääomaan (tuotot positiivisina)."""
    return -sum(c for a, c in balances.items() if 3000 <= _num(a) <= 9999)


def build_balance_sheet(balances: Dict[str, int], names: Dict[str, str],
                        prev: Optional[Dict[str, int]] = None) -> Dict:
    """Tase. balances ja prev ovat tilikauden lopun saldot (kumulatiivisesti avausviennit mukaan lukien)."""
    p = prev is not None
    assets: Dict[str, float] = {}
    equity: Dict[str, float] = {}
    assets_total = equity_total = 0
    for acc, cents in sorted(balances.items()):
        n = _num(acc)
        if 1000 <= n <= 1999:
            assets[_label(acc, names)] = _eur(cents)
            assets_total += cents
        elif 2000 <= n <= 2999:
            equity[_label(acc, names)] = _eur(-cents)
            equity_total -= cents
    # Kirjaamaton tilikauden tulos kuuluu omaan pääomaan, muuten tase ei täsmää.
    # (Tilinpäätösvienti siirtää tuloksen tilille 2200, jolloin tämä on nolla.)
    result_cents = _unbooked_result(balances)
    result_prev = _unbooked_result(prev) if p else 0
    if result_cents:
        equity["Tilikauden tulos (kirjaamaton)"] = _eur(result_cents)
        equity_total += result_cents

    tangible, tan_t, tan_p = _rows(balances, names, [(1000, 1099)], 1, prev)
    investments, inv_t, inv_p = _rows(balances, names, [(1100, 1499)], 1, prev)
    receivables, rec_t, rec_p = _rows(balances, names, [(1500, 1899), (1990, 1999)], 1, prev)
    cash, cash_t, cash_p = _rows(balances, names, [(1900, 1989)], 1, prev)
    own, own_t, own_p = _rows(balances, names, [(2000, 2399)], -1, prev)
    if result_cents or result_prev:
        row = {"account": "", "label": "Tilikauden voitto (tappio), kirjaamaton", "amount": _eur(result_cents)}
        if p:
            row["previous"] = _eur(result_prev)
        own.append(row)
        own_t += result_cents
        own_p += result_prev
    long_term, long_t, long_p = _rows(balances, names, [(2400, 2699)], -1, prev)
    short_term, short_t, short_p = _rows(balances, names, [(2700, 2999)], -1, prev)

    fixed_groups = [g for g in (
        _section("Aineelliset hyödykkeet", tangible, tan_t, tan_p, p),
        _section("Sijoitukset", investments, inv_t, inv_p, p),
    ) if g["rows"]]
    result = {
        "assets": {"accounts": assets, "total": _eur(assets_total)},
        "equity": {"accounts": equity, "total": _eur(equity_total)},
        "balanced": assets_total == equity_total,
        "sections": {
            "assets": [
                _section("Pysyvät vastaavat", tangible + investments, tan_t + inv_t, tan_p + inv_p, p, groups=fixed_groups),
                _section("Vaihtuvat vastaavat: saamiset", receivables, rec_t, rec_p, p),
                _section("Vaihtuvat vastaavat: rahat ja pankkisaamiset", cash, cash_t, cash_p, p),
            ],
            "liabilities": [
                _section("Oma pääoma", own, own_t, own_p, p),
                _section("Vieras pääoma: pitkäaikainen", long_term, long_t, long_p, p),
                _section("Vieras pääoma: lyhytaikainen", short_term, short_t, short_p, p),
            ],
        },
    }
    if p:
        result["previousTotal"] = _eur(tan_p + inv_p + rec_p + cash_p)
    return result


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
