import axios from 'axios';

const INVOICING_SERVICE_URL = import.meta.env.VITE_INVOICING_SERVICE_URL || 'http://localhost:3004/api/v1';

export const invoicesApi = axios.create({
  baseURL: INVOICING_SERVICE_URL,
});

// Add auth interceptor to include JWT
invoicesApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getInvoices = async (companyId: string) => {
  const { data } = await invoicesApi.get(`/invoices?companyId=${companyId}`);
  return data;
};

export const createInvoice = async (invoiceData: any) => {
  const { data } = await invoicesApi.post('/invoices', invoiceData);
  return data;
};

export const updateInvoiceStatus = async (id: string, status: 'SENT' | 'OVERDUE' | 'PAID' | 'CANCELLED') => {
  const { data } = await invoicesApi.patch(`/invoices/${id}/status`, { status });
  return data;
};

export const getFinvoiceXmlUrl = (invoiceId: string) => {
  return `${INVOICING_SERVICE_URL}/invoices/${invoiceId}/xml`;
};
