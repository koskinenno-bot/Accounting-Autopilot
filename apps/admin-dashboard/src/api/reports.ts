import axios from 'axios';

const REPORTING_SERVICE_URL = import.meta.env.VITE_REPORTING_SERVICE_URL || 'http://localhost:3006/api/v1';

export const reportsApi = axios.create({
  baseURL: REPORTING_SERVICE_URL,
});

// Add auth interceptor to include JWT
reportsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getIncomeStatement = async (companyId: string) => {
  const { data } = await reportsApi.get(`/reports/income-statement?companyId=${companyId}`);
  return data;
};

export const getBalanceSheet = async (companyId: string) => {
  const { data } = await reportsApi.get(`/reports/balance-sheet?companyId=${companyId}`);
  return data;
};

export const getMaintenanceCalculation = async (companyId: string) => {
  const { data } = await reportsApi.get(`/reports/maintenance-calculation?companyId=${companyId}`);
  return data;
};
