import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2, Search, Filter, MoreVertical, LayoutGrid, List as ListIcon } from 'lucide-react';
import { getCompanies, createCompany } from '../api/companies';

const CompaniesPage = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const queryClient = useQueryClient();

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: getCompanies,
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Yhtiöiden hallinta</h2>
          <p className="text-slate-400 mt-1">Hallinnoi ja valitse käsiteltävä asunto-osakeyhtiö.</p>
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
          <button className="p-2.5 bg-slate-900/50 border border-white/10 rounded-xl text-slate-400 hover:text-slate-200 transition-all">
            <Filter className="w-4 h-4" />
          </button>
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
          {companies?.map((company: any) => (
            <motion.div 
              layout
              key={company.id}
              className="glass-card p-6 hover:border-primary-500/30 transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="w-12 h-12 bg-primary-500/10 rounded-xl flex items-center justify-center group-hover:bg-primary-500/20 transition-colors">
                  <Building2 className="w-6 h-6 text-primary-400" />
                </div>
                <button className="text-slate-500 hover:text-slate-200 p-1">
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>
              <div>
                <h3 className="text-lg font-bold group-hover:text-primary-400 transition-colors">{company.name}</h3>
                <p className="text-slate-500 text-sm mt-1">{company.businessId}</p>
              </div>
              <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                <div className="flex -space-x-2">
                  <div className="w-7 h-7 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center text-[10px] font-bold">OK</div>
                </div>
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-md border border-emerald-400/20 uppercase tracking-wider">
                  Aktiivinen
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
              <form className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400 font-medium">Yhtiön nimi</label>
                  <input type="text" className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium" placeholder="As Oy Esimerkki" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400 font-medium">Y-tunnus</label>
                  <input type="text" className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:border-primary-500 transition-all font-medium" placeholder="1234567-8" />
                </div>
                <div className="pt-6 flex gap-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 transition-all font-semibold">Peruuta</button>
                  <button type="button" className="flex-1 premium-button premium-gradient text-white font-semibold">Luo yhtiö</button>
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
