import axios from 'axios';

const DOCUMENT_SERVICE_URL = import.meta.env.VITE_DOCUMENT_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3007/api/v1';

export const documentsApi = axios.create({
  baseURL: DOCUMENT_SERVICE_URL,
});

// Add auth interceptor to include JWT
documentsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getDocuments = async (companyId: string) => {
  const { data } = await documentsApi.get(`/documents?companyId=${companyId}`);
  return data;
};

export const uploadDocument = async (file: File, companyId: string, name: string, type: string) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('companyId', companyId);
  formData.append('name', name);
  formData.append('type', type);

  const { data } = await documentsApi.post('/documents/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

export const archiveDocument = async (id: string, retentionYears: number = 10) => {
  const { data } = await documentsApi.post(`/documents/${id}/archive`, { retentionYears });
  return data;
};

export const deleteDocument = async (id: string) => {
  const { data } = await documentsApi.delete(`/documents/${id}`);
  return data;
};

/** Avaa dokumentin uudessa välilehdessä (lataus tunnisteella, ei julkista linkkiä). */
export const openDocument = async (id: string) => {
  const win = window.open('', '_blank');
  try {
    const { data, headers } = await documentsApi.get(`/documents/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: headers['content-type'] || 'application/octet-stream' }));
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
};

/** Allekirjoitetun tilinpäätöksen PDF:t arkistoon (10 v). */
export const archiveClosing = async (companyId: string, fiscalYearId: string) => {
  const { data } = await documentsApi.post('/documents/closing-archive', { companyId, fiscalYearId });
  return data as { archived: string[]; skipped: string[]; retentionUntil: string };
};
