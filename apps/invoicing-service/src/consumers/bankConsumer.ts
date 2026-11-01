import { PrismaClient } from '@prisma/client';
import { BankStatementReceivedEvent } from '@ai-accountant/types';
import { publishInvoiceStatusChanged } from '../utils/kafka';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export const handleBankStatementReceived = async (event: BankStatementReceivedEvent) => {
  const { companyId, transactions } = event.data;

  for (const tx of transactions) {
    if (tx.creditDebit === 'CRDT' && tx.referenceNumber) {
      console.log(`Checking match for reference number: ${tx.referenceNumber}`);
      
      const invoice = await prisma.invoice.findFirst({
        where: {
          companyId,
          referenceNumber: tx.referenceNumber,
          status: { not: 'PAID' }
        }
      });

      if (invoice) {
        console.log(`Match found! Updating invoice ${invoice.invoiceNumber} to PAID`);
        
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID' }
        });

        // Publish status change
        await publishInvoiceStatusChanged({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          data: {
            invoiceId: invoice.id,
            companyId,
            status: 'PAID'
          }
        });
      }
    }
  }
};
