/**
 * Shared Type Definitions for AI Accountant v3
 * Based on System Architecture v1.0
 */

export * from './events';

export type UUID = string;
export type Timestamp = Date;
export type Decimal = number; // Using number for simple prototype, consider decimal.js for production

export interface Address {
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface Company {
  id: UUID;
  businessId: string;
  name: string;
  housingCooperativeId: string;
  address: Address;
  fiscalYearStart: Date;
  fiscalYearEnd: Date;
  chartOfAccountsTemplate: string;
  settings: CompanySettings;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CompanySettings {
  defaultCurrency: string;
  vatRegistered: boolean;
  language: string;
  timezone: string;
  invoiceNumberPrefix: string;
  fiscalYearLock: boolean;
}

export interface AccountingEntry {
  id: UUID;
  companyId: UUID;
  entryDate: Date;
  voucherNumber: string;
  description: string;
  lines: AccountingLine[];
  vouchers: UUID[];
  status: 'draft' | 'posted' | 'locked';
  postedBy: UUID;
  postedAt: Timestamp;
  createdBy: UUID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  version: number;
}

export interface AccountingLine {
  id: UUID;
  accountNumber: string;
  debit: Decimal;
  credit: Decimal;
  description: string;
  costCenter?: string;
  project?: string;
  vatCode?: string;
  vatAmount?: Decimal;
}

export interface Shareholder {
  id: UUID;
  companyId: UUID;
  personType: 'individual' | 'company';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  personalId?: string;
  businessId?: string;
  email: string;
  phone: string;
  address: Address;
  shares: Share[];
  userId?: UUID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Share {
  id: UUID;
  shareNumbers: string[];
  apartment: Apartment;
  ownershipStart: Date;
  ownershipEnd?: Date;
  ownershipPercentage: Decimal;
}

export interface Apartment {
  number: string;
  address: string;
  floor: number;
  rooms: number;
  squareMeters: Decimal;
  shareOfCommonExpenses: Decimal;
}

export interface Invoice {
  id: UUID;
  companyId: UUID;
  shareholderId: UUID;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  referenceNumber: string;
  lines: InvoiceLine[];
  subtotal: Decimal;
  vatAmount: Decimal;
  total: Decimal;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  sentAt?: Timestamp;
  paidAt?: Timestamp;
  paidAmount?: Decimal;
  remindersSent: number;
  lastReminderSent?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InvoiceLine {
  id: UUID;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal;
  vatRate: Decimal;
  amount: Decimal;
  accountNumber: string;
  type: 'maintenance_fee' | 'water' | 'heating' | 'other';
}

export interface Voucher {
  id: UUID;
  companyId: UUID;
  voucherType: 'purchase' | 'sale' | 'bank' | 'other';
  voucherDate: Date;
  supplier?: string;
  customer?: string;
  amount: Decimal;
  vatAmount?: Decimal;
  files: VoucherFile[];
  ocrStatus: 'pending' | 'processing' | 'completed' | 'failed';
  ocrData?: any; // Simplified for now
  mlClassification?: any; // Simplified for now
  suggestedAccount?: string;
  accountingEntryId?: UUID;
  status: 'unprocessed' | 'classified' | 'posted' | 'archived';
  uploadedBy: UUID;
  uploadedAt: Timestamp;
  processedAt?: Timestamp;
}

export interface VoucherFile {
  id: UUID;
  filename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  s3Bucket: string;
  checksum: string;
}

export enum Role {
  SUPER_ADMIN = 'super_admin',
  COMPANY_ADMIN = 'company_admin',
  BOARD_MEMBER = 'board_member',
  PROPERTY_MANAGER = 'property_manager',
  SHAREHOLDER = 'shareholder',
  ACCOUNTANT = 'accountant',
  VIEWER = 'viewer'
}
