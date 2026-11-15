import React from 'react';
import { LayoutDashboard, ClipboardList, CreditCard, FileText, Settings, LogOut, Shield, Mail, History, ArrowRightLeft, CalendarCheck, FileCheck, Calculator, Building2, Inbox, BookOpen, UserCog, Eye, ListTodo, ListTree, Wallet, Receipt } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import LanguageSwitcher from './LanguageSwitcher';
import { useCompany } from '../hooks/useCompany';
import { COMPANY_ROLE_LABELS } from '../api/organizations';

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

  const { companies, selectedCompany, selectCompany, role, canWrite, isOrgAdmin, organization } = useCompany();

  // Toimiston näkymät ja valitun yhtiön näkymät. Roolit tarkistetaan lopullisesti palvelimella;
  // valikko vain piilottaa sivut, joita käyttäjä ei voi käyttää.
  const officeItems = [
    { icon: LayoutDashboard, label: 'Kaikki yhtiöt', path: '/', show: true },
    { icon: ListTodo, label: 'Työjono', path: '/queue', show: (companies ?? []).some((c) => c.myRole === 'MANAGER' || c.myRole === 'ASSISTANT') },
    { icon: Building2, label: t('nav.companies'), path: '/companies', show: isOrgAdmin },
    { icon: UserCog, label: 'Käyttäjät', path: '/users', show: isOrgAdmin },
  ].filter((i) => i.show);

  const companyItems = [
    { icon: Inbox, label: 'Yhtiön tilanne', path: '/company', show: true },
    { icon: ClipboardList, label: 'Käsittelemättömät', path: '/pending', show: canWrite },
    { icon: BookOpen, label: 'Pääkirja', path: '/ledger', show: true },
    { icon: ListTree, label: 'Tilikartta', path: '/accounts', show: true },
    { icon: FileText, label: t('nav.financialStatements'), path: '/reports', show: true },
    { icon: ArrowRightLeft, label: t('reports.vastikelaskelma'), path: '/reports/vastike', show: true },
    { icon: CalendarCheck, label: t('nav.closing'), path: '/closing', show: true },
    { icon: FileCheck, label: 'Tilinpäätöspaketti', path: '/financial-statements', show: true },
    { icon: Calculator, label: 'Talousarvio', path: '/budget', show: true },
    { icon: Receipt, label: 'Ostolaskut', path: '/purchases', show: true },
    { icon: Wallet, label: 'Vastikkeet', path: '/fees', show: true },
    { icon: CreditCard, label: t('invoices.title'), path: '/billing', show: true },
    { icon: Shield, label: t('documents.title'), path: '/documents', show: true },
    { icon: Mail, label: t('notifications.title'), path: '/notifications', show: canWrite },
    { icon: History, label: t('audit.title'), path: '/audit', show: true },
    { icon: Settings, label: t('nav.settings'), path: '/settings', show: isOrgAdmin },
  ].filter((i) => i.show && selectedCompany);

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

        <nav className="flex-1 space-y-1 overflow-y-auto">
          {organization && (
            <div className="px-4 pb-2 text-xs uppercase tracking-wider text-slate-500 truncate" title={organization.name}>{organization.name}</div>
          )}
          {officeItems.map((item) => (
            <SidebarItem key={item.path} icon={item.icon} label={item.label} path={item.path} active={location.pathname === item.path} />
          ))}
          {selectedCompany && (
            <div className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-slate-500 truncate" title={selectedCompany.name}>{selectedCompany.name}</div>
          )}
          {companyItems.map((item) => (
            <SidebarItem key={item.path} icon={item.icon} label={item.label} path={item.path} active={location.pathname === item.path} />
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
            {companies && companies.length > 0 ? (
              <label className="flex items-center space-x-3">
                <span className="text-sm text-slate-400">Yhtiö</span>
                <select
                  value={selectedCompany?.id ?? ''}
                  onChange={(e) => selectCompany(e.target.value)}
                  className="bg-slate-900/70 border border-white/10 rounded-xl py-2 px-3 text-sm font-semibold focus:outline-none focus:border-primary-500 max-w-xs"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {role && (
                  <span className={`text-xs px-2 py-1 rounded-md border flex items-center space-x-1 ${canWrite ? 'text-slate-300 border-white/10' : 'text-amber-300 border-amber-400/30 bg-amber-400/10'}`}>
                    {!canWrite && <Eye className="w-3 h-3" />}
                    <span>{COMPANY_ROLE_LABELS[role]}</span>
                  </span>
                )}
              </label>
            ) : (
              <h1 className="text-xl font-semibold">Tervetuloa{displayName && <>, <span className="text-primary-400">{displayName}</span></>}</h1>
            )}
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
