import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2, Search, LayoutGrid, List as ListIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createCompany } from '../api/companies';
import { useCompany } from '../hooks/useCompany';
import { COMPANY_ROLE_LABELS } from '../api/organizations';

const CompaniesPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const queryClient = useQueryClient();

  const navigate = useNavigate();
  const { companies: allCompanies, isLoading, selectCompany } = useCompany();
  const [search, setSearch] = useState('');
  const companies = allCompanies?.filter((c) => !search || `${c.name} ${c.businessId}`.toLowerCase().includes(search.toLowerCase()));
  const year = new Date().getFullYear();
  const emptyForm = { name: '', businessId: '', companyType: 'AS_OY', fiscalYearStart: `${year}-01-01`, fiscalYearEnd: `${year}-12-31` };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createCompany(form),
    onSuccess: (company: any) => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      selectCompany(company.id);
      setIsModalOpen(false);
      setForm(emptyForm);
    },
    onError: (err: any) => setFormError(err?.response?.data?.error || 'Yhtiön luonti epäonnistui'),
  });
  const openCompany = (id: string) => { selectCompany(id); navigate('/company'); };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Yhtiöiden hallinta</h2>
          <p className="text-slate-400 mt-1">Toimiston taloyhtiöt. Valitse yhtiö avataksesi sen kirjanpidon.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="premium-button premium-gradient text-white flex items-center justify-center space-x-2"
        >
          <Plus className="w-5 h-5" />
          <span>Lisää uusi yhtiö</span>
        </button>
      </div>

      {/* Filters & View Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Etsi yhtiötä..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:border-primary-500 transition-all text-sm"
          />
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/10">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Companies Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card h-48 animate-pulse" />
          ))}
        </div>
      ) : companies?.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/5">
            <Building2 className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-xl font-bold">Ei yhtiöitä</h3>
          <p className="text-slate-400 mt-2 max-w-xs mx-auto">Et ole vielä lisännyt yhtään asunto-osakeyhtiötä. Aloita luomalla ensimmäinen yhtiö.</p>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="mt-6 text-primary-400 hover:text-primary-300 font-semibold"
          >
            Luo ensimmäinen yhtiö tästä
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {companies?.map((company) => (
            <motion.div 
              layout
              key={company.id}
              onClick={() => openCompany(company.id)}
              className="glass-card p-6 hover:border-primary-500/30 transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 bg-primary-500/10 rounded-xl flex items-center justify-center group-hover:bg-primary-500/20 transition-colors">
                  <Building2 className="w-6 h-6 text-primary-400" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold group-hover:text-primary-400 transition-colors">{company.name}</h3>
                <p className="text-slate-500 text-sm mt-1">{company.businessId} · {company.companyType === 'KOY' ? 'Keskinäinen kiinteistöosakeyhtiö' : 'Asunto-osakeyhtiö'}</p>
              </div>
              <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs text-slate-400">Roolisi: {COMPANY_ROLE_LABELS[company.myRole] ?? company.myRole}</span>
                <span className="text-xs text-slate-500">
                  Tilikausi {company.fiscalYearStart ? new Date(company.fiscalYearStart).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' }) : ''}–{company.fiscalYearEnd ? new Date(company.fiscalYearEnd).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' }) : ''}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Simple Create Modal Placeholder */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg glass-card p-8 relative z-10 border border-white/10"
            >
              <h2 className="text-2xl font-bold mb-6">Lisää uusi yhtiö</h2>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setFormError(null); create.mutate(); }}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Yhtiön nimi</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} type="text" className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium" placeholder="As Oy Esimerkki" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">Y-tunnus</label>
                    <input required pattern="\d{7}-\d" title="Muoto 1234567-8" value={form.businessId} onChange={(e) => setForm({ ...form, businessId: e.target.value })} type="text" className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium" placeholder="1234567-8" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">Yhtiömuoto</label>
                    <select value={form.companyType} onChange={(e) => setForm({ ...form, companyType: e.target.value })} className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium">
                      <option value="AS_OY">Asunto-osakeyhtiö</option>
                      <option value="KOY">Keskinäinen kiinteistöosakeyhtiö</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">Tilikausi alkaa</label>
                    <input required type="date" value={form.fiscalYearStart} onChange={(e) => setForm({ ...form, fiscalYearStart: e.target.value })} className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400">Tilikausi päättyy</label>
                    <input required type="date" value={form.fiscalYearEnd} onChange={(e) => setForm({ ...form, fiscalYearEnd: e.target.value })} className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium" />
                  </div>
                </div>
                {formError && <div className="text-sm text-red-400">{formError}</div>}
                <div className="pt-6 flex gap-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 transition-all font-semibold">Peruuta</button>
                  <button type="submit" disabled={create.isPending} className="flex-1 premium-button premium-gradient text-white font-semibold">{create.isPending ? 'Luodaan…' : 'Luo yhtiö'}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CompaniesPage;
