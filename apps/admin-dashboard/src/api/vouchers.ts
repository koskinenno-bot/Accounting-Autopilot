import axios from 'axios';

const VOUCHER_SERVICE_URL = import.meta.env.VITE_VOUCHER_SERVICE_URL || 'http://localhost:3003/api/v1';

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
