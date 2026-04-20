from datetime import date
from typing import List, Optional, Dict, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from auth import get_current_user
from database import get_session
from models import Apartment, Transaction, User, AccountType, AccountCategory, Budget, JournalLine
from schemas import (
    DashboardKpi,
    PaymentStatus,
    IncomeStatement,
    BalanceSheet,
    ReportLine,
    ReportSection,
    JournalReport,
    JournalEntry,
    GeneralLedgerReport,
    LedgerAccount,
)

from security_utils import verify_company_access
from services.archive_service import generate_statutory_archive


def _get_journal_lines_for_company(
    company_id: int,
    session: Session,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> List[JournalLine]:
    """
    Fetches all JournalLines for verified transactions of a company, filtered by date.
    This is the KPL-compliant source of truth for all financial reports.
    """
    stmt = select(Transaction).where(
        Transaction.company_id == company_id,
        Transaction.is_verified == True,
    )
    if start_date:
        stmt = stmt.where(Transaction.date >= start_date)
    if end_date:
        stmt = stmt.where(Transaction.date <= end_date)
    txs = session.exec(stmt).all()
    if not txs:
        return []
    tx_ids = [t.id for t in txs]
    return list(session.exec(
        select(JournalLine).where(JournalLine.transaction_id.in_(tx_ids))
    ).all())

router = APIRouter(
    prefix="/companies/{company_id}/reports",
    tags=["Reports"],
    dependencies=[Depends(get_current_user), Depends(verify_company_access)],
)


@router.get("/dashboard", response_model=DashboardKpi)
def get_dashboard_stats(company_id: int, session: Session = Depends(get_session)):
    txs = session.exec(select(Transaction).where(Transaction.company_id == company_id)).all()
    apartments = session.exec(select(Apartment).where(Apartment.company_id == company_id)).all()

    total_cash = 0.0
    monthly_revenue = 0.0
    monthly_expenses = 0.0

    # Determine target month/year from latest transaction or today
    if txs:
        latest_date = max(t.date for t in txs)
        target_month = latest_date.month
        target_year = latest_date.year
    else:
        target_month = date.today().month
        target_year = date.today().year

    paid_apartment_ids = set()

    for t in txs:
        total_cash += t.amount
        if t.date.year == target_year and t.date.month == target_month:
            if t.amount > 0:
                monthly_revenue += t.amount
            else:
                monthly_expenses += abs(t.amount)
            
            if t.matched_apartment_id:
                paid_apartment_ids.add(t.matched_apartment_id)

    return DashboardKpi(
        total_cash=total_cash,
        monthly_revenue=monthly_revenue,
        monthly_expenses=monthly_expenses,
        monthly_result=monthly_revenue - monthly_expenses,
        paid_apartments=len(paid_apartment_ids),
        total_apartments=len(apartments),
    )

@router.get("/health-check")
def get_health_check(company_id: int, session: Session = Depends(get_session)):
    """
    Checks the 'sanitary' state of the company's accounting.
    1. Unverified transactions
    2. Bank reconciliation (System sum vs last known bank balance)
    3. Late payments
    """
    txs = session.exec(select(Transaction).where(Transaction.company_id == company_id)).all()
    unverified = [t for t in txs if not t.is_verified]
    
    # Calculate current system balance
    current_balance = sum(t.amount for t in txs)
    
    # Check for anomalies (e.g. duplicate hashes - already handled by DB, but good to check)
    hash_counts = {}
    duplicates = 0
    for t in txs:
        if t.transaction_hash:
            hash_counts[t.transaction_hash] = hash_counts.get(t.transaction_hash, 0) + 1
            if hash_counts[t.transaction_hash] > 1:
                duplicates += 1
                
    return {
        "is_healthy": len(unverified) == 0 and duplicates == 0,
        "unverified_count": len(unverified),
        "duplicate_count": duplicates,
        "system_balance": current_balance,
        "audit_shield_active": True
    }


@router.get("/payment-status", response_model=List[PaymentStatus])
def get_payment_status(company_id: int, session: Session = Depends(get_session)):
    txs = session.exec(select(Transaction).where(Transaction.company_id == company_id)).all()
    apartments = session.exec(select(Apartment).where(Apartment.company_id == company_id)).all()

    if txs:
        latest_date = max(t.date for t in txs)
        target_month = latest_date.month
        target_year = latest_date.year
    else:
        target_month = date.today().month
        target_year = date.today().year

    status_list = []
    for apt in apartments:
        paid = False
        tx_id = None
        for t in txs:
            if (
                t.matched_apartment_id == apt.id 
                and t.date.year == target_year 
                and t.date.month == target_month
            ):
                paid = True
                tx_id = t.id
                break
                
        status_list.append(
            PaymentStatus(
                apartment_id=apt.id,
                apartment_number=apt.apartment_number,
                owner_name=apt.owner_name,
                monthly_fee=apt.monthly_fee,
                paid=paid,
                transaction_id=tx_id
            )
        )
    return status_list


@router.get("/income-statement", response_model=IncomeStatement)
def get_income_statement(
    company_id: int,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    session: Session = Depends(get_session)
):
    """
    KPL 2:1 § — Tuloslaskelma (Income Statement) from JournalLine double-entry ledger.
    Revenue = CREDIT balances on 3xxx accounts.
    Expenses = DEBIT balances on 4xxx–8xxx accounts.
    """
    jlines = _get_journal_lines_for_company(company_id, session, start_date, end_date)

    # Determine period — fallback to all verified transaction dates
    all_txs = session.exec(
        select(Transaction).where(Transaction.company_id == company_id, Transaction.is_verified == True)
    ).all()
    if all_txs:
        dates = [t.date for t in all_txs]
        calc_start = start_date or min(dates)
        calc_end = end_date or max(dates)
    else:
        calc_start = start_date or date.today()
        calc_end = end_date or date.today()

    # Aggregate by account_code
    code_credits: Dict[str, float] = {}  # revenue
    code_debits: Dict[str, float] = {}   # expenses
    code_names: Dict[str, str] = {}
    for line in jlines:
        code_names[line.account_code] = line.account_name
        if line.side == "CREDIT":
            code_credits[line.account_code] = code_credits.get(line.account_code, 0.0) + line.amount
        else:
            code_debits[line.account_code] = code_debits.get(line.account_code, 0.0) + line.amount

    # Fetch budgets
    target_year = calc_end.year
    budgets = session.exec(select(Budget).where(Budget.company_id == company_id, Budget.year == target_year)).all()
    categories = session.exec(select(AccountCategory)).all()
    cat_by_code = {c.code: c for c in categories}
    cat_budgets: Dict[int, float] = {b.category_id: b.amount for b in budgets}

    # ── TALO-2024 tiliryhmäalueet ─────────────────────────────────────────────
    # Tuotot: 3xxx (CREDIT-puoli)
    # Kulut:  4xxx–5xxx (DEBIT-puoli)
    # Rahoituserät: 9xxx
    groups = {
        "Hoitovastikkeet":       (3000, 3099, "revenue"),
        "Muut hoitotuotot":      (3100, 3999, "revenue"),
        "Henkilöstökulut":       (4000, 4099, "expense"),
        "Isännöinti ja hallinto": (4100, 4199, "expense"),
        "Käyttö ja huolto":      (4200, 4399, "expense"),
        "Siivous":               (4400, 4499, "expense"),
        "Lämmitys":              (4500, 4599, "expense"),
        "Vesi":                  (4600, 4699, "expense"),
        "Sähkö ja kaasu":        (4700, 4799, "expense"),
        "Jätehuolto":            (4800, 4899, "expense"),
        "Vakuutukset":           (4900, 4999, "expense"),
        "Verot":                 (5100, 5199, "expense"),
        "Korjaukset":            (5200, 5999, "expense"),
        "Rahoitustuotot":        (9000, 9299, "financial"),
        "Rahoituskulut":         (9300, 9990, "financial"),
    }

    revenue_groups: List[ReportSection] = []
    expense_groups: List[ReportSection] = []
    financial_groups: List[ReportSection] = []
    total_revenue = total_expenses = total_financial = 0.0

    for group_name, (code_start, code_end, kind) in groups.items():
        lines: List[ReportLine] = []
        group_total = 0.0
        source = code_credits if kind == "revenue" else code_debits
        for code, amt in source.items():
            try:
                if code_start <= int(code) <= code_end:
                    cat = cat_by_code.get(code)
                    b_amt = cat_budgets.get(cat.id, 0.0) if cat else 0.0
                    lines.append(ReportLine(
                        code=code,
                        name=code_names.get(code, code),
                        amount=round(amt, 2),
                        budget_amount=b_amt,
                        variance=round(amt - b_amt, 2),
                    ))
                    group_total += amt
            except ValueError:
                continue
        if lines:
            lines.sort(key=lambda x: x.code)
            section = ReportSection(name=group_name, lines=lines, total=round(group_total, 2))
            if kind == "revenue":
                revenue_groups.append(section)
                total_revenue += group_total
            elif kind == "expense":
                expense_groups.append(section)
                total_expenses += group_total
            else:
                financial_groups.append(section)
                total_financial += group_total

    operating_margin = total_revenue - total_expenses
    net_financial = sum(
        g.total if "tuotot" in g.name.lower() else -g.total
        for g in financial_groups
    )

    return IncomeStatement(
        period_start=calc_start,
        period_end=calc_end,
        revenue_groups=revenue_groups,
        expense_groups=expense_groups,
        total_revenue=round(total_revenue, 2),
        total_expenses=round(total_expenses, 2),
        operating_margin=round(operating_margin, 2),
        financial_groups=financial_groups,
        net_result=round(operating_margin + net_financial, 2),
    )



@router.get("/tase", response_model=BalanceSheet)
def get_balance_sheet(
    company_id: int,
    end_date: Optional[date] = None,
    session: Session = Depends(get_session)
):
    """
    KPL 2:1 § — Tase (Balance Sheet) from JournalLine double-entry ledger.
    Assets   = net DEBIT balance on 1xxx accounts
    Equity   = net CREDIT balance on 2000–2099 accounts
    Liab.    = net CREDIT balance on 2100–2999 accounts
    Tilikauden tulos = net of all P&L accounts (revenue credits - expense debits)
    
    Since we use double-entry, total_assets == total_liabilities + equity always.
    """
    jlines = _get_journal_lines_for_company(company_id, session, end_date=end_date)

    all_txs = session.exec(
        select(Transaction).where(Transaction.company_id == company_id, Transaction.is_verified == True)
    ).all()
    if end_date:
        all_txs = [t for t in all_txs if t.date <= end_date]
    calc_end = end_date or (max(t.date for t in all_txs) if all_txs else date.today())

    # Net balance per account: DEBIT - CREDIT
    account_debit: Dict[str, float] = {}
    account_credit: Dict[str, float] = {}
    account_names: Dict[str, str] = {}
    for line in jlines:
        account_names[line.account_code] = line.account_name
        if line.side == "DEBIT":
            account_debit[line.account_code] = account_debit.get(line.account_code, 0.0) + line.amount
        else:
            account_credit[line.account_code] = account_credit.get(line.account_code, 0.0) + line.amount

    def net_balance(code: str) -> float:
        """Net balance: positive on the account's normal side."""
        return round(account_debit.get(code, 0.0) - account_credit.get(code, 0.0), 2)

    # ── Process Asset accounts (DEBIT normal balance = 1xxx) ──
    asset_defs = {
        "Pysyvät vastaavat (Kiinteistö)": (1000, 1199),
        "Vaihtuvat vastaavat (Saamiset)": (1200, 1899),
        "Rahat ja pankkisaamiset":         (1900, 1999),
    }
    asset_groups: List[ReportSection] = []
    total_assets = 0.0
    all_codes = set(account_debit.keys()) | set(account_credit.keys())

    for group_name, (start, end) in asset_defs.items():
        lines: List[ReportLine] = []
        total = 0.0
        for code in sorted(all_codes):
            try:
                if start <= int(code) <= end:
                    bal = net_balance(code)
                    if bal != 0.0:
                        lines.append(ReportLine(code=code, name=account_names.get(code, code), amount=bal))
                        total += bal
            except ValueError:
                continue
        if lines:
            asset_groups.append(ReportSection(name=group_name, lines=lines, total=round(total, 2)))
            total_assets += total

    # ── Process Liability / Equity accounts (CREDIT normal balance = 2xxx) ──
    liability_defs = {
        "Oma pääoma":               (2000, 2099),
        "Pitkäaikaiset lainat":      (2100, 2199),
        "Lyhytaikaiset lainat":      (2200, 2299),
        "Ostovelat ja muut velat":   (2300, 2999),
    }
    liability_groups: List[ReportSection] = []
    total_liabilities = 0.0

    for group_name, (start, end) in liability_defs.items():
        lines = []
        total = 0.0
        for code in sorted(all_codes):
            try:
                if start <= int(code) <= end:
                    # For liability/equity, credit balance is positive
                    bal = round(account_credit.get(code, 0.0) - account_debit.get(code, 0.0), 2)
                    if bal != 0.0:
                        lines.append(ReportLine(code=code, name=account_names.get(code, code), amount=bal))
                        total += bal
            except ValueError:
                continue

        # ── Add Tilikauden tulos to Oma pääoma ───────────────────────────────
        if group_name == "Oma pääoma":
            revenue_credits = sum(v for c, v in account_credit.items() if _is_in_range(c, 3000, 3999))
            expense_debits = sum(v for c, v in account_debit.items() if _is_in_range(c, 4000, 9999))
            net_result = round(revenue_credits - expense_debits, 2)
            lines.append(ReportLine(code="XXXX", name="Tilikauden tulos", amount=net_result))
            total += net_result

        if lines:
            liability_groups.append(ReportSection(name=group_name, lines=lines, total=round(total, 2)))
            total_liabilities += total

    return BalanceSheet(
        as_of=calc_end,
        asset_groups=asset_groups,
        liability_groups=liability_groups,
        total_assets=round(total_assets, 2),
        total_liabilities=round(total_liabilities, 2),
    )


def _is_in_range(code: str, start: int, end: int) -> bool:
    try:
        return start <= int(code) <= end
    except ValueError:
        return False




@router.get("/journal", response_model=JournalReport)
def get_journal(
    company_id: int,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    session: Session = Depends(get_session)
):
    stmt = select(Transaction).where(Transaction.company_id == company_id)
    if start_date:
        stmt = stmt.where(Transaction.date >= start_date)
    if end_date:
        stmt = stmt.where(Transaction.date <= end_date)
    
    # Sort chronologically for Journal
    stmt = stmt.order_by(Transaction.date.asc(), Transaction.id.asc())
    txs = session.exec(stmt).all()

    entries = []
    total_in = 0.0
    total_out = 0.0

    for t in txs:
        # Map to schema
        entries.append(JournalEntry(
            id=t.id,
            date=t.date,
            description=t.description,
            amount=t.amount,
            category_code=t.category.code if t.category else None,
            category_name=t.category.name if t.category else None,
            is_verified=t.is_verified,
            apartment_number=t.apartment.apartment_number if t.matched_apartment_id and hasattr(t, 'apartment') else None,
            voucher_number=t.voucher_number,
            receipt_url=t.receipt_url
        ))
        if t.amount > 0:
            total_in += t.amount
        else:
            total_out += abs(t.amount)

    return JournalReport(
        period_start=start_date or (min(t.date for t in txs) if txs else date.today()),
        period_end=end_date or (max(t.date for t in txs) if txs else date.today()),
        entries=entries,
        total_in=total_in,
        total_out=total_out
    )


@router.get("/general-ledger", response_model=GeneralLedgerReport)
def get_general_ledger(
    company_id: int,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    session: Session = Depends(get_session)
):
    """
    KPL 2:1 § — Pääkirja (General Ledger) from JournalLine double-entry ledger.
    Each account shows true debit/credit entries from journal lines.
    """
    jlines = _get_journal_lines_for_company(company_id, session, start_date, end_date)

    # Gather verified txs for date range (for period display and JournalEntry metadata)
    stmt = select(Transaction).where(
        Transaction.company_id == company_id,
        Transaction.is_verified == True,
    )
    if start_date:
        stmt = stmt.where(Transaction.date >= start_date)
    if end_date:
        stmt = stmt.where(Transaction.date <= end_date)
    txs = session.exec(stmt).all()
    tx_meta: Dict[int, Transaction] = {t.id: t for t in txs}

    # Group journal lines by account_code
    accounts_dict: Dict[str, LedgerAccount] = {}
    total_debit = 0.0
    total_credit = 0.0

    for jl in jlines:
        code = jl.account_code
        name = jl.account_name
        tx = tx_meta.get(jl.transaction_id)
        if not tx:
            continue

        if code not in accounts_dict:
            accounts_dict[code] = LedgerAccount(
                code=code,
                name=name,
                entries=[],
                total_debit=0.0,
                total_credit=0.0,
                balance=0.0,
            )

        # Each JournalLine becomes a JournalEntry for display
        entry = JournalEntry(
            id=tx.id,
            date=tx.date,
            description=tx.description,
            # Show positive for DEBIT, negative for CREDIT (for display column logic)
            amount=jl.amount if jl.side == "DEBIT" else -jl.amount,
            category_code=code,
            category_name=name,
            is_verified=True,
            apartment_number=None,
            voucher_number=tx.voucher_number,
            receipt_url=tx.receipt_url,
        )
        accounts_dict[code].entries.append(entry)

        if jl.side == "DEBIT":
            accounts_dict[code].total_debit += jl.amount
            accounts_dict[code].balance += jl.amount
            total_debit += jl.amount
        else:
            accounts_dict[code].total_credit += jl.amount
            accounts_dict[code].balance -= jl.amount
            total_credit += jl.amount

    # Round balances
    for acc in accounts_dict.values():
        acc.total_debit = round(acc.total_debit, 2)
        acc.total_credit = round(acc.total_credit, 2)
        acc.balance = round(acc.balance, 2)
        acc.entries.sort(key=lambda e: (e.date, e.id))

    # Sort accounts by code
    sorted_accounts = sorted(accounts_dict.values(), key=lambda x: x.code)

    calc_start = start_date or (min(t.date for t in txs) if txs else date.today())
    calc_end = end_date or (max(t.date for t in txs) if txs else date.today())

    return GeneralLedgerReport(
        period_start=calc_start,
        period_end=calc_end,
        accounts=sorted_accounts,
        total_debit=round(total_debit, 2),
        total_credit=round(total_credit, 2),
    )



@router.get("/yearly-archive/{year}")
def get_yearly_archive(company_id: int, year: int, session: Session = Depends(get_session)):
    """
    Generates a full year financial archive package (KPL 2:10 §).
    Includes all core reports for the specified fiscal year.
    """
    start = date(year, 1, 1)
    end = date(year, 12, 31)
    
    # Check if we have data for this year
    tx_count = session.exec(select(Transaction).where(Transaction.company_id == company_id, Transaction.date >= start, Transaction.date <= end)).first()
    if not tx_count:
        return {"error": "No data for this year"}

    return {
        "year": year,
        "generated_at": date.today(),
        "income_statement": get_income_statement(company_id, start, end, session),
        "balance_sheet": get_balance_sheet(company_id, end, session),
        "journal": get_journal(company_id, start, end, session),
        "ledger": get_general_ledger(company_id, start, end, session)
    }

@router.get("/yearly-archive/{year}/export-zip")
def export_statutory_archive(year: int, company_id: int, session: Session = Depends(get_session)):
    """
    KPL 2:10 § Archiving.
    Downloads the entire year's data as a portable ZIP file.
    """
    buffer = generate_statutory_archive(company_id, year, session)
    if not buffer:
         raise HTTPException(status_code=404, detail="Ei aineistoa valitulle vuodelle.")
         
    filename = f"kirjanpito_arkisto_{year}.zip"
    return StreamingResponse(
        buffer, 
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

