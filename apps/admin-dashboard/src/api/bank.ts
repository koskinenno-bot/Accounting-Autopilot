import axios from 'axios';

const BANK_SERVICE_URL = import.meta.env.VITE_BANK_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3005/api/v1';

export const bankApi = axios.create({
  baseURL: BANK_SERVICE_URL,
});

// Add auth interceptor to include JWT
bankApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const uploadStatement = async (file: File, companyId: string) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('companyId', companyId);

  const { data } = await bankApi.post('/bank/upload-statement', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

// --- Pankkiyhteydet (Enable Banking) ---
export interface BankConnectionAccount {
  id: string; iban: string | null; name: string | null; currency: string; enabled: boolean;
  lastSyncAt: string | null; lastBookingDate: string | null; lastImported: number; balance: number | null; balanceAt: string | null;
}
export interface BankConnection {
  id: string; aspspName: string; aspspCountry: string; status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'FAILED';
  validUntil: string; syncFrom: string; lastSyncAt: string | null; lastError: string | null; createdAt: string;
  accounts: BankConnectionAccount[];
}
export interface Aspsp { name: string; country: string; logo: string | null; bic: string | null; beta: boolean; psuTypes: string[] }

export const getBankConnections = async (companyId: string) =>
  (await bankApi.get<{ configured: boolean; redirectUrl: string; connections: BankConnection[] }>('/bank/connections', { params: { companyId } })).data;
export const getAspsps = async (country = 'FI') =>
  (await bankApi.get<{ aspsps: Aspsp[] }>('/bank/connections/aspsps', { params: { country } })).data.aspsps;
export const startBankConnection = async (body: { companyId: string; aspspName: string; aspspCountry: string; psuType: string; syncFrom: string }) =>
  (await bankApi.post<{ id: string; url: string }>('/bank/connections', body)).data;
export const completeBankConnection = async (body: { state: string; code?: string | null; error?: string | null; error_description?: string | null }) =>
  (await bankApi.post<{ companyId: string; connection: BankConnection; imported?: number }>('/bank/connections/callback', body)).data;
export const syncBankConnection = async (id: string) =>
  (await bankApi.post<{ imported: number; connection: BankConnection }>(`/bank/connections/${id}/sync`)).data;
export const setBankAccountEnabled = async (connectionId: string, accountId: string, enabled: boolean) =>
  (await bankApi.patch(`/bank/connections/${connectionId}/accounts/${accountId}`, { enabled })).data;
export const removeBankConnection = async (id: string) =>
  (await bankApi.delete<{ ok: boolean; warning?: string }>(`/bank/connections/${id}`)).data;
