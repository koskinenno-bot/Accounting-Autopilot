import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login as apiLogin, register as apiRegister } from '../api/auth';
import { AUTH_EXPIRED_EVENT, installSessionHandling } from '../api/session';

installSessionHandling();

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (credentials: any) => Promise<void>;
  register: (userData: any) => Promise<void>;
  /** Kirjautuminen valmiilla vastauksella (esim. kutsun hyväksyntä). */
  acceptSession: (data: { user: User; token: string }) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  // Käyttäjä heti tallennuksesta: reititys (esim. osakkaan ohjaus portaaliin) tietää roolin ensimmäisellä piirrolla
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      // Decode user from token or fetch user details in real app
      // For prototype, we'll just keep token existence as "authenticated"
      try {
        const userData = JSON.parse(localStorage.getItem('user') || 'null');
        setUser(userData);
      } catch (e) {
        logout();
      }
    }
  }, [token]);

  const login = async (credentials: any) => {
    const data = await apiLogin(credentials);
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  };

  const register = async (userData: any) => {
    const data = await apiRegister(userData);
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  };

  const acceptSession = (data: { user: User; token: string }) => {
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  };

  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('selectedCompanyId');
    // Tyhjennetään välimuisti, ettei seuraava käyttäjä näe edellisen yhtiön tietoja
    queryClient.clear();
  }, [queryClient]);

  // API-kutsun 401 (vanhentunut token) => uloskirjaus; ProtectedRoute ohjaa /login-sivulle
  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!token, login, register, acceptSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
