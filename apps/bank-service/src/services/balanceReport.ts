import axios from 'axios';
import { serviceHeaders } from '../middleware/requireAuth';

const ACCOUNTING_SERVICE_URL = process.env.ACCOUNTING_SERVICE_URL || 'http://localhost:3002/api/v1';

/** Välittää pankkitilin saldon kirjanpitoon pankkitäsmäytystä varten. Virhe ei kaada tiliotteen käsittelyä. */
export const reportBalance = async (companyId: string, iban: string | null | undefined, date: string, balance: number, source: 'PSD2' | 'CAMT') => {
  if (!iban || !Number.isFinite(balance)) return false;
  try {
    await axios.post(`${ACCOUNTING_SERVICE_URL}/accounting/bank-balances`, { companyId, iban, date, balance, source }, { headers: serviceHeaders(), timeout: 10_000 });
    return true;
  } catch (err: any) {
    console.error('Pankkisaldon välitys kirjanpitoon epäonnistui:', err?.response?.data?.error || err?.message);
    return false;
  }
};
