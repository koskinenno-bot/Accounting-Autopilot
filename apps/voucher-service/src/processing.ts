import { v4 as uuidv4 } from 'uuid';
import { VoucherExtraction } from '@ai-accountant/types';
import { PrismaClient } from '../prisma/client';
import { publishVoucherClassified } from './utils/kafka';
import { serviceHeaders } from './middleware/requireAuth';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8001/api/v1';
const ACCOUNTING_SERVICE_URL = process.env.ACCOUNTING_SERVICE_URL || 'http://localhost:3002/api/v1';

/** Yhtiön tilikartta tekoälyn tiliehdotusta varten (tyhjä lista, jos ei saatavilla). */
const fetchAccounts = async (companyId: string) => {
  try {
    const res = await fetch(`${ACCOUNTING_SERVICE_URL}/accounting/accounts?companyId=${encodeURIComponent(companyId)}`, {
      headers: serviceHeaders(),
    });
    if (!res.ok) return [];
    const accounts = (await res.json()) as { accountNumber: string; accountName: string }[];
    return accounts.map(({ accountNumber, accountName }) => ({ accountNumber, accountName }));
  } catch {
    return [];
  }
};

/**
 * Tositteen luku taustalla: ml-service (Claude tai PDF-varajäsennin) -> tositteen tiedot kantaan
 * -> voucher.classified (accounting-service tekee ostolaskun ja kirjausluonnoksen).
 */
export const processVoucher = async (
  prisma: PrismaClient,
  voucherId: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
) => {
  const voucher = await prisma.voucher.update({ where: { id: voucherId }, data: { ocrStatus: 'PROCESSING' } });
  let extraction: VoucherExtraction | undefined;
  let error: string | undefined;

  try {
    const res = await fetch(`${ML_SERVICE_URL}/ml/extract-voucher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...serviceHeaders() },
      body: JSON.stringify({
        fileBase64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
        filename: file.originalname,
        accounts: await fetchAccounts(voucher.companyId),
      }),
      signal: AbortSignal.timeout(5 * 60_000), // tekoälyluku voi kestää
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) extraction = body as VoucherExtraction;
    else error = body?.detail || `Tositteen luku epäonnistui (${res.status})`;
  } catch (err: any) {
    error = `ml-serviceä ei tavoiteta: ${err.message}`;
  }

  await prisma.voucher.update({
    where: { id: voucherId },
    data: extraction
      ? {
          ocrStatus: 'COMPLETED',
          ocrData: extraction as any,
          supplier: extraction.supplierName,
          amount: extraction.totalAmount ?? undefined,
          vatAmount: extraction.vatAmount ?? undefined,
          voucherDate: extraction.invoiceDate ? new Date(extraction.invoiceDate) : undefined,
          suggestedAccount: extraction.suggestedAccount,
          mlClassification: { confidence: extraction.confidence, reason: extraction.accountReason, extractor: extraction.extractor },
          status: 'CLASSIFIED',
          processedAt: new Date(),
        }
      : { ocrStatus: 'FAILED', ocrData: { error }, processedAt: new Date() },
  });

  await publishVoucherClassified({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    data: {
      voucherId,
      companyId: voucher.companyId,
      suggestedAccount: extraction?.suggestedAccount || '1990',
      confidence: extraction?.confidence ?? 0,
      amount: extraction?.totalAmount ?? undefined,
      date: extraction?.invoiceDate ?? undefined,
      supplier: extraction?.supplierName ?? undefined,
      extraction,
      error,
    },
  });
  console.log(extraction
    ? `Tosite ${voucherId} luettu (${extraction.extractor}): ${extraction.supplierName} ${extraction.totalAmount} €`
    : `Tositteen ${voucherId} luku epäonnistui: ${error}`);
};
