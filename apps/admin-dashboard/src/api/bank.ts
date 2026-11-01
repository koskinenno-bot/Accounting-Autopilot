import axios from 'axios';

const BANK_SERVICE_URL = import.meta.env.VITE_BANK_SERVICE_URL || 'http://localhost:3005/api/v1';

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
