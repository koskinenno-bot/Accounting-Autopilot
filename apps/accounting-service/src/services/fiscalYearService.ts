import { prisma } from '../db';

/** Palauttaa avoimen tilikauden id:n annetulle päivälle tai null (KPL 1:4 §). */
export const findOpenFiscalYearId = async (companyId: string, date: Date): Promise<string | null> => {
  const fy = await prisma.fiscalYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date }, status: 'OPEN' },
    select: { id: true },
  });
  return fy?.id ?? null;
};
