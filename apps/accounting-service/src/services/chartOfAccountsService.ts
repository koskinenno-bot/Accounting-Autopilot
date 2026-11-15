import { AccountType } from '../../prisma/client';
import { prisma } from '../db';

/**
 * Taloyhtiön tilikarttapohja (As Oy ja KOY). Rakenne seuraa taloyhtiöiden vakiintunutta tilikarttaa
 * ja PMA:n / KPA:n tuloslaskelma- ja tasekaavaa. Numeroalueet vastaavat reporting-servicen ryhmittelyä:
 *   1000-1499 pysyvät vastaavat, 1500-1899 saamiset, 1900-1989 rahat, 1990 selvitettävät,
 *   2000-2399 oma pääoma, 2400-2699 pitkäaikainen vieras pääoma, 2700-2999 lyhytaikainen,
 *   3000-3899 hoitotuotot, 3900-3999 pääomavastikkeet ja rahoitustuotot,
 *   4000-7999 hoitokulut (6900-6999 poistot), 8000-8999 rahoituskulut, 9000-9999 tuloverot.
 * Automaation käyttämät tilit (src/accounts.ts) ja vanhat numerot pysyvät ennallaan.
 * Uudet tilit lisätään olemassa oleville yhtiöille käynnistyksessä (syncChartTemplates).
 */
const A = AccountType;
export const TATO_TEMPLATE: { number: string; name: string; type: AccountType }[] = [
  // VASTAAVAA: pysyvät vastaavat
  { number: '1000', name: 'Maa-alueet', type: A.ASSET },
  { number: '1010', name: 'Rakennukset ja rakennelmat', type: A.ASSET },
  { number: '1020', name: 'Rakennusten perusparannukset', type: A.ASSET },
  { number: '1050', name: 'Koneet ja kalusto', type: A.ASSET },
  { number: '1080', name: 'Ennakkomaksut ja keskeneräiset hankinnat', type: A.ASSET },
  { number: '1100', name: 'Osakkeet ja osuudet', type: A.ASSET },
  // vaihtuvat vastaavat
  { number: '1700', name: 'Myyntisaamiset', type: A.ASSET },
  { number: '1750', name: 'Arvonlisäverosaamiset', type: A.ASSET },
  { number: '1760', name: 'Muut saamiset', type: A.ASSET },
  { number: '1800', name: 'Siirtosaamiset', type: A.ASSET },
  { number: '1900', name: 'Pankkitili 1', type: A.ASSET },
  { number: '1910', name: 'Pankkitili 2 (pääomavastikkeet)', type: A.ASSET },
  { number: '1920', name: 'Säästö- ja määräaikaistilit', type: A.ASSET },
  { number: '1990', name: 'Selvitettävät erät', type: A.ASSET },

  // VASTATTAVAA: oma pääoma
  { number: '2000', name: 'Osakepääoma', type: A.EQUITY },
  { number: '2020', name: 'Rakennusrahasto', type: A.EQUITY },
  { number: '2030', name: 'Vararahasto', type: A.EQUITY },
  { number: '2040', name: 'Sijoitetun vapaan oman pääoman rahasto', type: A.EQUITY },
  { number: '2050', name: 'Muut rahastot (korjausrahasto)', type: A.EQUITY },
  { number: '2100', name: 'Edellisten tilikausien voitto/tappio', type: A.EQUITY },
  { number: '2200', name: 'Tilikauden tulos', type: A.EQUITY },
  // vieras pääoma
  { number: '2500', name: 'Lainat rahoituslaitoksilta', type: A.LIABILITY },
  { number: '2550', name: 'Muut pitkäaikaiset velat', type: A.LIABILITY },
  { number: '2700', name: 'Saadut ennakot (ennakkoon maksetut vastikkeet)', type: A.LIABILITY },
  { number: '2750', name: 'Lainojen lyhytaikainen osuus', type: A.LIABILITY },
  { number: '2800', name: 'Ostovelat', type: A.LIABILITY },
  { number: '2850', name: 'Muut velat (ennakonpidätykset, sivukulut)', type: A.LIABILITY },
  { number: '2880', name: 'Arvonlisäverovelka', type: A.LIABILITY },
  { number: '2900', name: 'Siirtovelat', type: A.LIABILITY },

  // HOITOTUOTOT
  { number: '3000', name: 'Hoitovastikkeet', type: A.REVENUE },
  { number: '3100', name: 'Vesimaksut', type: A.REVENUE },
  { number: '3150', name: 'Käyttökorvaukset (sähkö, lämpö)', type: A.REVENUE },
  { number: '3200', name: 'Autopaikkamaksut', type: A.REVENUE },
  { number: '3300', name: 'Saunamaksut', type: A.REVENUE },
  { number: '3400', name: 'Pesutupamaksut', type: A.REVENUE },
  { number: '3500', name: 'Vuokratuotot, asuinhuoneistot', type: A.REVENUE },
  { number: '3550', name: 'Vuokratuotot, liiketilat', type: A.REVENUE },
  { number: '3600', name: 'Muut hoitotuotot', type: A.REVENUE },
  // PÄÄOMAVASTIKKEET JA RAHOITUSTUOTOT
  { number: '3900', name: 'Pääomavastikkeet', type: A.REVENUE },
  { number: '3950', name: 'Korkotuotot', type: A.REVENUE },
  { number: '3960', name: 'Muut rahoitustuotot', type: A.REVENUE },

  // HOITOKULUT (ryhmät reporting-servicen kaavan mukaan)
  { number: '4000', name: 'Hallinto ja isännöinti', type: A.EXPENSE },
  { number: '4010', name: 'Palkat ja palkkiot', type: A.EXPENSE },
  { number: '4020', name: 'Henkilösivukulut', type: A.EXPENSE },
  { number: '4030', name: 'Tilintarkastus ja toiminnantarkastus', type: A.EXPENSE },
  { number: '4040', name: 'Kokous- ja hallintokulut', type: A.EXPENSE },
  { number: '4050', name: 'Tietoliikenne ja ohjelmistot', type: A.EXPENSE },
  { number: '4100', name: 'Kiinteistönhoito ja huolto', type: A.EXPENSE },
  { number: '4120', name: 'Hissien huolto', type: A.EXPENSE },
  { number: '4200', name: 'Ulkoalueiden hoito', type: A.EXPENSE },
  { number: '4210', name: 'Lumityöt ja liukkauden torjunta', type: A.EXPENSE },
  { number: '4250', name: 'Siivous', type: A.EXPENSE },
  { number: '4300', name: 'Puhtaanapito ja jätehuolto', type: A.EXPENSE },
  { number: '4500', name: 'Lämmitys', type: A.EXPENSE },
  { number: '4600', name: 'Vesi ja jätevesi', type: A.EXPENSE },
  { number: '4700', name: 'Sähkö ja kaasu', type: A.EXPENSE },
  { number: '4800', name: 'Vakuutukset', type: A.EXPENSE },
  { number: '4850', name: 'Maanvuokrat', type: A.EXPENSE },
  { number: '4860', name: 'Muut vuokrat', type: A.EXPENSE },
  { number: '4870', name: 'Kiinteistövero', type: A.EXPENSE },
  { number: '4900', name: 'Pankkikulut', type: A.EXPENSE },
  { number: '6900', name: 'Poistot', type: A.EXPENSE },
  { number: '7000', name: 'Korjaukset', type: A.EXPENSE },
  { number: '7020', name: 'Vahinkojen korjaukset', type: A.EXPENSE },
  { number: '7900', name: 'Muut hoitokulut', type: A.EXPENSE },

  // RAHOITUSKULUT JA VEROT
  { number: '8000', name: 'Lainojen korot', type: A.EXPENSE },
  { number: '8100', name: 'Muut rahoituskulut', type: A.EXPENSE },
  { number: '9000', name: 'Tuloverot', type: A.EXPENSE },
];

