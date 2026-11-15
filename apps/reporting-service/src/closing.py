"""Tilinpäätöspaketin sisältö (puhtaat funktiot, testattavissa).

Paketti: toimintakertomus, tuloslaskelma, tase, vastikelaskelma (As Oy), liitetiedot, allekirjoitukset ja
tilinpäätösmerkintä sekä erikseen tase-erittelyt, päiväkirja ja pääkirja. Tekstiosioista tehdään automaattinen
pohja kirjanpidon luvuista; käyttäjän tallentama teksti korvaa pohjan. Hakasulkeissa oleva teksti [näin]
tarkoittaa kohtaa, jonka käyttäjän pitää täydentää.
"""
import re
from typing import Dict, List, Optional

from reports import _eur, _num, build_income_statement

PLACEHOLDER = re.compile(r"\[[^\]]+\]")
RESULT_ACCOUNT = "2200"       # tilikauden tulos (accounting-service closing.ts)
RETAINED_EARNINGS = "2100"    # edellisten tilikausien voitto/tappio


def eur_text(v: float) -> str:
    s = f"{abs(v):,.2f}".replace(",", " ").replace(".", ",")
    return f"{'-' if v < 0 else ''}{s} €"


def fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return ""
    y, m, d = iso[:10].split("-")
    return f"{int(d)}.{int(m)}.{y}"


def period_text(fy: Optional[Dict]) -> str:
    return f"{fmt_date(fy['startDate'])}–{fmt_date(fy['endDate'])}" if fy else ""


# --- Tase-erittelyt -----------------------------------------------------------------------------------------

BALANCE_GROUPS = [
    ("Aineelliset hyödykkeet", [(1000, 1099)]),
    ("Sijoitukset", [(1100, 1499)]),
    ("Saamiset", [(1500, 1899), (1990, 1999)]),
    ("Rahat ja pankkisaamiset", [(1900, 1989)]),
    ("Oma pääoma", [(2000, 2399)]),
    ("Vieras pääoma: pitkäaikainen", [(2400, 2699)]),
    ("Vieras pääoma: lyhytaikainen", [(2700, 2999)]),
]


def balance_group(acc: str) -> str:
    n = _num(acc)
    for title, ranges in BALANCE_GROUPS:
        if any(lo <= n <= hi for lo, hi in ranges):
            return title
    return "Muut"


def balance_details(ledger: List[Dict], prev_balances: Optional[Dict[str, int]], names: Dict[str, str],
                    notes: Dict[str, str]) -> List[Dict]:
    """Taseen tilit: avaava saldo, kauden debet ja kredit, päättävä saldo, vertailu ja selite.
    Saldot luonnollisella etumerkillä (vastaavaa debet-, vastattavaa kredit-saldoisena positiivinen)."""
    opening: Dict[str, int] = {}
    debit: Dict[str, int] = {}
    credit: Dict[str, int] = {}
    for entry in ledger:
        is_opening = entry.get("entryType") == "OPENING"
        for line in entry.get("lines", []):
            acc = str(line.get("accountNumber", ""))
            if not 1000 <= _num(acc) <= 2999:
                continue
            d = round(float(line.get("debit") or 0) * 100)
            c = round(float(line.get("credit") or 0) * 100)
            if is_opening:
                opening[acc] = opening.get(acc, 0) + d - c
            else:
                debit[acc] = debit.get(acc, 0) + d
                credit[acc] = credit.get(acc, 0) + c
    prev_accounts = {a for a in (prev_balances or {}) if 1000 <= _num(a) <= 2999}
    # Avausvienti siirtää edellisen kauden tuloksen (2200) edellisten kausien voittoon (2100);
    # avauksen tarkistuksessa nämä vertaillaan yhdessä
    carried = dict(prev_balances or {})
    if RESULT_ACCOUNT in carried:
        carried[RETAINED_EARNINGS] = carried.get(RETAINED_EARNINGS, 0) + carried.pop(RESULT_ACCOUNT)
    # Siirretyllä vertailuvuodella tulos on vielä tulostileillä (ei tilinpäätösvientiä)
    unbooked = sum(c for a, c in carried.items() if 3000 <= _num(a) <= 9999)
    if unbooked:
        carried[RETAINED_EARNINGS] = carried.get(RETAINED_EARNINGS, 0) + unbooked
    rows = []
    for acc in sorted(set(opening) | set(debit) | set(credit) | prev_accounts):
        sign = 1 if _num(acc) < 2000 else -1
        o, d, c = opening.get(acc, 0), debit.get(acc, 0), credit.get(acc, 0)
        closing = o + d - c
        prev = (prev_balances or {}).get(acc, 0)
        if not (o or d or c or closing or prev):
            continue
        row = {
            "account": acc,
            "label": f"{acc} {names[acc]}" if acc in names else acc,
            "group": balance_group(acc),
            "opening": _eur(sign * o),
            "debit": _eur(d),
            "credit": _eur(c),
            "closing": _eur(sign * closing),
            "note": notes.get(acc, ""),
        }
        if prev_balances is not None:
            row["previous"] = _eur(sign * prev)
            # Avaavan saldon pitää olla edellisen kauden päättävä saldo (muuten avaus on virheellinen)
            row["openingMismatch"] = o != carried.get(acc, 0)
        rows.append(row)
    return rows


