from datetime import date, datetime
from typing import List, Optional
import re

from pydantic import BaseModel, field_validator

from models import AccountType, MatchType


# ── Auth ──────────────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    email: str
    password: str


class UserRead(BaseModel):
    id: int
    email: str
    is_active: bool


# ── Housing Company ───────────────────────────────────────────────────────────
class HousingCompanyRead(BaseModel):
    id: int
    name: str
    business_id: str
    bank_account: str

class PortfolioCompanyRead(BaseModel):
    id: int
    name: str
    business_id: str
    bank_account: str
    unverified_transactions: int
    unpaid_apartments: int
    total_cash: float


class HousingCompanyCreate(BaseModel):
    name: str
    business_id: str
    bank_account: str

    @field_validator('business_id')
    @classmethod
    def validate_business_id(cls, v: str) -> str:
        """Validates Finnish Y-tunnus format (NNNNNNN-C) and checksum."""
        v = v.strip()
        if not re.match(r'^\d{7}-\d$', v):
            raise ValueError('Y-tunnus tulee olla muodossa NNNNNNN-C, esim. 1234567-8')
        digits = v.replace('-', '')
        base, check = digits[:7], int(digits[7])
        weights = [7, 9, 10, 5, 8, 4, 2]
        total = sum(int(d) * w for d, w in zip(base, weights))
        remainder = total % 11
        if remainder == 1:
            raise ValueError('Y-tunnus on virheellinen (tarkistussumma 1 ei ole sallittu)')
        expected = 0 if remainder == 0 else 11 - remainder
        if expected != check:
            raise ValueError(f'Y-tunnuksen tarkistusnum\u00e4\u00e4r\u00e4 on v\u00e4\u00e4rin (odotettiin {expected})')
        return v

    @field_validator('bank_account')
    @classmethod
    def validate_iban(cls, v: str) -> str:
        """Basic Finnish IBAN validation (FI + 16 digits)."""
        v = v.strip().replace(' ', '')
        if not re.match(r'^FI\d{16}$', v, re.IGNORECASE):
            raise ValueError('Pankkitilin tulee olla suomalainen IBAN (FI + 16 num\u00e4\u00e4r\u00e4\u00e4 = 18 merkki\u00e4)')
        return v.upper()


# ── Apartment ─────────────────────────────────────────────────────────────────
class ApartmentRead(BaseModel):
    id: int
    company_id: int
    apartment_number: str
    owner_name: str
    monthly_fee: float
    reference_number: str


class ApartmentCreate(BaseModel):
    apartment_number: str
    owner_name: str
    monthly_fee: float
    reference_number: str


# ── Account Category ──────────────────────────────────────────────────────────
class AccountCategoryRead(BaseModel):
    id: int
    code: str
    name: str
    type: AccountType
    normal_balance: str = "DEBIT"
    vat_percentage: Optional[float] = None


class AccountCategoryCreate(BaseModel):
    code: str
    name: str
    type: AccountType
    normal_balance: str = "DEBIT"     # DEBIT = assets/expenses, CREDIT = liabilities/revenue
    vat_percentage: Optional[float] = None  # 25.5, 24.0, 14.0, 10.0, tai None = ALV-vapaa


class AccountCategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[AccountType] = None
    normal_balance: Optional[str] = None
    vat_percentage: Optional[float] = None   # 0 = poista ALV-merkintä


# ── Transaction ───────────────────────────────────────────────────────────────
class TransactionRead(BaseModel):
    id: int
    company_id: int
    date: date
    amount: float
    description: str
    reference_number: Optional[str]
    transaction_hash: Optional[str]
    iban: Optional[str]
    service_period: Optional[str]
    is_partial_payment: bool
    category_id: Optional[int]
    category_code: Optional[str]
    category_name: Optional[str]
    matched_apartment_id: Optional[int]
    matched_apartment_number: Optional[str]
    match_type: MatchType
    
    # Audit Shield Fields
    is_verified: bool
    verified_at: Optional[datetime]
    verified_by: Optional[str]
    notes: Optional[str] = None
    receipt_url: Optional[str] = None
    voucher_number: Optional[str] = None
    accounting_date: Optional[date] = None


class TransactionUpdate(BaseModel):
    category_id: Optional[int] = None
    is_verified: Optional[bool] = None
    notes: Optional[str] = None


