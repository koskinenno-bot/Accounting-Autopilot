import axios from 'axios';

const NOTIFICATION_SERVICE_URL = import.meta.env.VITE_NOTIFICATION_SERVICE_URL || 'http://localhost:3008/api/v1';

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