# --- Talousarvio ------------------------------------------------------------------------------------------

def budget_balances(lines: List[Dict]) -> Dict[str, int]:
    """Talousarvio (luonnollinen etumerkki) kirjanpidon saldoiksi senteinä (debet - kredit)."""
    out: Dict[str, int] = {}
    for line in lines:
        acc = str(line["accountNumber"])
        cents = round(float(line["amount"]) * 100)
        out[acc] = out.get(acc, 0) + (-cents if _num(acc) < 4000 else cents)
    return out


SUMMARY_TITLES = ["Hoitotuotot", "Hoitokulut", "Hoitokate", "Tilikauden voitto (tappio)"]


def budget_comparison(actual: Dict[str, int], budget_lines: List[Dict], names: Dict[str, str]) -> Dict:
    """Toteuma ja talousarvio tuloslaskelman kaavalla. Rivien 'previous' = talousarvio."""
    stmt = build_income_statement(actual, names, budget_balances(budget_lines))
    summary = []
    for s in stmt["sections"]:
        if s["title"] in SUMMARY_TITLES:
            summary.append({"title": s["title"], "actual": s["total"], "budget": s["previousTotal"],
                            "difference": _eur(round((s["total"] - s["previousTotal"]) * 100))})
    return {"hasBudget": bool(budget_lines), "sections": stmt["sections"], "summary": summary}


# --- Toimintakertomus ja liitetiedot ------------------------------------------------------------------------

REPORT_SECTIONS = [
    ("general", "Yleistä"),
    ("property", "Kiinteistö ja rakennukset"),
    ("repairs", "Kunnossapito ja korjaukset tilikaudella"),
    ("maintenance_plan", "Kunnossapitotarveselvitys"),
    ("budget", "Talousarvion toteutuminen"),
    ("finance", "Talous ja rahoitus"),
    ("events", "Tilikauden jälkeiset tapahtumat"),
    ("proposal", "Hallituksen esitys tilikauden tuloksen käsittelystä"),
]

NOTE_SECTIONS = [
    ("principles", "Tilinpäätöksen laatimisperiaatteet"),
    ("fixed_assets", "Pysyvien vastaavien arvostus ja poistot"),
    ("equity", "Oman pääoman muutokset"),
    ("loans", "Pitkäaikaiset lainat"),
    ("collateral", "Annetut vakuudet ja vastuusitoumukset"),
    ("personnel", "Henkilöstö"),
    ("books", "Kirjanpitokirjat ja tositelajit"),
]


def _sum(balances: Dict[str, int], lo: int, hi: int) -> int:
    return sum(c for a, c in balances.items() if lo <= _num(a) <= hi)


def _method_text(asset: Dict) -> str:
    if asset.get("method") == "DECLINING":
        return f"menojäännöspoisto {str(asset.get('rate')).rstrip('0').rstrip('.')} %"
    if asset.get("method") == "STRAIGHT_LINE":
        return f"tasapoisto {asset.get('usefulLifeYears')} vuodessa"
    return "poisto vuosittain päätettävällä summalla (esim. lainanlyhennysten suuruinen)"


