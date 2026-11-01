import axios from 'axios';

const USER_SERVICE_URL = import.meta.env.VITE_USER_SERVICE_URL || 'http://localhost:3001/api/v1';

export const authApi = axios.create({
  baseURL: USER_SERVICE_URL,
});

export const login = async (credentials: { email: string; password: string }) => {
  const { data } = await authApi.post('/auth/login', credentials);
  return data;
};

export const register = async (userData: { email: string; password: string; firstName?: string; lastName?: string }) => {
  const { data } = await authApi.post('/auth/register', userData);
  return data;
};

