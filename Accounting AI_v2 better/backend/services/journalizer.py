"""
KPL 2:1 § — Kahdenkertainen kirjanpito / Double-Entry Bookkeeping Journalizer

Converts a verified Transaction into JournalLine pairs (debit + credit).
This is the authoritative source of financial truth for all reports.

Rules:
  Income (amount > 0):
    DEBIT  Bank account (1910)       full amount
    CREDIT Revenue account (category) full amount

  Expense (amount < 0):
    DEBIT  Expense account (category) abs(amount)
    CREDIT Bank account (1910)        abs(amount)

  With VAT on income (company.is_vat_registered and category.vat_percentage):
    DEBIT  Bank account (1910)         gross amount
    CREDIT Revenue account             net amount (excl. VAT)
    CREDIT VAT payable (2700)          VAT amount

  With VAT on expense (company.is_vat_registered and category.vat_percentage):
    DEBIT  Expense account             net amount (excl. VAT)
    DEBIT  VAT receivable (1780)       VAT amount
    CREDIT Bank account (1910)         gross amount
"""
from datetime import timezone
import datetime
from typing import List, Optional

from sqlmodel import Session, select
from models import AccountCategory, HousingCompany, JournalLine, Transaction

# Standard bank account code in TALO-2024 chart of accounts
BANK_ACCOUNT_CODE = "1910"
BANK_ACCOUNT_NAME = "Pankkitili"

VAT_PAYABLE_CODE = "2700"      # ALV-velka (myynnin ALV)
VAT_PAYABLE_NAME = "ALV-velka"
VAT_RECEIVABLE_CODE = "1780"   # ALV-saatava (ostojen ALV)
VAT_RECEIVABLE_NAME = "ALV-saatava"


def _get_bank_cat_name(session: Session) -> str:
    """Get local bank account name from chart of accounts."""
    bank_cat = session.exec(
        select(AccountCategory).where(AccountCategory.code == BANK_ACCOUNT_CODE)
    ).first()
    return bank_cat.name if bank_cat else BANK_ACCOUNT_NAME


def journalize(
    tx: Transaction,
    session: Session,
    is_vat_registered: bool = False,
) -> List[JournalLine]:
    """
    KPL 2:1 § — Create double-entry journal lines for a verified transaction.

    Returns a list of JournalLine objects (not yet added to session).
    Caller is responsible for adding them to the session.

    Raises ValueError if transaction has no category assigned.
    """
    if not tx.category_id or not tx.category:
        # Cannot journalize without a category — leave unmatched
        return []

    cat = tx.category
    gross = abs(tx.amount)
    is_income = tx.amount > 0
    bank_name = _get_bank_cat_name(session)

    lines: List[JournalLine] = []

    # ── Determine VAT amounts ────────────────────────────────────────────────
    vat_pct = cat.vat_percentage if (is_vat_registered and cat.vat_percentage) else None
    if vat_pct and vat_pct > 0:
        # Gross already includes VAT — back-calculate net
        net = round(gross / (1 + vat_pct / 100), 2)
        vat_amt = round(gross - net, 2)
    else:
        net = gross
        vat_amt = 0.0

    # ── Build journal lines ──────────────────────────────────────────────────
    if is_income:
        # Bank account DEBITED (money in)
        lines.append(JournalLine(
            transaction_id=tx.id,
            side="DEBIT",
            account_code=BANK_ACCOUNT_CODE,
            account_name=bank_name,
            amount=gross,
        ))
        # Revenue account CREDITED (net)
        lines.append(JournalLine(
            transaction_id=tx.id,
            side="CREDIT",
            account_code=cat.code,
            account_name=cat.name,
            amount=net,
        ))
        # VAT payable if applicable
        if vat_amt > 0:
            lines.append(JournalLine(
                transaction_id=tx.id,
                side="CREDIT",
                account_code=VAT_PAYABLE_CODE,
                account_name=VAT_PAYABLE_NAME,
                amount=vat_amt,
            ))
    else:
        # Expense account DEBITED (net cost)
        lines.append(JournalLine(
            transaction_id=tx.id,
            side="DEBIT",
            account_code=cat.code,
            account_name=cat.name,
            amount=net,
        ))
        # VAT receivable if applicable
        if vat_amt > 0:
            lines.append(JournalLine(
                transaction_id=tx.id,
                side="DEBIT",
                account_code=VAT_RECEIVABLE_CODE,
                account_name=VAT_RECEIVABLE_NAME,
                amount=vat_amt,
            ))
        # Bank account CREDITED (money out)
        lines.append(JournalLine(
            transaction_id=tx.id,
            side="CREDIT",
            account_code=BANK_ACCOUNT_CODE,
            account_name=bank_name,
            amount=gross,
        ))

    # ── Validate: sum of debits == sum of credits ────────────────────────────
    total_debit = sum(l.amount for l in lines if l.side == "DEBIT")
    total_credit = sum(l.amount for l in lines if l.side == "CREDIT")
    if abs(total_debit - total_credit) > 0.01:
        raise ValueError(
            f"Kirjanpitovirhe: Debet ({total_debit:.2f}) ≠ Kredit ({total_credit:.2f}) "
            f"tapahtumalle {tx.id}. Kahdenkertainen kirjanpito ei täsmää."
        )

    return lines


def journalize_transaction(tx: Transaction, session: Session) -> List[JournalLine]:
    """
    High-level wrapper: journalizes a Transaction, checks for existing lines
    to avoid duplicates, and returns new lines ready to be added.
    """
    # Check if journal lines already exist for this transaction
    existing = session.exec(
        select(JournalLine).where(JournalLine.transaction_id == tx.id)
    ).first()
    if existing:
        return []  # Already journalized — idempotent

    # Get company to check VAT status
    company: Optional[HousingCompany] = session.get(HousingCompany, tx.company_id)
    is_vat = company.is_vat_registered if company else False

    return journalize(tx, session, is_vat_registered=is_vat)
