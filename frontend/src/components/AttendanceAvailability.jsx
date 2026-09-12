import React, { useEffect, useState } from 'react';
import api from '../services/api';

export default function AttendanceAvailability() {
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/attendance-operations/availability').then(({ data }) => { if (alive) { setAvailable(data.available); setReady(true); } }).catch(() => {});
    const beat = () => api.put('/attendance-operations/availability', {}).catch(() => {});
    beat(); const timer = setInterval(beat, 45000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  if (!ready) return null;
  return <div><label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={available} onChange={async e => { const value = e.target.checked; try { await api.put('/attendance-operations/availability', { available: value }); setAvailable(value); setError(''); } catch { setError('Não foi possível alterar a disponibilidade.'); } }} />Disponível para distribuição</label>{error && <small role="alert">{error}</small>}</div>;
}
