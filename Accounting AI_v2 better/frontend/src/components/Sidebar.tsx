"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCompany } from '@/context/CompanyContext';
import { useLanguage } from '@/context/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeCompany, setActiveCompany, companies } = useCompany();
  const { t } = useLanguage();

  const links = [
    { name: t('sidebar.portfolioHub'), path: '/dashboard', icon: '🏢' },
    { name: "Global Inbox 📥", path: '/dashboard/audit-inbox', icon: '📥' },
  ];

  if (activeCompany) {
    links.push(
      { name: t('sidebar.dashboard'), path: `/dashboard/company/${activeCompany.id}`, icon: '📊' },
      { name: t('sidebar.transactions'), path: `/dashboard/company/${activeCompany.id}/transactions`, icon: '💸' },
      { name: "Asunnot", path: `/dashboard/company/${activeCompany.id}/apartments`, icon: '🏢' },
      { name: "Audit Shield", path: `/dashboard/company/${activeCompany.id}/audit`, icon: '🛡️' },
      { name: "Audit Vault", path: `/dashboard/company/${activeCompany.id}/vault`, icon: '📂' },
      { name: "Lainat", path: `/dashboard/company/${activeCompany.id}/loans`, icon: '🏛️' },
      { name: t('sidebar.reports'), path: `/dashboard/company/${activeCompany.id}/reports`, icon: '📄' },
      { name: t('sidebar.budget'), path: `/dashboard/company/${activeCompany.id}/budget`, icon: '📉' },
      { name: t('sidebar.billing'), path: `/dashboard/company/${activeCompany.id}/billing`, icon: '💰' },
      { name: t('sidebar.settings'), path: `/dashboard/company/${activeCompany.id}/settings`, icon: '⚙️' },
    );
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    router.push('/');
  };

  return (
    <div style={{
      width: '260px',
      background: 'rgba(15, 23, 42, 0.6)',
      backdropFilter: 'blur(16px)',
      borderRight: '1px solid var(--glass-border)',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px'
    }}>
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ color: 'var(--blue-500)', fontSize: '20px', fontWeight: '700' }}>
          Portfolio Admin
        </h2>
        
        {companies.length > 0 && (
          <select 
            style={{
              width: '100%',
              marginTop: '16px',
              padding: '8px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--glass-border)',
              color: 'white',
              borderRadius: '6px',
              outline: 'none'
            }}
            value={activeCompany?.id || ""}
            onChange={(e) => {
              const selected = companies.find(c => c.id === parseInt(e.target.value));
              if (selected) {
                 setActiveCompany(selected);
                 router.push(`/dashboard/company/${selected.id}`);
              } else {
                 setActiveCompany(null);
                 router.push(`/dashboard`);
              }
            }}
          >
            <option value="" style={{ color: "black" }}>{t('sidebar.fleetOverview')}</option>
            {companies.map(c => (
               <option key={c.id} value={c.id} style={{ color: "black" }}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {links.map((link) => {
          const isActive = pathname === link.path || (link.path !== '/dashboard' && pathname.startsWith(link.path));
          
          return (
            <Link key={link.path} href={link.path}>
              <div style={{
                padding: '12px 16px',
                borderRadius: '8px',
                background: isActive ? 'var(--blue-500)' : 'transparent',
                color: isActive ? 'white' : 'var(--text-secondary)',
                fontWeight: isActive ? '500' : '400',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.2s',
                cursor: 'pointer'
              }}>
                <span>{link.icon}</span>
                {link.name}
              </div>
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <LanguageSwitcher />
        <button 
          onClick={handleLogout}
          className="btn-secondary" 
          style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '8px' }}
        >
          <span>🚪</span> {t('sidebar.logout')}
        </button>
      </div>
    </div>
  );
}
