import axios from 'axios';

const INVOICING_SERVICE_URL = import.meta.env.VITE_INVOICING_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3004/api/v1';

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

/** Lataa laskun Finvoice-aineiston tiedostoksi (tunnisteella; pelkkä linkki ei kelpaa rajapinnalle). */
export const downloadFinvoiceXml = async (invoiceId: string, invoiceNumber: string) => {
  try {
    const { data } = await invoicesApi.get(`/invoices/${invoiceId}/xml`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finvoice-${invoiceNumber}.xml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err: any) {
    // Virheen runko on blob: luetaan selkokielinen viesti siitä
    const blob = err?.response?.data;
    if (blob instanceof Blob) {
      try { throw new Error(JSON.parse(await blob.text()).error); } catch (e: any) { if (e?.message) throw e; }
    }
    throw err;
  }
};