class ImportResult(BaseModel):
    total_imported: int
    reference_matches: int
    rule_matches: int
    ai_matches: int
    unmatched: int


class ReceiptExtractionResult(BaseModel):
    vendor: str
    amount: float
    date: date
    suggested_category_code: Optional[str]
    suggested_transaction_id: Optional[int]
    receipt_url: str


class ImportJobRead(BaseModel):
    id: int
    company_id: int
    filename: str
    created_at: datetime


class MatchingRuleRead(BaseModel):
    id: int
    company_id: int
    keyword_pattern: str
    iban: Optional[str]
    account_category_id: int
    category_code: Optional[str]
    category_name: Optional[str]

class BudgetRead(BaseModel):
    id: Optional[int]
    company_id: int
    category_id: int
    year: int
    amount: float
    category_code: Optional[str] = None
    category_name: Optional[str] = None

class BudgetCreate(BaseModel):
    category_id: int
    year: int
    amount: float

class BudgetUpdate(BaseModel):
    amount: float


class MatchingRuleCreate(BaseModel):
    keyword_pattern: str
    iban: Optional[str] = None
    account_category_id: int


# ── Payment Status ────────────────────────────────────────────────────────────
class PaymentStatus(BaseModel):
    apartment_id: int
    apartment_number: str
    owner_name: str
    monthly_fee: float
    paid: bool
    transaction_id: Optional[int]


# ── Dashboard KPIs ────────────────────────────────────────────────────────────
class DashboardKpi(BaseModel):
    total_cash: float
    monthly_revenue: float
    monthly_expenses: float
    monthly_result: float
    paid_apartments: int
    total_apartments: int


# ── Reports ───────────────────────────────────────────────────────────────────
class ReportLine(BaseModel):
    code: str
    name: str
    amount: float
    budget_amount: float = 0.0
    variance: float = 0.0



class ReportSection(BaseModel):
    name: str
    lines: List[ReportLine]
    total: float


class IncomeStatement(BaseModel):
    period_start: date
    period_end: date
    revenue_groups: List[ReportSection]
    expense_groups: List[ReportSection]
    total_revenue: float
    total_expenses: float
    operating_margin: float  # Hoitokate (Revenue - Expenses)
    financial_groups: List[ReportSection]
    net_result: float


class BalanceSheet(BaseModel):
    as_of: date
    asset_groups: List[ReportSection]
    liability_groups: List[ReportSection]
    total_assets: float
    total_liabilities: float  # Equity + Liabilities


class JournalEntry(BaseModel):
    id: int
    date: date
    description: str
    amount: float
    category_code: Optional[str]
    category_name: Optional[str]
    is_verified: bool
    apartment_number: Optional[str]
    voucher_number: Optional[str]
    receipt_url: Optional[str]


class JournalReport(BaseModel):
    period_start: date
    period_end: date
    entries: List[JournalEntry]
    total_in: float
    total_out: float


class LedgerAccount(BaseModel):
    code: str
    name: str
    entries: List[JournalEntry]
    total_debit: float
    total_credit: float
    balance: float


class GeneralLedgerReport(BaseModel):
    period_start: date
    period_end: date
    accounts: List[LedgerAccount]
    total_debit: float
    total_credit: float


class PaymentDemand(BaseModel):
    apartment_number: str
    owner_name: str
    amount: float
    due_date: date
    reference_number: str
    iban: str
    receiver_name: str
    receiver_business_id: str
    virtual_barcode: str


class ApartmentLoanShareRead(BaseModel):
    id: int
    apartment_id: int
    loan_id: int
    initial_share: float
    remaining_share: float


class CompanyLoanRead(BaseModel):
    id: int
    name: str
    bank_name: str
    total_amount: float
    interest_rate: float
    due_date: Optional[date]
    shares: List[ApartmentLoanShareRead] = []


class CompanyLoanCreate(BaseModel):
    name: str
    bank_name: str
    total_amount: float
    interest_rate: float
    due_date: Optional[date] = None



class ActivityReportRead(BaseModel):
    id: int
    company_id: int
    year: int
    content_json: str
    created_at: datetime
    updated_at: datetime

class ActivityReportCreate(BaseModel):
    year: int
    content_json: str
