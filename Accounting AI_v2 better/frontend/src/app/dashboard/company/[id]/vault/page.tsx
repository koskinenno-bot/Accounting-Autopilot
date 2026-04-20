"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { fetchWithAuth } from '@/lib/api';
import { AuditVaultFile } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

const CATEGORIES = ["Pöytäkirjat", "Sopimukset", "Vakuutukset", "Tilinpäätökset", "Muu"];

export default function AuditVaultPage() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [files, setFiles] = useState<AuditVaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  
  // Form state
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [notes, setNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetchWithAuth(`/companies/${id}/vault/`);
      setFiles(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || !id) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', selectedCategory);
    formData.append('year', year.toString());
    formData.append('notes', notes);

    try {
      setUploading(true);
      const res = await fetchWithAuth(`/companies/${id}/vault/upload`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        setNotes("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        loadFiles();
      }
    } catch (err) {
      alert("Virhe tiedoston latauksessa.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: number) => {
    if (!confirm("Haluatko varmasti poistaa tämän arkistoidun tiedoston?")) return;
    try {
      await fetchWithAuth(`/companies/${id}/vault/${fileId}`, { method: 'DELETE' });
      loadFiles();
    } catch (err) {
      alert("Poisto epäonnistui.");
    }
  };

  if (loading && files.length === 0) return <div style={{ padding: '40px' }}>{t('common.loading')}</div>;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>📂 Audit Vault</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Lakisääteinen pysyväisarkisto tilintarkastusta varten.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '40px', alignItems: 'flex-start' }}>
        
        {/* Upload Form */}
        <section className="card-glass" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px' }}>Tallenna uusi asiakirja</h3>
          <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Kategoria</label>
                <select 
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '8px' }}
                >
                    {CATEGORIES.map(c => <option key={c} value={c} style={{ color: 'black' }}>{c}</option>)}
                </select>
            </div>

            <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Tilivuosi</label>
                <input 
                    type="number"
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value))}
                    style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '8px' }}
                />
            </div>

            <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Asiakirja (PDF)</label>
                <input 
                    type="file"
                    ref={fileInputRef}
                    required
                    style={{ color: 'var(--text-secondary)', fontSize: '13px' }}
                />
            </div>

            <div>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Lisätiedot</label>
                <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Esim. 'Vuosikokous 2024 päätökset'"
                    style={{ width: '100%', padding: '12px', height: '80px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', color: 'white', borderRadius: '8px' }}
                />
            </div>

            <button type="submit" className="btn-primary" disabled={uploading}>
                {uploading ? "Ladataan..." : "🚀 Arkistoi dokumentti"}
            </button>
          </form>
        </section>

        {/* File List */}
        <section>
          {files.length === 0 ? (
            <div className="card-glass" style={{ padding: '60px', textAlign: 'center', opacity: 0.5 }}>
               <span style={{ fontSize: '48px' }}>📂</span>
               <h3>Arkisto on tyhjä</h3>
               <p>Aloita lataamalla tilintarkastusta varten tarvittavat dokumentit.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {CATEGORIES.map(category => {
                  const catFiles = files.filter(f => f.category === category);
                  if (catFiles.length === 0) return null;
                  
                  return (
                      <div key={category}>
                        <h4 style={{ fontSize: '13px', color: 'var(--blue-400)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px', marginLeft: '8px' }}>
                            {category}
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {catFiles.map(file => (
                                <div key={file.id} className="card-glass" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: '600' }}>{file.filename}</div>
                                        <div style={{ fontSize: '12px', opacity: 0.6 }}>Vuosi: {file.year} | {file.notes}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                         <a href={file.file_url} target="_blank" rel="noreferrer" className="btn-secondary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                                            👀 Avaa
                                         </a>
                                         <button onClick={() => handleDelete(file.id)} style={{ color: 'var(--red-500)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px' }}>
                                            Poista
                                         </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginBottom: '32px' }}></div>
                      </div>
                  );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
