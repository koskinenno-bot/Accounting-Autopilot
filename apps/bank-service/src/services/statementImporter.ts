import { v4 as uuidv4 } from 'uuid';
import { BankTransaction, parseCamt053, parseCamtClosingBalance } from './camtParser';
import { assignEntryRefs, CsvFormatError, decodeStatement, parseBankCsv } from './csvParser';
import { publishBankStatementReceived } from '../utils/kafka';
import { serviceHeaders } from '../middleware/requireAuth';
import { reportBalance } from './balanceReport';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001/api/v1';

export type StatementFormat = 'camt053' | 'csv' | 'pdf';

export class StatementError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Tunnistus sisällöstä (tiedostopääte/MIME voivat olla harhaanjohtavia). */
export const detectFormat = (buffer: Buffer, filename = ''): StatementFormat => {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const head = decodeStatement(buffer.subarray(0, 2048)).trimStart();
  if (head.startsWith('<') && /BkToCstmrStmt|camt\.053/i.test(decodeStatement(buffer))) return 'camt053';
  if (head.startsWith('<')) throw new StatementError(400, 'XML-tiedosto ei ole camt.053-tiliote');
  if (/\.(xml)$/i.test(filename)) throw new StatementError(400, 'XML-tiedostoa ei voitu lukea');
  return 'csv';
};

/** PDF-tiliote ml-servicen tekoälyluvulla. */
const parsePdfStatement = async (buffer: Buffer): Promise<BankTransaction[]> => {
  let res: Response;
  try {
    res = await fetch(`${ML_SERVICE_URL}/ml/extract-bank-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...serviceHeaders() },
      body: JSON.stringify({ fileBase64: buffer.toString('base64') }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
  } catch (err: any) {
    throw new StatementError(503, `ml-serviceä ei tavoiteta PDF-tiliotteen lukuun: ${err.message}`);
  }
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new StatementError(res.status === 503 ? 503 : 422, body?.detail || `PDF-tiliotteen luku epäonnistui (${res.status})`);
  const txs: BankTransaction[] = (body.transactions || []).map((t: any) => ({
    bookingDate: t.bookingDate,
    amount: Math.round(Math.abs(Number(t.amount)) * 100) / 100,
    currency: 'EUR',
    creditDebit: t.direction === 'CRDT' ? 'CRDT' : 'DBIT',
    referenceNumber: t.referenceNumber?.replace(/\s+/g, '') || undefined,
    counterpartyName: t.counterpartyName || undefined,
    payerName: t.counterpartyName || undefined,
    payerIban: t.counterpartyIban?.replace(/\s+/g, '') || undefined,
    remittanceInfo: t.message || undefined,
    entryReference: t.archiveId || undefined,
  }));
  return assignEntryRefs(txs.filter((t) => t.bookingDate && t.amount > 0), 'PDF');
};

export const parseStatement = async (buffer: Buffer, filename = ''): Promise<{ format: StatementFormat; transactions: BankTransaction[] }> => {
  const format = detectFormat(buffer, filename);
  try {
    if (format === 'camt053') return { format, transactions: parseCamt053(decodeStatement(buffer)) };
    if (format === 'csv') return { format, transactions: parseBankCsv(decodeStatement(buffer)) };
    return { format, transactions: await parsePdfStatement(buffer) };
  } catch (err) {
    if (err instanceof CsvFormatError) throw new StatementError(400, err.message);
    throw err;
  }
};

/** Jäsentää tiliotteen ja välittää tapahtumat kirjanpitoon ja laskujen täsmäytykseen (Kafka). */
export const importStatement = async (companyId: string, buffer: Buffer, filename = '', bankAccountId = 'default-account') => {
  const { format, transactions } = await parseStatement(buffer, filename);
  if (transactions.length === 0) throw new StatementError(400, 'Tiliotteelta ei löytynyt tapahtumia');

  console.log(`Parsed ${transactions.length} transactions (${format}) for company ${companyId}`);
  await publishBankStatementReceived({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    data: { companyId, bankAccountId, transactions },
  });

  // camt.053: loppusaldo pankkitäsmäytykseen
  let closingBalance: { iban: string; date: string; amount: number } | null = null;
  if (format === 'camt053') {
    closingBalance = parseCamtClosingBalance(decodeStatement(buffer));
    if (closingBalance) await reportBalance(companyId, closingBalance.iban, closingBalance.date, closingBalance.amount, 'CAMT');
  }

  const incoming = transactions.filter((tx) => tx.creditDebit === 'CRDT');
  return {
    format, closingBalance,
    transactionCount: transactions.length,
    results: {
      totalTransactions: transactions.length,
      incomingPayments: incoming.length,
      matchedInvoices: incoming.filter((tx) => tx.referenceNumber).length,
    },
  };
};
