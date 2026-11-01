import { PrismaClient } from '@prisma/client';
import * as referenceService from './referenceService';

const FIRST_INVOICE_NUMBER = 1001;

/**
 * Varaa yhtiölle seuraavan laskunumeron atomisesti.
 * Aiemmin numero laskettiin "viimeisin + 1" -kyselyllä, jolloin rinnakkaiset
 * pyynnöt saivat saman numeron ja toisen yhtiön laskut törmäsivät globaaliin
 * uniikkirajoitteeseen.
 */
export const nextInvoiceNumber = async (prisma: PrismaClient, companyId: string): Promise<string> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.invoiceCounter.findUnique({ where: { companyId } });
    if (existing) {
      const updated = await prisma.invoiceCounter.update({
        where: { companyId },
        data: { lastNumber: { increment: 1 } },
      });
      return String(updated.lastNumber);
    }

    // Ensimmäinen lasku tai siirtymä vanhasta numeroinnista: jatketaan suurimmasta olemassa olevasta.
    const invoices = await prisma.invoice.findMany({ where: { companyId }, select: { invoiceNumber: true } });
    const maxExisting = invoices.reduce((max: number, inv: { invoiceNumber: string }) => {
      const n = parseInt(inv.invoiceNumber, 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, FIRST_INVOICE_NUMBER - 1);

    try {
      const created = await prisma.invoiceCounter.create({
        data: { companyId, lastNumber: maxExisting + 1 },
      });
      return String(created.lastNumber);
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error; // toinen pyyntö ehti luoda laskurin, yritetään uudelleen
    }
  }
  throw new Error(`Laskunumeron varaus epäonnistui yhtiölle ${companyId}`);
};

/** Viitenumeron perusosa: yhtiön tunnisteen 4 viimeistä merkkiä numeroiksi + laskunumero. */
export const referenceFor = (companyId: string, invoiceNumber: string): string => {
  const baseRef = companyId.slice(-4).replace(/[^0-9]/g, '0') + invoiceNumber;
  return referenceService.calculateFinnishReference(baseRef);
};
