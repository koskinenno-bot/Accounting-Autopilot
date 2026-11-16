import { prisma } from '../db';
import { accountExists } from './chartOfAccountsService';
import { ACCOUNTS } from '../accounts';

/**
 * Käyttäjän korjauksista opittu tiliöinti. Kaksi tasoa:
 *  - toimittaja + viestin tunniste (esim. "rahoituspankki oyj|lainan korko"): ensisijainen
 *  - pelkkä toimittaja: vain jos toimittajalle on aina valittu sama tili
 * Samalle saajalle menee usein eri maksuja (pankki: lainan lyhennys, korko, palvelumaksu). Aiemmin yksi
 * korjaus (lyhennys -> 2500) opetti saman tilin kaikille saman saajan maksuille.
 */
const AMBIGUOUS = '';

/** Viestin tunniste: kirjaimet ilman numeroita, päivämääriä ja kuukausia, enintään 4 sanaa. */
export const messageSignature = (text: string | null | undefined, counterparty?: string | null): string => {
  let t = String(text ?? '').toLowerCase().replace(/^pankkitapahtuma:\s*/, '');
  const cp = String(counterparty ?? '').toLowerCase().trim();
  if (cp && t.startsWith(cp)) t = t.slice(cp.length);
  const months = /\b(tammikuu|helmikuu|maaliskuu|huhtikuu|toukokuu|kesäkuu|heinäkuu|elokuu|syyskuu|lokakuu|marraskuu|joulukuu)\w*/g;
  return t
    .replace(/\(lasku [^)]*\)/g, ' ')
    .replace(months, ' ')
    .replace(/[^a-zåäö]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 4)
    .join(' ');
};

export const signatureKey = (supplierKey: string, signature: string) => (signature ? `${supplierKey}|${signature}` : '');

export const getLearnedAccount = async (companyId: string, key: string): Promise<string | null> => {
  if (!key) return null;
  const rule = await prisma.supplierAccountRule.findUnique({
    where: { companyId_supplierKey: { companyId, supplierKey: key } },
  });
  if (!rule || rule.accountNumber === AMBIGUOUS || !(await accountExists(companyId, rule.accountNumber))) return null;
  return rule.accountNumber;
};

/**
 * Tallentaa käsittelijän valinnan. Selvitettäviä eriä, pankkia tai ostovelkoja/saamisia ei opita.
 * Jos toimittajalle valitaan eri tili kuin aiemmin, toimittajatason sääntö merkitään moniselitteiseksi
 * (ei enää käytetä), ja tili opitaan vain toimittaja + viesti -tasolla.
 */
export const recordAccountChoice = async (companyId: string, key: string, supplierName: string, accountNumber: string, signature = '') => {
  const ignored: string[] = [ACCOUNTS.SUSPENSE, ACCOUNTS.BANK, ACCOUNTS.PAYABLES, ACCOUNTS.RECEIVABLES];
  if (!key || ignored.includes(accountNumber)) return;
  const existing = await prisma.supplierAccountRule.findUnique({ where: { companyId_supplierKey: { companyId, supplierKey: key } } });
  const supplierAccount = existing && existing.accountNumber !== accountNumber ? AMBIGUOUS : accountNumber;
  await prisma.supplierAccountRule.upsert({
    where: { companyId_supplierKey: { companyId, supplierKey: key } },
    create: { companyId, supplierKey: key, supplierName, accountNumber: supplierAccount },
    update: { accountNumber: supplierAccount, supplierName, timesUsed: { increment: 1 } },
  });
  const sigKey = signatureKey(key, signature);
  if (sigKey) {
    await prisma.supplierAccountRule.upsert({
      where: { companyId_supplierKey: { companyId, supplierKey: sigKey } },
      create: { companyId, supplierKey: sigKey, supplierName, accountNumber },
      update: { accountNumber, supplierName, timesUsed: { increment: 1 } },
    });
  }
  console.log(`Opittiin: ${supplierName}${signature ? ` (${signature})` : ''} -> ${accountNumber}${supplierAccount === AMBIGUOUS ? ' (saajalla useita tilejä)' : ''}`);
};
