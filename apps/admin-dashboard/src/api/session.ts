import type { AxiosInstance } from 'axios';
import { accountingApi } from './accounting';
import { auditApi } from './audit';
import { bankApi } from './bank';
import { companiesApi } from './companies';
import { documentsApi } from './documents';
import { invoicesApi } from './invoices';
import { notificationsApi } from './notifications';
import { reportsApi } from './reports';
import { vouchersApi } from './vouchers';

/** Lähetetään, kun palvelu hylkää tokenin (vanhentunut tai virheellinen) => useAuth kirjaa ulos. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

// authApi jätetään pois: kirjautumisen 401 tarkoittaa väärää salasanaa, ei vanhentunutta istuntoa.
const protectedApis: AxiosInstance[] = [
  accountingApi, auditApi, bankApi, companiesApi, documentsApi,
  invoicesApi, notificationsApi, reportsApi, vouchersApi,
];

let installed = false;

export const installSessionHandling = () => {
  if (installed) return;
  installed = true;
  for (const api of protectedApis) {
    api.interceptors.response.use(undefined, (error) => {
      const sentToken = Boolean(error?.config?.headers?.Authorization);
      if (error?.response?.status === 401 && sentToken) {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
      return Promise.reject(error);
    });
  }
};
