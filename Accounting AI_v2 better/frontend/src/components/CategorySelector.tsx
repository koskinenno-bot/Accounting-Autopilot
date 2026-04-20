import { useState, useEffect, useRef } from 'react';
import { AccountCategory } from '@/types';
import { useLanguage } from '@/context/LanguageContext';

interface CategorySelectorProps {
  companyId: string | number;
  initialCategoryId: number | null;
  onUpdate: (newCategoryId: number) => void;
  categories: AccountCategory[];
  disabled?: boolean;
}

export default function CategorySelector({ companyId, initialCategoryId, onUpdate, categories, disabled }: CategorySelectorProps) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(initialCategoryId);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedId(initialCategoryId);
  }, [initialCategoryId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCategory = categories.find(c => c.id === selectedId);
  const filteredCategories = categories.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (catId: number) => {
    setSelectedId(catId);
    setIsOpen(false);
    setSearchTerm('');
    onUpdate(catId);
  };

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
        setTimeout(() => inputRef.current?.focus(), 10);
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%', minWidth: '220px' }}>
      <div 
        onClick={handleToggle}
        className="input-glass"
        style={{
            padding: '6px 12px',
            fontSize: '13px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.05)',
            border: isOpen ? '1px solid var(--blue-500)' : '1px solid var(--glass-border)',
            opacity: disabled ? 0.6 : 1,
            minHeight: '34px'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedCategory ? `${selectedCategory.code} ${selectedCategory.name}` : t('common.search')}
        </span>
        <span style={{ fontSize: '10px', opacity: 0.5 }}>{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div className="card-glass" style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            marginTop: '4px',
            maxHeight: '300px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            background: '#1a1d24', // Opaque background to fix transparency
            border: '1px solid var(--blue-500)'
        }}>
            <div style={{ padding: '8px', borderBottom: '1px solid var(--glass-border)' }}>
                <input 
                    ref={inputRef}
                    type="text"
                    className="input-glass"
                    placeholder={`${t('common.search')}...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: '12px' }}
                />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
                {filteredCategories.length > 0 ? (
                    filteredCategories.map(cat => (
                        <div 
                            key={cat.id}
                            onClick={() => handleSelect(cat.id)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                borderBottom: '1px solid rgba(255,255,255,0.02)',
                                background: selectedId === cat.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                display: 'flex',
                                justifyContent: 'space-between'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                            onMouseOut={(e) => e.currentTarget.style.background = selectedId === cat.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent'}
                        >
                            <span style={{ fontWeight: '600' }}>{cat.code} {cat.name}</span>
                            <span style={{ fontSize: '10px', opacity: 0.6, textTransform: 'uppercase' }}>{cat.type}</span>
                        </div>
                    ))
                ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        {t('transactions.table.noTransactions')}
                    </div>
                )}
            </div>
        </div>
      )}
    </div>
  );
}
