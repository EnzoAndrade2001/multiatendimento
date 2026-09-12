import React from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';

export default function SupportLayout() {
  const navigate = useNavigate();
  const logout = () => { localStorage.clear(); navigate('/suporte/login', { replace: true }); };
  return <div style={s.shell}>
    <header style={s.header}>
      <div style={s.brand}><span style={s.mark}><ShieldCheck size={18} /></span><div><strong>Central de Suporte</strong><small>Operação global e gestão SaaS</small></div></div>
      <button type="button" style={s.logout} onClick={logout}><LogOut size={16} /> Sair</button>
    </header>
    <main><Outlet /></main>
  </div>;
}

const s = {
  shell: { minHeight: '100vh', background: 'var(--bg-base)' },
  header: { height: 68, padding: '0 clamp(1rem, 3vw, 2.5rem)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 100 },
  brand: { display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-main)' },
  mark: { width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-light)', border: '1px solid var(--accent-border)' },
  logout: { display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--border-color)', borderRadius: 10, padding: '9px 13px', background: 'var(--bg-panel)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 700 },
};
