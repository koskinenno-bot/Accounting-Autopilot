// core types
export type MatchType = 'REFERENCE' | 'RULE' | 'AI' | 'MANUAL' | 'UNMATCHED';

export type AccountType = 'Revenue' | 'Expense' | 'Asset' | 'Liability';

export interface User {
  id: number;
  email: string;
  is_active: boolean;
}

export interface HousingCompany {
  id: number;
  name: string;
  business_id: string;
  bank_account: string;
  is_vat_registered: boolean;
}

export interface Apartment {
  id: number;
  company_id: number;
  apartment_number: string;
  owner_name: string;
  monthly_fee: number;
  reference_number: string;
}

export interface AccountCategory {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: 'DEBIT' | 'CREDIT';
  vat_percentage: number | null;
}

export interface Transaction {
  id: number;
  company_id: number;
  date: string;
  amount: number;
  description: string;
  reference_number: string | null;
  transaction_hash: string | null;
  iban: string | null;
  service_period: string | null;
  is_partial_payment: boolean;
  category_id: number | null;
  category_code: string | null;
  category_name: string | null;
  matched_apartment_id: number | null;
  matched_apartment_number: string | null;
  match_type: MatchType;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  notes: string | null;
  receipt_url: string | null;
  voucher_number: string | null;
  accounting_date: string | null;
}

export interface LockedPeriod {
  id: number;
  company_id: number;
  year: number;
  month: number;
  locked_at: string;
  locked_by: string | null;
}

// Reports and Dashboard
export interface DashboardKpi {
  total_cash: number;
  monthly_revenue: number;
  monthly_expenses: number;
  monthly_result: number;
  paid_apartments: number;
  total_apartments: number;
}

export interface PaymentStatus {
  apartment_id: number;
  apartment_number: string;
  owner_name: string;
  monthly_fee: number;
  paid: boolean;
  transaction_id: number | null;
}

export interface ReportLine {
  code: string;
  name: string;
  amount: number;
  budget_amount: number;
  variance: number;
}


export interface ReportSection {
  name: string;
  lines: ReportLine[];
  total: number;
}

export interface IncomeStatement {
  period_start: string;
  period_end: string;
  revenue_groups: ReportSection[];
  expense_groups: ReportSection[];
  total_revenue: number;
  total_expenses: number;
  operating_margin: number;
  financial_groups: ReportSection[];
  net_result: number;
}

export interface BalanceSheet {
  as_of: string;
  asset_groups: ReportSection[];
  liability_groups: ReportSection[];
  total_assets: number;
  total_liabilities: number;
}

export interface JournalEntry {
  id: number;
  date: string;
  description: string;
  amount: number;
  category_code: string | null;
  category_name: string | null;
  is_verified: boolean;
  apartment_number: string | null;
  voucher_number: string | null;
  receipt_url: string | null;
}
export interface JournalReport {
  period_start: string;
  period_end: string;
  entries: JournalEntry[];
  total_in: number;
  total_out: number;
}

export interface LedgerAccount {
  code: string;
  name: string;
  entries: JournalEntry[];
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface GeneralLedgerReport {
  period_start: string;
  period_end: string;
  accounts: LedgerAccount[];
  total_debit: number;
  total_credit: number;
}

export interface PaymentDemand {
  apartment_number: string;
  owner_name: string;
  amount: number;
  due_date: string;
  reference_number: string;
  iban: string;
  receiver_name: string;
  receiver_business_id: string;
  virtual_barcode: string;
}




export interface ImportResult {
  total_imported: number;
  reference_matches: number;
  rule_matches: number;
  ai_matches: number;
  unmatched: number;
}

export interface ImportJob {
  id: number;
  company_id: number;
  filename: string;
  created_at: string;
}

export interface MatchingRule {
  id: number;
  company_id: number;
  keyword_pattern: string;
  iban: string | null;
  account_category_id: number;
  category_code: string | null;
  category_name: string | null;
}

export interface TransactionAudit {
  id: number;
  transaction_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string | null;
}

export interface ActivityReportRead {
  id: number;
  company_id: number;
  year: number;
  content_json: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetRead {
  id: number;
  company_id: number;
  category_id: number;
  year: number;
  amount: number;
  category_code?: string;
  category_name?: string;
}

export interface ApartmentLoanShareRead {
  id: number;
  apartment_id: number;
  loan_id: number;
  initial_share: number;
  remaining_share: number;
}

export interface CompanyLoanRead {
  id: number;
  company_id: number;
  name: string;
  bank_name: string;
  total_amount: number;
  interest_rate: number;
  due_date: string | null;
  shares: ApartmentLoanShareRead[];
}

export interface FinancialNote {
  id: number;
  company_id: number;
  year: number;
  note_type: string;
  content: string;
  updated_at: string;
}

// ── KPL 2:1 § Double-Entry / Journalizer ───────────────────────
export interface JournalLine {
  id: number;
  transaction_id: number;
  side: 'DEBIT' | 'CREDIT';
  account_code: string;
  account_name: string;
  amount: number;
  created_at: string;
}

// ── Vastikerahoituslaskelma (AsOyL 10:5 §) ─────────────────
export interface VastikelaskelmaGroup {
  lines: { code: string; name: string; amount: number }[];
  total: number;
}

export interface VastikelaskelmaReport {
  company_name: string;
  business_id: string;
  year: number;
  legal_basis: string;
  tuotot: {
    hoitovastikkeet: VastikelaskelmaGroup;
    muut_hoitotuotot: VastikelaskelmaGroup;
    total: number;
  };
  kulut: {
    henkilostokulut: VastikelaskelmaGroup;
    hallintokulut: VastikelaskelmaGroup;
    kaytto_ja_huolto: VastikelaskelmaGroup;
    ulkoalueet: VastikelaskelmaGroup;
    siivous: VastikelaskelmaGroup;
    lammitys_ja_vesi: VastikelaskelmaGroup;
    sahko_ja_kaasu: VastikelaskelmaGroup;
    muut_hoitokulut: VastikelaskelmaGroup;
    total: number;
  };
  hoitokate: number;
}

// ── ALV-raportti ─────────────────────────────────
export interface VatTransaction {
  date: string;
  voucher_number: string | null;
  description: string;
  vat_receivable: number;
  vat_payable: number;
}

export interface VatReport {
  company_name: string;
  business_id: string;
  period: string;
  start_date: string;
  end_date: string;
  vat_receivable: number;
  vat_payable: number;
  net_vat: number;
  net_vat_label: string;
  transactions: VatTransaction[];
}
