import { AccountType } from '../../prisma/client';
import { prisma } from '../db';

/**
 * Taloyhtiön tilikarttapohja (TATO-henkinen yksinkertaistus).
 * Numeroalueet vastaavat reporting-servicen ryhmittelyä ja ML-palvelun ehdotuksia:
 *   1xxx vastaavaa, 2xxx vastattavaa,
 *   3000–3899 hoitotuotot, 3900–3999 pääomavastikkeet / rahoitustuotot,
 *   4000–7999 hoitokulut, 8000–8999 rahoituskulut, 9xxx verot.
 * Muutos 1.11.2026: Isännöinti siirretty 8000 -> 4000 (oli väärin rahoituskuluissa) ja
 * energiakulut/vakuutukset uudelleennumeroitu.
 */
export const TATO_TEMPLATE = [
  // VASTAAVAA (ASSETS)
  { number: '1000', name: 'Maa-alueet', type: AccountType.ASSET },
  { number: '1010', name: 'Rakennukset ja rakennelmat', type: AccountType.ASSET },
  { number: '1700', name: 'Myyntisaamiset', type: AccountType.ASSET },
  { number: '1900', name: 'Pankkitili 1', type: AccountType.ASSET },
  { number: '1990', name: 'Selvitettävät erät', type: AccountType.ASSET },

  // VASTATTAVAA (EQUITY & LIABILITIES)
  { number: '2000', name: 'Osakepääoma', type: AccountType.EQUITY },
  { number: '2100', name: 'Edellisten tilikausien voitto/tappio', type: AccountType.EQUITY },
  { number: '2200', name: 'Tilikauden tulos', type: AccountType.EQUITY },
  { number: '2500', name: 'Lainat rahoituslaitoksilta', type: AccountType.LIABILITY },
  { number: '2800', name: 'Ostovelat', type: AccountType.LIABILITY },

  // HOITOTUOTOT
  { number: '3000', name: 'Hoitovastikkeet', type: AccountType.REVENUE },
  { number: '3100', name: 'Vesimaksut', type: AccountType.REVENUE },
  { number: '3200', name: 'Autopaikkamaksut', type: AccountType.REVENUE },
  { number: '3300', name: 'Saunamaksut', type: AccountType.REVENUE },
  // PÄÄOMAVASTIKKEET / RAHOITUSTUOTOT
  { number: '3900', name: 'Pääomavastikkeet', type: AccountType.REVENUE },
  { number: '3950', name: 'Korkotuotot', type: AccountType.REVENUE },

  // HOITOKULUT
  { number: '4000', name: 'Hallinto ja isännöinti', type: AccountType.EXPENSE },
  { number: '4100', name: 'Kiinteistönhoito ja huolto', type: AccountType.EXPENSE },
  { number: '4300', name: 'Puhtaanapito ja jätehuolto', type: AccountType.EXPENSE },
  { number: '4500', name: 'Lämmitys', type: AccountType.EXPENSE },
  { number: '4600', name: 'Vesi ja jätevesi', type: AccountType.EXPENSE },
  { number: '4700', name: 'Sähkö ja kaasu', type: AccountType.EXPENSE },
  { number: '4800', name: 'Vakuutukset', type: AccountType.EXPENSE },
  { number: '4900', name: 'Pankkikulut', type: AccountType.EXPENSE },
  { number: '7000', name: 'Korjaukset', type: AccountType.EXPENSE },

  // RAHOITUSKULUT
  { number: '8000', name: 'Lainojen korot', type: AccountType.EXPENSE },
];

export const initializeChartOfAccounts = async (companyId: string) => {
  const accounts = TATO_TEMPLATE.map(account => ({
    companyId,
    accountNumber: account.number,
    accountName: account.name,
    accountType: account.type,
  }));

  return await prisma.account.createMany({
    data: accounts,
    skipDuplicates: true,
  });
};

export const accountExists = async (companyId: string, accountNumber: string) => {
  const account = await prisma.account.findUnique({
    where: { companyId_accountNumber: { companyId, accountNumber } },
  });
  return Boolean(account);
};

export const getAccounts = async (companyId: string) => {
  return await prisma.account.findMany({
    where: { companyId },
    orderBy: { accountNumber: 'asc' },
  });
};
