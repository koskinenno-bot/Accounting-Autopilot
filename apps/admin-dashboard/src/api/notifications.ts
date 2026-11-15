import axios from 'axios';

const NOTIFICATION_SERVICE_URL = import.meta.env.VITE_NOTIFICATION_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3008/api/v1';

export const notificationsApi = axios.create({
  baseURL: NOTIFICATION_SERVICE_URL,
});

// Add auth interceptor to include JWT
notificationsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getNotificationHistory = async (companyId: string) => {
  const { data } = await notificationsApi.get(`/notify/history?companyId=${companyId}`);
  return data;
};

export interface MailStatus { mode: 'smtp' | 'outbox'; ok: boolean; error?: string; from: string; queue: string }
export const getMailStatus = async (): Promise<MailStatus> => (await notificationsApi.get('/notify/status')).data;
export const sendTestEmail = async (companyId: string, recipient: string) =>
  (await notificationsApi.post('/notify/test', { companyId, recipient })).data as { mode: string; notificationId: string };
