
import datetime
from datetime import timezone
from enum import Enum
from typing import List, Optional

from sqlmodel import Field, Relationship, SQLModel


class MatchType(str, Enum):
    REFERENCE = "REFERENCE"
    RULE = "RULE"
    AI = "AI"
    MANUAL = "MANUAL"
    UNMATCHED = "UNMATCHED"


class AccountType(str, Enum):
    REVENUE = "Revenue"
    EXPENSE = "Expense"
    ASSET = "Asset"
    LIABILITY = "Liability"


# ── Matching Rule ─────────────────────────────────────────────────────────────
class MatchingRule(SQLModel, table=True):
    __tablename__ = "matching_rule"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    keyword_pattern: str
    iban: Optional[str] = None
    account_category_id: int = Field(foreign_key="account_category.id")

    company: Optional["HousingCompany"] = Relationship(back_populates="matching_rules")
    category: Optional["AccountCategory"] = Relationship()


# ── Import Job ────────────────────────────────────────────────────────────────
class ImportJob(SQLModel, table=True):
    __tablename__ = "import_job"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id", index=True)
    filename: str
    status: str = Field(default="COMPLETED") # PENDING, PROCESSING, COMPLETED, FAILED
    total_count: int = Field(default=0)
    import_summary: Optional[str] = Field(default=None) # JSON string of stats
    created_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))

    transactions: List["Transaction"] = Relationship(back_populates="import_job")


# ── Housing Company ──────────────────────────────────────────────────────────
class HousingCompany(SQLModel, table=True):
    __tablename__ = "housing_company"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    business_id: str  # Y-tunnus, e.g. "1234567-8"
    bank_account: str  # IBAN
    owner_id: int = Field(foreign_key="user.id")
    # ALV-rekisteröity yhtiö (esim. liiketiloja vuokraava)
    is_vat_registered: bool = Field(default=False)

    owner: Optional["User"] = Relationship(back_populates="companies")
    apartments: List["Apartment"] = Relationship(back_populates="company")
    transactions: List["Transaction"] = Relationship(back_populates="company")
    matching_rules: List["MatchingRule"] = Relationship(back_populates="company")


# ── Apartment ────────────────────────────────────────────────────────────────
class Apartment(SQLModel, table=True):
    __tablename__ = "apartment"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    apartment_number: str
    owner_name: str
    monthly_fee: float
    reference_number: str  # Finnish viitenumero (unique per apartment)

    company: Optional[HousingCompany] = Relationship(back_populates="apartments")


# ── Account Category (Chart of Accounts / Tilikartta) ────────────────────────
class AccountCategory(SQLModel, table=True):
    __tablename__ = "account_category"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str   # e.g. "3000"
    name: str   # e.g. "Hoitovastike"
    type: AccountType
    # DEBIT = asset/expense (1xxx, 4xxx-8xxx) | CREDIT = liability/equity/revenue (2xxx, 3xxx)
    normal_balance: str = Field(default="DEBIT")
    # ALV-prosentti: 25.5, 24.0, 14.0, 10.0, tai None = ALV-vapaa
    vat_percentage: Optional[float] = Field(default=None)

    transactions: List["Transaction"] = Relationship(back_populates="category")


# ── Transaction ───────────────────────────────────────────────────────────────
class Transaction(SQLModel, table=True):
    __tablename__ = "transaction"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id", index=True)
    date: datetime.date = Field(index=True)
    amount: float
    description: str
    reference_number: Optional[str] = None
    transaction_hash: Optional[str] = Field(default=None, index=True)
    iban: Optional[str] = None
    service_period: Optional[str] = None
    is_partial_payment: bool = False

    category_id: Optional[int] = Field(default=None, foreign_key="account_category.id")
    matched_apartment_id: Optional[int] = Field(
        default=None, foreign_key="apartment.id"
    )
    import_job_id: Optional[int] = Field(
        default=None, foreign_key="import_job.id"
    )
    
    match_type: MatchType = MatchType.UNMATCHED
    
    # Audit Shield Fields
    is_verified: bool = Field(default=False, index=True)
    verified_at: Optional[datetime.datetime] = None
    verified_by: Optional[str] = None # User ID or 'AI'
    notes: Optional[str] = None
    receipt_url: Optional[str] = None # Cloud storage link
    
    # KPL Compliance fields
    voucher_number: Optional[str] = Field(default=None, index=True)
    accounting_date: Optional[datetime.date] = None

    company: Optional[HousingCompany] = Relationship(back_populates="transactions")
    category: Optional[AccountCategory] = Relationship(back_populates="transactions")
    import_job: Optional[ImportJob] = Relationship(back_populates="transactions")
    journal_lines: List["JournalLine"] = Relationship(back_populates="transaction")