def default_report(ctx: Dict) -> Dict[str, str]:
    """Toimintakertomuksen automaattinen pohja. ctx: company, fiscalYear, package, incomeStatement,
    balances (kauden lopun saldot senteinä), prevBalances, maintenance, budget (budget_comparison)."""
    company, fy, pkg = ctx["company"], ctx["fiscalYear"], ctx.get("package") or {}
    stmt, bal = ctx["incomeStatement"], ctx["balances"]
    is_koy = company.get("companyType") == "KOY"
    auditor = pkg.get("auditorName") or "[nimi]"
    auditor_kind = "Toiminnantarkastajana" if pkg.get("auditorKind") == "INSPECTOR" else "Tilintarkastajana"
    out: Dict[str, str] = {}

    out["general"] = (
        f"{company['name']} (Y-tunnus {company.get('businessId') or '[Y-tunnus]'}) on "
        f"{'keskinäinen kiinteistöosakeyhtiö' if is_koy else 'asunto-osakeyhtiö'}, jonka kotipaikka on [kotipaikka]. "
        f"Tilikausi oli {period_text(fy)}.\n\n"
        "Yhtiön hallitukseen kuuluivat tilikaudella [puheenjohtaja] (puheenjohtaja) sekä [jäsenet]. "
        f"Hallitus kokoontui tilikauden aikana [lukumäärä] kertaa. Isännöitsijänä toimi [isännöitsijä ja toimisto].\n\n"
        f"Varsinainen yhtiökokous pidettiin [päivämäärä]. {auditor_kind} toimi {auditor}."
    )
    out["property"] = (
        "[Yhtiön omistama tai vuokraama tontti, rakennusten lukumäärä ja valmistumisvuosi, "
        "huoneistojen lukumäärä ja huoneistoala.]"
    )

    # Hoitokulut ovat tuloslaskelmassa miinusmerkkisinä
    repairs = next((g["total"] for s in stmt["sections"] if s["title"] == "Hoitokulut"
                    for g in s.get("groups", []) if g["title"] == "Korjaukset"), 0.0)
    out["repairs"] = (
        (f"Tilikauden korjauskulut olivat {eur_text(-repairs)}. " if repairs else "")
        + "[Kuvaa tilikaudella tehdyt merkittävät korjaukset ja kunnossapitotyöt.]"
    )
    out["maintenance_plan"] = (
        "Hallitus on antanut varsinaiselle yhtiökokoukselle selvityksen yhtiön rakennusten ja kiinteistön "
        "kunnossapitotarpeesta seuraavan viiden vuoden aikana (asunto-osakeyhtiölaki 6 luku 2 §). "
        "[Luettele suunnitellut korjaukset, ajankohdat ja arvioidut kustannukset.]"
        if not is_koy else
        "[Kuvaa yhtiön rakennusten kunnossapitotarve ja suunnitellut korjaukset tuleville vuosille.]"
    )

    budget = ctx.get("budget")
    if budget and budget["hasBudget"]:
        s = {r["title"]: r for r in budget["summary"]}
        parts = []
        for title, word in (("Hoitotuotot", "Hoitotuotot olivat"), ("Hoitokulut", "Hoitokulut olivat"), ("Hoitokate", "Hoitokate oli")):
            r = s.get(title)
            if r:
                parts.append(f"{word} {eur_text(abs(r['actual']))} (talousarvio {eur_text(abs(r['budget']))}).")
        r = s.get("Tilikauden voitto (tappio)")
        if r:
            parts.append(f"Tilikauden tulos oli {eur_text(r['actual'])} (talousarvio {eur_text(r['budget'])}).")
        out["budget"] = " ".join(parts) + " Tilikohtainen vertailu on esitetty taulukossa."
    else:
        out["budget"] = "[Tilikaudelle ei ole kirjattu talousarviota. Kirjaa talousarvio Talousarvio-sivulla tai kuvaa toteutuminen tähän.]"

    fees = -_sum(bal, 3000, 3099)
    loans = -_sum(bal, 2400, 2699)
    cash = _sum(bal, 1900, 1989)
    prev = ctx.get("prevBalances")
    fin = []
    if fees:
        fin.append(f"Vastikkeita kertyi tilikaudella {eur_text(_eur(fees))}.")
    loan_text = f"Yhtiön pitkäaikaiset lainat olivat tilikauden lopussa {eur_text(_eur(loans))}"
    if prev is not None:
        loan_text += f" (edellinen tilikausi {eur_text(_eur(-_sum(prev, 2400, 2699)))})"
    fin.append(loan_text + ".")
    fin.append(f"Rahavarat olivat tilikauden lopussa {eur_text(_eur(cash))}.")
    m = ctx.get("maintenance")
    if m and not is_koy:
        fin.append(
            f"Vastikelaskelman mukaan hoitorahoituksen tulos oli {eur_text(m['maintenance_fund']['surplus'])} "
            f"ja pääomarahoituksen tulos {eur_text(m['capital_fund']['surplus'])}."
        )
    out["finance"] = " ".join(fin)
    out["events"] = "Tilikauden päättymisen jälkeen ei ole tapahtunut olennaisia muutoksia yhtiön asemassa. [Tarkista.]"

    net = stmt["netProfit"]
    if net >= 0:
        out["proposal"] = (f"Tilikauden ylijäämä on {eur_text(net)}. Hallitus esittää yhtiökokoukselle, että ylijäämä "
                           "kirjataan edellisten tilikausien yli-/alijäämä -tilille eikä osinkoa jaeta.")
    else:
        out["proposal"] = (f"Tilikauden alijäämä on {eur_text(-net)}. Hallitus esittää yhtiökokoukselle, että alijäämä "
                           "kirjataan edellisten tilikausien yli-/alijäämä -tilille.")
    return out


