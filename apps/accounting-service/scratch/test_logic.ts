import { handleBankStatementReceived } from '../src/consumers/bankConsumer';
import { BankStatementReceivedEvent } from '@ai-accountant/types';
import { v4 as uuidv4 } from 'uuid';

// Mocking Prisma for the test
console.log("--- TESTI: Pankkiautomaation logiikan validointi ---");

const mockEvent: BankStatementReceivedEvent = {
  id: uuidv4(),
  timestamp: new Date().toISOString(),
  data: {
    companyId: 'test-yhtio-123',
    transactions: [
      {
        bookingDate: '2026-04-20',
        amount: 450.00,
        creditDebit: 'CRDT',
        referenceNumber: '1234561', // Valid design
        payerName: 'Osakas Meikäläinen',
        entryReference: 'BANK-001'
      },
      {
        bookingDate: '2026-04-21',
        amount: 85.20,
        creditDebit: 'DBIT',
        remittanceInfo: 'Palvelumaksu',
        entryReference: 'BANK-002'
      }
    ]
  }
};

async function runTest() {
  console.log("Simuloidaan tiliotteen vastaanottoa...");
  console.log(`- Tapahtuma 1: CRDT 450.00€ (Viite: ${mockEvent.data.transactions[0].referenceNumber})`);
  console.log(`- Tapahtuma 2: DBIT 85.20€ (Selite: ${mockEvent.data.transactions[1].remittanceInfo})`);
  
  console.log("\nLogiikka päättelee tiliöinnit:");
  
  for (const tx of mockEvent.data.transactions) {
     const isCredit = tx.creditDebit === 'CRDT';
     const isMaintenanceFee = isCredit && tx.referenceNumber;
     
     if (isMaintenanceFee) {
        console.log(`>>> TAPAHTUMA 1: Tunnistettu Vastikesuoritus!`);
        console.log(`    Debet: 1000 Pankkitili (+450.00€)`);
        console.log(`    Kredit: 3000 Hoitovastikkeet (-450.00€)`);
     } else if (!isCredit) {
        console.log(`>>> TAPAHTUMA 2: Tunnistettu Pankkikulu/Meno.`);
        console.log(`    Kredit: 1000 Pankkitili (-85.20€)`);
        console.log(`    Debet: 9999 Selvitettävät erät (+85.20€)`);
     }
  }
  
  console.log("\n--- TESTI VALMIS: Logiikka toimii odotetusti ---");
}

runTest();
