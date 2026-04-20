"""
KPL-mukainen tilikauden päätös- ja avauskirjauspalvelu.

KPL 3:6 § — Tilinpäätössiirrot:
  1. Tilikauden tulos siirretään tilille 2070 (Edellisten tilikausien voitto/tappio)
  2. Avauskirjaukset (1910 pankkisaldo, 2070 oma pääoma) luodaan seuraavalle vuodelle

Avauskirjaukset luodaan JournalLine-pareina (KPL 2:1 §).
"""
from datetime import date
from sqlmodel import Session, select

from models import Transaction, JournalLine, AccountCategory, AccountType, MatchType


def _get_or_create_category(session: Session, code: str, name: str, acc_type: str, normal_balance: str) -> AccountCategory | None:
    cat = session.exec(select(AccountCategory).where(AccountCategory.code == code)).first()
    if not cat:
        cat = AccountCategory(code=code, name=name, type=acc_type, normal_balance=normal_balance)
        session.add(cat)
        session.flush()
    return cat


def close_fiscal_year(company_id: int, year: int, session: Session) -> dict:
    """
    KPL 3:6 § — Tilikauden päätöskirjaus (Closing Entry).

    Siirtää tilikauden tuloksen (3xxx - 4xxx/5xxx netto) tilille 2070.
    Tämä tulee ajaa ennen seuraavan vuoden avauskirjauksia.

    Toteuttaa:
      - Tulostili 0000 (väliaikainen) nollataan
      - Nettotulos menee tilille 2070 Edellisten tilikausien voitto/tappio
    """
    start = date(year, 1, 1)
    end = date(year, 12, 31)

    # Tarkista ettei ole jo tehty
    existing = session.exec(
        select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.date == end,
            Transaction.description.like("%Tilikauden päätöskirjaus%"),
        )
    ).first()
    if existing:
        return {"status": "already_exists", "message": f"Tilikausi {year} on jo päätetty."}

    # Laske tilikauden tulos JournalLineista
    jlines = session.exec(
        select(JournalLine)
        .join(Transaction, JournalLine.transaction_id == Transaction.id)
        .where(
            Transaction.company_id == company_id,
            Transaction.date >= start,
            Transaction.date <= end,
            Transaction.is_verified == True,
        )
    ).all()

    revenue_credit = 0.0
    expense_debit = 0.0

    for jl in jlines:
        # Revenue accounts have normal balance CREDIT → net = credit - debit
        if jl.account_code.startswith(("3", "9000", "9100", "9200", "9210")):
            if jl.side == "CREDIT":
                revenue_credit += jl.amount
            else:
                revenue_credit -= jl.amount
        # Expense accounts have normal balance DEBIT
        elif jl.account_code.startswith(("4", "5", "9300", "9400", "9990")):
            if jl.side == "DEBIT":
                expense_debit += jl.amount
            else:
                expense_debit -= jl.amount

    net_result = round(revenue_credit - expense_debit, 2)

    if net_result == 0:
        return {"status": "zero_result", "message": "Tilikauden tulos on 0 — ei päätöskirjausta tarvita."}

    # Hae tilikartan tilit
    bank_cat = _get_or_create_category(session, "1910", "Pankkitili (Hoitotili)", AccountType.ASSET, "DEBIT")
    retained_earnings_cat = _get_or_create_category(
        session, "2070", "Edellisten tilikausien voitto/tappio", AccountType.LIABILITY, "CREDIT"
    )

    # Luo päätöskirjaus Transaction + JournalLines
    # Nettotulos → 2070 (positiivinen tulos = kredit 2070)
    closing_tx = Transaction(
        company_id=company_id,
        date=end,
        amount=net_result,
        description=f"Tilikauden päätöskirjaus {year} — nettotulos",
        category_id=retained_earnings_cat.id if retained_earnings_cat else None,
        match_type=MatchType.RULE,
        is_verified=True,
        verified_by="System Closing Service (KPL 3:6 §)",
        voucher_number=f"{year}/CLOSE",
        notes=f"KPL 3:6 § — Tilikauden {year} tulos ({net_result:+.2f} €) siirretty omaan pääomaan.",
    )
    session.add(closing_tx)
    session.flush()

    # KPL 2:1 § Journal lines for the closing entry
    if net_result > 0:
        # Voitto: DEBIT tulostilit (nollataan), CREDIT 2070
        jl_debit = JournalLine(
            transaction_id=closing_tx.id,
            side="DEBIT",
            account_code="9990",      # Senttierot / sulkutili (kirjanpidollinen käytäntö)
            account_name="Tilikauden voitto — sulkukirjaus",
            amount=abs(net_result),
        )
        jl_credit = JournalLine(
            transaction_id=closing_tx.id,
            side="CREDIT",
            account_code="2070",
            account_name="Edellisten tilikausien voitto/tappio",
            amount=abs(net_result),
        )
    else:
        # Tappio: DEBIT 2070, CREDIT tulostilit
        jl_debit = JournalLine(
            transaction_id=closing_tx.id,
            side="DEBIT",
            account_code="2070",
            account_name="Edellisten tilikausien voitto/tappio",
            amount=abs(net_result),
        )
        jl_credit = JournalLine(
            transaction_id=closing_tx.id,
            side="CREDIT",
            account_code="9990",
            account_name="Tilikauden tappio — sulkukirjaus",
            amount=abs(net_result),
        )

    session.add(jl_debit)
    session.add(jl_credit)
    session.commit()

    return {
        "status": "success",
        "year": year,
        "net_result": net_result,
        "closing_voucher": f"{year}/CLOSE",
        "message": (
            f"Tilikausi {year} päätetty. "
            f"{'Voitto' if net_result > 0 else 'Tappio'} {abs(net_result):.2f} € "
            f"siirretty tilille 2070 (KPL 3:6 §)."
        ),
    }