# ── Journal Line (KPL 2:1 § Kahdenkertainen kirjanpito) ──────────────────
class JournalLine(SQLModel, table=True):
    __tablename__ = "journal_line"

    id: Optional[int] = Field(default=None, primary_key=True)
    transaction_id: int = Field(foreign_key="transaction.id", index=True)
    side: str  # "DEBIT" | "CREDIT"
    account_code: str = Field(index=True)
    account_name: str
    amount: float  # always positive
    created_at: datetime.datetime = Field(
        default_factory=lambda: datetime.datetime.now(timezone.utc)
    )

    transaction: Optional[Transaction] = Relationship(back_populates="journal_lines")


# ── Locked Period (Kirjanpidon lukitus) ──────────────────────────────────────
class LockedPeriod(SQLModel, table=True):
    __tablename__ = "locked_period"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    year: int
    month: int # 1-12
    locked_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))
    locked_by: Optional[str] = None


# ── Financial Statement Notes (PMA 1753/2015) ─────────────────────────────────
class FinancialNote(SQLModel, table=True):
    __tablename__ = "financial_note"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    year: int
    note_type: str # e.g. "Vakuudet", "Henkilöstö", "Omat osakkeet"
    content: str
    updated_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))


# ── Audit Log (KPL 2:8 §) ────────────────────────────────────────────────────
class TransactionAudit(SQLModel, table=True):
    __tablename__ = "transaction_audit"

    id: Optional[int] = Field(default=None, primary_key=True)
    transaction_id: int = Field(foreign_key="transaction.id")
    field: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))
    changed_by: Optional[str] = None


# ── Activity Report (Toimintakertomus / AoyL 10:2 §) ─────────────────────────
class ActivityReport(SQLModel, table=True):
    __tablename__ = "activity_report"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    year: int
    content_json: str # Store as JSON string (sections: [title, body])
    created_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))
    updated_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))


# ── User ───────────────────────────────────────────────────────────────────────
class User(SQLModel, table=True):
    __tablename__ = "user"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    is_active: bool = True

    companies: List["HousingCompany"] = Relationship(back_populates="owner")


# ── Budget (Talousarvio) ──────────────────────────────────────────────────────
class Budget(SQLModel, table=True):
    __tablename__ = "budget"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    category_id: int = Field(foreign_key="account_category.id")
    year: int
    amount: float

    company: Optional[HousingCompany] = Relationship()
    category: Optional[AccountCategory] = Relationship()


# ── Loan (Yhtiölaina) ────────────────────────────────────────────────────────
class CompanyLoan(SQLModel, table=True):
    __tablename__ = "company_loan"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id")
    name: str  # e.g. "Julkisivuremontti 2023"
    bank_name: str
    total_amount: float
    interest_rate: float
    due_date: Optional[datetime.date] = None

    company: Optional[HousingCompany] = Relationship()
    shares: List["ApartmentLoanShare"] = Relationship(back_populates="loan")


class ApartmentLoanShare(SQLModel, table=True):
    __tablename__ = "apartment_loan_share"

    id: Optional[int] = Field(default=None, primary_key=True)
    apartment_id: int = Field(foreign_key="apartment.id")
    loan_id: int = Field(foreign_key="company_loan.id")
    initial_share: float
    remaining_share: float

    loan: Optional[CompanyLoan] = Relationship(back_populates="shares")
    apartment: Optional["Apartment"] = Relationship()


# ── Audit Vault (Pysyvä arkisto / AoyL 10:1 §) ──────────────────────────────
class AuditVaultFile(SQLModel, table=True):
    __tablename__ = "audit_vault_file"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: int = Field(foreign_key="housing_company.id", index=True)
    category: str # "Pöytäkirjat", "Sopimukset", "Vakuutukset", "Muu"
    filename: str
    file_url: str
    year: int
    created_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(timezone.utc))
    notes: Optional[str] = None
