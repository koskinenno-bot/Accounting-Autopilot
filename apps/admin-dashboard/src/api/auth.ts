import axios from 'axios';

const USER_SERVICE_URL = import.meta.env.VITE_USER_SERVICE_URL || import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export const authApi = axios.create({
  baseURL: USER_SERVICE_URL,
});

export const login = async (credentials: { email: string; password: string }) => {
  const { data } = await authApi.post('/auth/login', credentials);
  return data;
};

export const register = async (userData: { email: string; password: string; firstName?: string; lastName?: string; organizationName?: string }) => {
  const { data } = await authApi.post('/auth/register', userData);
  return data;
};


// --- Salasanan palautus ---
export const requestPasswordReset = async (email: string) =>
  (await authApi.post('/auth/password-reset', { email })).data as { message: string; devLink?: string };
export const checkPasswordReset = async (token: string) =>
  (await authApi.get(`/auth/password-reset/${token}`)).data as { status: string; email: string | null };
export const confirmPasswordReset = async (token: string, password: string) =>
  (await authApi.post('/auth/password-reset/confirm', { token, password })).data as { message: string };