def default_notes(ctx: Dict) -> Dict[str, str]:
    """Liitetietojen automaattinen pohja (pienyrityssäännöstö)."""
    fy, bal, names = ctx["fiscalYear"], ctx["balances"], ctx.get("names", {})
    opening = ctx.get("openingBalances", {})
    out: Dict[str, str] = {}
    out["principles"] = (
        "Tilinpäätös on laadittu noudattaen pien- ja mikroyrityksen tilinpäätöksessä esitettävistä tiedoista "
        "annetun valtioneuvoston asetuksen (1753/2015) pienyrityssäännöksiä."
    )
    assets = [a for a in ctx.get("assets", []) if a.get("isActive", True)]
    if assets:
        lines = [f"{a['name']} (tili {a['accountNumber']}): {_method_text(a)}" for a in assets]
        out["fixed_assets"] = ("Pysyvät vastaavat on merkitty taseeseen hankintamenoon vähennettynä suunnitelman "
                               "mukaisilla poistoilla. Poistomenetelmät:\n" + "\n".join(lines))
    else:
        out["fixed_assets"] = ("Pysyvät vastaavat on merkitty taseeseen hankintamenoon vähennettynä poistoilla. "
                               "[Kuvaa poistomenetelmät, esim. rakennukset menojäännöspoisto 4 %.]")

    eq_lines = []
    for acc in sorted({a for a in set(bal) | set(opening) if 2000 <= _num(a) <= 2399}):
        start, end = -opening.get(acc, 0), -bal.get(acc, 0)
        if not (start or end):
            continue
        label = names.get(acc, acc)
        eq_lines.append(f"{label}: {fmt_date(fy['startDate'])} {eur_text(_eur(start))}, "
                        f"{fmt_date(fy['endDate'])} {eur_text(_eur(end))}")
    net = ctx["incomeStatement"]["netProfit"]
    if fy.get("status") != "CLOSED":
        eq_lines.append(f"Tilikauden tulos (ei vielä siirretty omaan pääomaan): {eur_text(net)}")
    else:
        eq_lines.append(f"Tilikauden tulos: {eur_text(net)}")
    out["equity"] = "\n".join(eq_lines)

    loan_rows = [(a, -c) for a, c in sorted(bal.items()) if 2400 <= _num(a) <= 2699 and c]
    if loan_rows:
        out["loans"] = ("\n".join(f"{names.get(a, a)}: {eur_text(_eur(c))}" for a, c in loan_rows)
                        + "\n[Ilmoita lainat, jotka erääntyvät maksettaviksi yli viiden vuoden kuluttua.]")
    else:
        out["loans"] = "Yhtiöllä ei ole pitkäaikaisia lainoja."
    out["collateral"] = "Yhtiön lainojen vakuudeksi annetut kiinnitykset: [summa] €. [Muut vakuudet ja vastuut.]"
    out["personnel"] = "Yhtiöllä ei ollut tilikaudella palkattua henkilökuntaa."
    out["books"] = (
        "Päiväkirja ja pääkirja: sähköisesti kirjanpitojärjestelmässä.\n"
        "Tilinpäätös ja tase-erittelyt: PDF-tiedostoina ja allekirjoitettuna paperilla.\n"
        "Tositelajit: ostolaskut, myyntilaskut ja vastikelaskut, pankkitapahtumat, muistiotositteet "
        "(poistot, jaksotukset, avaus- ja tilinpäätösviennit)."
    )
    return out


