import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Search, UserPlus, Link2 } from 'lucide-react';
import { toast } from '../utils/toast';

export default function LinkContactModal({ onClose, onLink }) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (search.length >= 3) {
      const delay = setTimeout(handleSearch, 500);
      return () => clearTimeout(delay);
    } else {
      setContacts([]);
    }
  }, [search]);

  async function handleSearch() {
    setLoading(true);
    try {
      const res = await api.get('/crm/customers', { params: { q: search, limit: 30 } });
      setContacts(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error(e);
      toast.error('Erro ao buscar clientes. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const s = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, backdropFilter: 'blur(4px)' },
    modal: { background: 'var(--bg-panel)', width: '500px', maxWidth: '95%', borderRadius: '20px', padding: '24px', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' },
    title: { fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' },
    sub: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' },
    searchBox: { position: 'relative', marginBottom: '20px' },
    input: { width: '100%', padding: '14px 14px 14px 44px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '12px', color: 'var(--text-main)', outline: 'none', fontSize: '0.95rem' },
    searchIcon: { position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' },
    list: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
    item: { padding: '12px', borderRadius: '12px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'all 0.2s' },
    itemHover: { borderColor: 'var(--accent)', background: 'rgba(212,175,55,0.05)' },
    name: { fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    phone: { fontSize: '0.75rem', color: 'var(--text-muted)' },
    linkBtn: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer' },
    empty: { textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.9rem' },
    closeBtn: { background: 'transparent', border: 'none', color: 'var(--text-muted)', fontWeight: 600, marginTop: '16px', cursor: 'pointer', alignSelf: 'center' }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={s.title}><Link2 size={24} color="var(--accent)"/> Vincular ao CRM</h2>
        <p style={s.sub}>Pesquise na base CRM / ILUX WEB para vincular este WhatsApp ao cliente oficial.</p>

        <div style={s.searchBox}>
          <Search style={s.searchIcon} size={18} />
          <input 
            style={s.input} 
            placeholder="Nome, fantasia, telefone, cidade ou CNPJ..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            autoFocus
          />
        </div>

        <div style={s.list}>
          {loading ? (
            <div style={s.empty}>Buscando...</div>
          ) : contacts.length > 0 ? (
            contacts.map(c => (
              <div key={c.id} style={s.item} onClick={() => onLink(c.id)}>
                <div>
                  <div style={s.name}>{c.fantasyName || c.name}</div>
                  <div style={s.phone}>{c.phone} {c.cpfCnpj ? `· ${c.cpfCnpj}` : ''}</div>
                  <div style={s.phone}>{c._count?.equipments || 0} equipamento(s) no CRM</div>
                </div>
                <button style={s.linkBtn}>Vincular</button>
              </div>
            ))
          ) : (
            search.length >= 3 && <div style={s.empty}>Nenhum cliente encontrado.</div>
          )}
        </div>

        <button style={s.closeBtn} onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
