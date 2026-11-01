import { prisma } from '../db';
import { accountExists } from './chartOfAccountsService';
import { ACCOUNTS } from '../accounts';

/**
 * Käyttäjän korjauksista opittu tiliöinti (toimittaja -> tili). Ensisijainen lähde ennen
 * ML-ehdotusta: kun käsittelijä on kerran valinnut toimittajalle tilin, sama tili tulee jatkossa.
 */
export const getLearnedAccount = async (companyId: string, key: string): Promise<string | null> => {
  if (!key) return null;
  const rule = await prisma.supplierAccountRule.findUnique({
    where: { companyId_supplierKey: { companyId, supplierKey: key } },
  });
  if (!rule || !(await accountExists(companyId, rule.accountNumber))) return null;
  return rule.accountNumber;
};

/** Tallentaa käsittelijän valinnan. Selvitettäviä eriä, pankkia tai velkatilejä ei opita. */
export const recordAccountChoice = async (companyId: string, key: string, supplierName: string, accountNumber: string) => {
  const ignored: string[] = [ACCOUNTS.SUSPENSE, ACCOUNTS.BANK, ACCOUNTS.PAYABLES, ACCOUNTS.RECEIVABLES];
  if (!key || ignored.includes(accountNumber)) return;
  await prisma.supplierAccountRule.upsert({
    where: { companyId_supplierKey: { companyId, supplierKey: key } },
    create: { companyId, supplierKey: key, supplierName, accountNumber },
    update: { accountNumber, supplierName, timesUsed: { increment: 1 } },
  });
  console.log(`Opittiin: ${supplierName} -> ${accountNumber} (yhtiö ${companyId})`);
};