/** Tilin tyyppi numerosta (yhtiökohtaiset lisätilit). null = numero ei kuulu tilikarttaan. */
export const accountTypeFor = (accountNumber: string): AccountType | null => {
  if (!/^\d{4,6}$/.test(accountNumber)) return null;
  const n = Number(accountNumber.slice(0, 4));
  if (n >= 1000 && n <= 1999) return A.ASSET;
  if (n >= 2000 && n <= 2399) return A.EQUITY;
  if (n >= 2400 && n <= 2999) return A.LIABILITY;
  if (n >= 3000 && n <= 3999) return A.REVENUE;
  if (n >= 4000 && n <= 9999) return A.EXPENSE;
  return null;
};

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

/** Lisää tilikarttapohjan uudet tilit olemassa oleville yhtiöille (käynnistyksessä; idempotentti). */
export const syncChartTemplates = async () => {
  const companies = await prisma.account.findMany({ distinct: ['companyId'], select: { companyId: true } });
  let added = 0;
  for (const { companyId } of companies) added += (await initializeChartOfAccounts(companyId)).count;
  if (added) console.log(`Tilikarttapohja päivitetty: ${added} uutta tiliä ${companies.length} yhtiölle`);
};

export const accountExists = async (companyId: string, accountNumber: string) => {
  const account = await prisma.account.findUnique({
    where: { companyId_accountNumber: { companyId, accountNumber } },
  });
  return Boolean(account?.isActive); // käytöstä poistettua tiliä ei ehdoteta automaatiossa
};

/** Virheteksti, jos vienti käyttää käytöstä poistettua tiliä (vanhat kirjaukset säilyvät ennallaan). */
export const inactiveAccountError = async (companyId: string, lines: unknown): Promise<string | null> => {
  if (!Array.isArray(lines)) return null;
  const numbers = [...new Set(lines.map((l: any) => String(l?.accountNumber ?? '')))];
  const inactive = await prisma.account.findMany({
    where: { companyId, accountNumber: { in: numbers }, isActive: false },
    select: { accountNumber: true },
  });
  return inactive.length ? `Tili ${inactive.map((a) => a.accountNumber).join(', ')} on poistettu käytöstä` : null;
};

export const getAccounts = async (companyId: string) => {
  return await prisma.account.findMany({
    where: { companyId },
    orderBy: { accountNumber: 'asc' },
  });
};
