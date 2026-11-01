import React from 'react';
import { LayoutDashboard, Users, CreditCard, FileText, Settings, LogOut, Shield, Mail, History, ArrowRightLeft, CalendarCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import LanguageSwitcher from './LanguageSwitcher';

const SidebarItem = ({ icon: Icon, label, path, active }: { icon: any, label: string, path: string, active: boolean }) => (
  <Link to={path}>
    <div className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 group relative ${
      active 
        ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20' 
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`}>
      <Icon className={`w-5 h-5 ${active ? 'text-primary-400' : 'group-hover:text-primary-400'}`} />
      <span className="font-medium leading-tight">{label}</span>
      {active && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute left-0 w-1 h-6 bg-primary-500 rounded-r-full"
        />
      )}
    </div>
  </Link>
);

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation();
  const location = useLocation();

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    // replace: selaimen takaisin-nappi ei palaa suojatulle sivulle
    navigate('/login', { replace: true });
  };

  const displayName = user?.email?.split('@')[0] || '';
  const initials = (displayName.slice(0, 2) || '?').toUpperCase();

  const menuItems = [
    { icon: LayoutDashboard, label: t('dashboard.title'), path: '/', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROPERTY_MANAGER', 'BOARD_MEMBER', 'ACCOUNTANT'] },
    { icon: Users, label: t('nav.companies'), path: '/companies', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'] },
    { icon: FileText, label: t('nav.financialStatements'), path: '/reports', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROPERTY_MANAGER', 'BOARD_MEMBER', 'ACCOUNTANT'] },
    { icon: ArrowRightLeft, label: t('reports.vastikelaskelma'), path: '/reports/vastike', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROPERTY_MANAGER', 'BOARD_MEMBER', 'ACCOUNTANT'] },
    { icon: CalendarCheck, label: t('nav.closing'), path: '/closing', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ACCOUNTANT'] },
    { icon: CreditCard, label: t('invoices.title'), path: '/billing', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT'] },
    { icon: Shield, label: t('documents.title'), path: '/documents', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROPERTY_MANAGER', 'BOARD_MEMBER', 'ACCOUNTANT'] },
    { icon: Mail, label: t('notifications.title'), path: '/notifications', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'PROPERTY_MANAGER', 'BOARD_MEMBER'] },
    { icon: History, label: t('audit.title'), path: '/audit', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ACCOUNTANT'] },
    { icon: Settings, label: t('nav.settings'), path: '/settings', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'] },
  ].filter(item => item.roles.includes(user?.role || 'VIEWER'));

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      {/* shrink-0: leveä sisältö (esim. taulukot) ei saa kaventaa valikkoa, muuten tekstit katkeavat */}
      <aside className="w-72 shrink-0 border-r border-white/5 p-6 flex flex-col glass-card rounded-none border-y-0 border-l-0">
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className="w-10 h-10 premium-gradient rounded-xl flex items-center justify-center">
            <span className="font-bold text-xl">A</span>
          </div>
          <span className="text-xl font-bold tracking-tight">AI Accountat <span className="text-primary-400">v3</span></span>
        </div>

        <nav className="flex-1 space-y-2">
          {menuItems.map((item) => (
            <SidebarItem 
              key={item.path}
              {...item}
              active={location.pathname === item.path}
            />
          ))}
        </nav>

        <div className="pt-6 border-t border-white/5">
          <button type="button" onClick={handleLogout} className="flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200 w-full">
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Kirjaudu ulos</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 border-b border-white/5 px-8 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold">Tervetuloa takaisin{displayName && <>, <span className="text-primary-400">{displayName}</span></>}</h1>
          </div>
          <div className="flex items-center space-x-4">
            <LanguageSwitcher />
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full border-2 border-slate-950 bg-slate-800 flex items-center justify-center text-xs" title={user?.email}>{initials}</div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-950/50">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
