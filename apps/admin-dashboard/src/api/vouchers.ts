import axios from 'axios';

const VOUCHER_SERVICE_URL = import.meta.env.VITE_VOUCHER_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3003/api/v1';

export const vouchersApi = axios.create({
  baseURL: VOUCHER_SERVICE_URL,
});

// Add auth interceptor to include JWT
vouchersApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const uploadVoucher = async (file: File, companyId: string) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('companyId', companyId);
  formData.append('voucherDate', new Date().toISOString());
  formData.append('voucherType', 'PURCHASE');

  const { data } = await vouchersApi.post('/vouchers/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

export const listVouchers = async (companyId: string) => {
  const { data } = await vouchersApi.get('/vouchers', { params: { companyId } });
  return data;
};

/** Avaa tositteen uuteen välilehteen (tiedosto haetaan tunnisteella, joten suora linkki ei toimi). */
export const openVoucherFile = async (voucherId: string) => {
  // Ikkuna avataan heti klikkauksen yhteydessä, muuten selain estää ponnahdusikkunan
  const win = window.open('', '_blank');
  try {
    const { data } = await vouchersApi.get(`/vouchers/${voucherId}/file`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
};
