import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { File, Lock, Trash2, Shield, Download, Plus } from 'lucide-react';
import { getDocuments, uploadDocument, archiveDocument, deleteDocument, openDocument } from '../api/documents';
import { useCompany } from '../hooks/useCompany';

const DocumentsPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadData, setUploadData] = useState({ name: '', type: 'OTHER' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { selectedCompany, canWrite } = useCompany();
  
  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', selectedCompany?.id],
    queryFn: () => getDocuments(selectedCompany!.id),
    enabled: !!selectedCompany?.id,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file, selectedCompany!.id, uploadData.name, uploadData.type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setIsModalOpen(false);
      setSelectedFile(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveDocument(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFile) uploadMutation.mutate(selectedFile);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('documents.title')}</h2>
          <p className="text-slate-400 mt-1">Hallinnoi ja arkistoi taloyhtiön virallisia dokumentteja.</p>
        </div>
        {canWrite && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="premium-button premium-gradient text-white flex items-center justify-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>{t('documents.upload')}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [1, 2, 3].map(i => <div key={i} className="glass-card h-48 animate-pulse bg-white/5" />)
        ) : documents?.length === 0 ? (
          <div className="col-span-full glass-card p-12 text-center text-slate-500 italic">
            Arkisto on tyhjä. Aloita lataamalla ensimmäinen dokumentti.
          </div>
        ) : (
          documents?.map((doc: any) => (
            <div key={doc.id} className="glass-card p-6 flex flex-col justify-between group">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="p-3 rounded-xl bg-primary-500/10 text-primary-400">
                    <File className="w-6 h-6" />
                  </div>
                  <div className="flex space-x-1">
                    {doc.isArchived ? (
                      <div className="p-2 text-emerald-500 bg-emerald-500/10 rounded-lg" title={t('documents.archived')}>
                        <Lock className="w-4 h-4" />
                      </div>
                    ) : canWrite && (
                      <>
                        <button 
                          onClick={() => archiveMutation.mutate(doc.id)}
                          className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all"
                          title="Arkistoi"
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteMutation.mutate(doc.id)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                          title="Poista"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 truncate">{doc.name}</h3>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="text-xs font-semibold text-slate-500 uppercase">{doc.type}</span>
                    <span className="text-slate-700">•</span>
                    <span className="text-xs text-slate-500">{t('documents.version')} {doc.versions[0]?.version}</span>
                    {doc.retentionUntil && <><span className="text-slate-700">•</span><span className="text-xs text-emerald-400/80">Säilytys {new Date(doc.retentionUntil).toLocaleDateString('fi-FI')} asti</span></>}
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(doc.createdAt).toLocaleDateString('fi-FI')}
                </span>
                <button type="button" onClick={() => openDocument(doc.id).catch((err: any) => window.alert(err?.response?.status === 409 ? 'Tiedoston eheystarkistus epäonnistui.' : 'Tiedoston avaaminen epäonnistui.'))}
                  className="text-primary-400 hover:text-primary-300 font-semibold text-xs flex items-center space-x-1">
                  <Download className="w-3.5 h-3.5" />
                  <span>Lataa</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm">
          <div className="glass-card max-w-md w-full p-8 space-y-6">
            <h3 className="text-xl font-bold">{t('documents.upload')}</h3>
            <form onSubmit={handleUpload} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t('documents.name')}</label>
                <input 
                  type="text"
                  required
                  value={uploadData.name}
                  onChange={e => setUploadData({ ...uploadData, name: e.target.value })}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:border-primary-500 outline-none"
                  placeholder="Esim. Yhtiökokous 2024"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">{t('documents.type')}</label>
                <select 
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-slate-100 focus:border-primary-500 outline-none"
                  value={uploadData.type}
                  onChange={e => setUploadData({ ...uploadData, type: e.target.value })}
                >
                  <option value="PROTOCOL">Pöytäkirja</option>
                  <option value="REPORT">Raportti</option>
                  <option value="CONTRACT">Sopimus</option>
                  <option value="OTHER">Muu</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Tiedosto</label>
                <input 
                  type="file"
                  required
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary-500/10 file:text-primary-400 hover:file:bg-primary-500/20"
                />
              </div>
              <div className="flex space-x-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-6 py-3 rounded-xl bg-white/5 text-slate-400 font-semibold hover:bg-white/10 transition-all"
                >
                  {t('common.cancel')}
                </button>
                <button 
                  type="submit"
                  disabled={uploadMutation.isPending}
                  className="flex-1 premium-button premium-gradient text-white font-semibold flex items-center justify-center"
                >
                  {uploadMutation.isPending ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
