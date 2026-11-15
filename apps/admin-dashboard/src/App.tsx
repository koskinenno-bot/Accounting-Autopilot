import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { CompanyProvider } from './hooks/useCompany';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import OverviewPage from './pages/OverviewPage';
import UsersPage from './pages/UsersPage';
import InvitePage from './pages/InvitePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CompaniesPage from './pages/CompaniesPage';
import PendingEntriesPage from './pages/PendingEntriesPage';
import LedgerPage from './pages/LedgerPage';
import ClosingPage from './pages/ClosingPage';
import InvoicesPage from './pages/InvoicesPage';
import ReportsPage from './pages/ReportsPage';
import DocumentsPage from './pages/DocumentsPage';
import NotificationHistoryPage from './pages/NotificationHistoryPage';
import AuditPage from './pages/AuditPage';
import VastikeReportPage from './pages/VastikeReportPage';

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CompanyProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            
            <Route path="/" element={<ProtectedRoute><OverviewPage /></ProtectedRoute>} />
            <Route path="/company" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><UsersPage /></ProtectedRoute>} />
            <Route path="/companies" element={<ProtectedRoute><CompaniesPage /></ProtectedRoute>} />
            <Route path="/accounting" element={<ProtectedRoute><div className="glass-card p-8 text-center"><h2 className="text-2xl font-bold">Kirjanpidon hallinta</h2><p className="text-slate-400 mt-2">Tämä osio on työn alla.</p></div></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute><InvoicesPage /></ProtectedRoute>} />
            <Route path="/pending" element={<ProtectedRoute><PendingEntriesPage /></ProtectedRoute>} />
            <Route path="/ledger" element={<ProtectedRoute><LedgerPage /></ProtectedRoute>} />
            <Route path="/closing" element={<ProtectedRoute><ClosingPage /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
            <Route path="/reports/vastike" element={<ProtectedRoute><VastikeReportPage /></ProtectedRoute>} />
            <Route path="/documents" element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><NotificationHistoryPage /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute><AuditPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><div className="glass-card p-8 text-center"><h2 className="text-2xl font-bold">Asetukset</h2><p className="text-slate-400 mt-2">Tämä osio on työn alla.</p></div></ProtectedRoute>} />
          </Routes>
        </Router>
        </CompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