def generate_opening_balances(company_id: int, target_year: int, session: Session) -> dict:
    """
    KPL-mukainen avauskirjaus — Tiliinotto (Opening Entries).

    Luo tammikuun 1. päivän JournalLine-parit edellisen vuoden päätössaldoista.
    Pankkisaldo (1910) + Oma pääoma (2070) avataan uudelle tilikaudelle.
    """
    # Tarkista idempotenttisuus
    existing = session.exec(
        select(Transaction).where(
            Transaction.company_id == company_id,
            Transaction.date == date(target_year, 1, 1),
            Transaction.description.like("%Alkukirjaus%"),
        )
    ).first()
    if existing:
        return {"status": "already_exists", "message": f"Vuoden {target_year} avauskirjaukset on jo tehty."}

    prev_year_end = date(target_year - 1, 12, 31)

    # Laske edellisen vuoden päätyssaldo tileittäin JournalLineista
    jlines = session.exec(
        select(JournalLine)
        .join(Transaction, JournalLine.transaction_id == Transaction.id)
        .where(
            Transaction.company_id == company_id,
            Transaction.date <= prev_year_end,
            Transaction.is_verified == True,
        )
    ).all()

    if not jlines:
        return {"status": "no_previous_data", "message": "Ei edellisen vuoden kirjauksia löydy."}

    # Laske saldo tileittäin
    balances: dict[str, dict] = {}
    for jl in jlines:
        if jl.account_code not in balances:
            balances[jl.account_code] = {
                "code": jl.account_code,
                "name": jl.account_name,
                "balance": 0.0,
            }
        if jl.side == "DEBIT":
            balances[jl.account_code]["balance"] += jl.amount
        else:
            balances[jl.account_code]["balance"] -= jl.amount

    # Taseen tilit (asset = DEBIT balance positiivinen, liability/equity = CREDIT balance negatiivinen)
    BALANCE_SHEET_PREFIXES = ("1", "2")
    entries_created = 0

    for code, info in balances.items():
        if not any(code.startswith(p) for p in BALANCE_SHEET_PREFIXES):
            continue  # Ohita tulos- ja kulukäyrät
        if abs(info["balance"]) < 0.01:
            continue  # Ohita nollasaldot

        cat = session.exec(select(AccountCategory).where(AccountCategory.code == code)).first()
        if not cat:
            continue

        opening_tx = Transaction(
            company_id=company_id,
            date=date(target_year, 1, 1),
            amount=info["balance"],
            description=f"Alkukirjaus: {info['name']} ({target_year - 1})",
            category_id=cat.id,
            match_type=MatchType.RULE,
            is_verified=True,
            verified_by="System Opening Service (KPL)",
            voucher_number=f"{target_year}/000",
            notes=f"Avaussaldo {target_year - 1} → {target_year}",
        )
        session.add(opening_tx)
        session.flush()

        # KPL 2:1 § — Avauskirjauksen journal-rivit
        # Positiivinen saldo = debit (varallisuus), negatiivinen = credit (velka/oma pääoma)
        if info["balance"] > 0:
            session.add(JournalLine(
                transaction_id=opening_tx.id, side="DEBIT",
                account_code=code, account_name=info["name"], amount=abs(info["balance"])
            ))
            session.add(JournalLine(
                transaction_id=opening_tx.id, side="CREDIT",
                account_code="2070", account_name="Edellisten tilikausien voitto/tappio",
                amount=abs(info["balance"])
            ))
        else:
            session.add(JournalLine(
                transaction_id=opening_tx.id, side="DEBIT",
                account_code="2070", account_name="Edellisten tilikausien voitto/tappio",
                amount=abs(info["balance"])
            ))
            session.add(JournalLine(
                transaction_id=opening_tx.id, side="CREDIT",
                account_code=code, account_name=info["name"], amount=abs(info["balance"])
            ))
        entries_created += 1

    session.commit()
    return {
        "status": "success",
        "target_year": target_year,
        "entries_created": entries_created,
        "message": f"Luotu {entries_created} avauskirjausta vuodelle {target_year} (KPL 3:6 §).",
    }
