import { CompanyCreatedEvent } from '@ai-accountant/types';
import { prisma } from '../db';
import { initializeChartOfAccounts } from '../services/chartOfAccountsService';

/**
 * Luo uudelle yhtiölle TATO-tilikartan ja ensimmäisen tilikauden.
 *
 * Aiemmin tässä oli oma, chartOfAccountsService.ts:stä poikkeava tilikartta
 * (mm. 1700 = Ostovelat), jolloin pankki-, lasku- ja tositekirjaukset viittasivat
 * tileihin joita ei ollut olemassa. Nyt käytetään yhtä yhteistä pohjaa.
 */
export const setupCompanyCreatedConsumer = async (event: CompanyCreatedEvent) => {
  const { companyId, chartOfAccountsTemplate, fiscalYearStart, fiscalYearEnd } = event.data;

  if (chartOfAccountsTemplate === 'TATO') {
    const result = await initializeChartOfAccounts(companyId); // skipDuplicates => idempotentti
    console.log(`TATO-tilikartta: ${result.count} uutta tiliä yhtiölle ${companyId}`);
  }

  // Ilman avointa tilikautta createEntry hylkää kaikki kirjaukset (KPL 1:4 §).
  if (fiscalYearStart && fiscalYearEnd) {
    const startDate = new Date(fiscalYearStart);
    const endDate = new Date(fiscalYearEnd);
    const existing = await prisma.fiscalYear.findFirst({ where: { companyId, startDate, endDate } });
    if (!existing) {
      await prisma.fiscalYear.create({
        data: { companyId, startDate, endDate, description: 'Ensimmäinen tilikausi' },
      });
      console.log(`Luotiin tilikausi ${startDate.toISOString().slice(0, 10)}–${endDate.toISOString().slice(0, 10)} yhtiölle ${companyId}`);
    }
  }
};
