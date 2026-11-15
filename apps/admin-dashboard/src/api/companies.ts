import axios from 'axios';

const USER_SERVICE_URL = import.meta.env.VITE_USER_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export const companiesApi = axios.create({
  baseURL: USER_SERVICE_URL,
});

// Add auth interceptor to include JWT
companiesApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const getCompanies = async () => {
  const { data } = await companiesApi.get('/companies');
  return data;
};

export const createCompany = async (companyData: any) => {
  const { data } = await companiesApi.post('/companies', companyData);
  return data;
};

export const getCompanyStats = async () => {
  const { data } = await companiesApi.get('/companies/stats');
  return data;
};


/** Yhtiön perustiedot (vain isännöitsijä). iban: null poistaa. */
export const updateCompany = async (id: string, patch: { name?: string; iban?: string | null; bic?: string | null }) => {
  const { data } = await companiesApi.patch(`/companies/${id}`, patch);
  return data;
};
