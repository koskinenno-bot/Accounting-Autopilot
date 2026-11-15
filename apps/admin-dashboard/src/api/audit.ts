import axios from 'axios';

const AUDIT_SERVICE_URL = import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:3009/api/v1';

export const auditApi = axios.create({
  baseURL: AUDIT_SERVICE_URL,
});

// Add auth interceptor to include JWT
auditApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getAuditLogs = async (companyId?: string) => {
  const { data } = await auditApi.get(`/audit/logs${companyId ? `?companyId=${companyId}` : ''}`);
  return data;
};

export interface AuditVerification { ok: boolean; checked: number; legacy: number; brokenAt: string | null; reason: string | null }
/** Muutoslokin tiivisteketjun tarkistus (muutetut tai poistetut tapahtumat). */
export const verifyAuditLog = async (companyId: string) =>
  (await auditApi.get('/audit/verify', { params: { companyId } })).data as AuditVerification;