def merge_sections(spec: List[tuple], auto: Dict[str, str], saved: Dict[str, str]) -> List[Dict]:
    """Tallennettu teksti korvaa automaattisen. needsInput = tekstissä on täydennettäviä [kohtia]."""
    out = []
    for key, title in spec:
        text = saved.get(key) or auto.get(key, "")
        out.append({
            "key": key,
            "title": title,
            "text": text,
            "auto": auto.get(key, ""),
            "edited": bool(saved.get(key)),
            "needsInput": bool(PLACEHOLDER.search(text)),
        })
    return out


# --- Päiväkirja ja pääkirja ----------------------------------------------------------------------------------

def _sorted_entries(ledger: List[Dict]) -> List[Dict]:
    order = {"OPENING": 0}
    return sorted(ledger, key=lambda e: (e["entryDate"][:10], order.get(e.get("entryType"), 1), e.get("voucherNumber", "")))


def journal_rows(ledger: List[Dict]) -> List[Dict]:
    """Päiväkirja: viennit aikajärjestyksessä."""
    out = []
    for e in _sorted_entries(ledger):
        lines = sorted(e.get("lines", []), key=lambda l: (-float(l.get("debit") or 0), str(l.get("accountNumber"))))
        out.append({
            "date": e["entryDate"][:10],
            "voucher": e.get("voucherNumber", ""),
            "description": e.get("description") or "",
            "lines": [{"account": str(l.get("accountNumber")), "debit": float(l.get("debit") or 0),
                       "credit": float(l.get("credit") or 0), "description": l.get("description") or ""} for l in lines],
        })
    return out


def general_ledger(ledger: List[Dict], names: Dict[str, str]) -> List[Dict]:
    """Pääkirja: tileittäin viennit ja juokseva saldo (debet - kredit)."""
    accounts: Dict[str, List[Dict]] = {}
    for e in _sorted_entries(ledger):
        for l in e.get("lines", []):
            acc = str(l.get("accountNumber"))
            accounts.setdefault(acc, []).append({
                "date": e["entryDate"][:10], "voucher": e.get("voucherNumber", ""),
                "description": l.get("description") or e.get("description") or "",
                "debit": round(float(l.get("debit") or 0) * 100), "credit": round(float(l.get("credit") or 0) * 100),
            })
    out = []
    for acc in sorted(accounts):
        running = 0
        rows = []
        for r in accounts[acc]:
            running += r["debit"] - r["credit"]
            rows.append({**r, "debit": _eur(r["debit"]), "credit": _eur(r["credit"]), "balance": _eur(running)})
        out.append({
            "account": acc, "label": f"{acc} {names[acc]}" if acc in names else acc, "rows": rows,
            "debit": _eur(sum(r["debit"] for r in accounts[acc])), "credit": _eur(sum(r["credit"] for r in accounts[acc])),
            "balance": _eur(running),
        })
    return out
