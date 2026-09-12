import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';

const labels = { queued: 'Aguardando envio', sending: 'Enviando', sent: 'Enviada', blocked: 'Bloqueada', failed: 'Falhou', cancelled: 'Cancelada' };

export default function ScheduledMessagesPanel({ contactId }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    try { const { data } = await api.get('/scheduled-messages', { params: { contactId } }); setRows(data); setError(''); }
    catch { setError('Não foi possível carregar os agendamentos.'); }
  }, [contactId]);
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  async function act(row, action) {
    if (action === 'retry' && row.deliveryUncertain && !window.confirm('A entrega anterior é incerta. Você conferiu no WhatsApp que a mensagem NÃO foi entregue? Reenviar poderá duplicar a mensagem.')) return;
    setBusy(row.id);
    try {
      if (action === 'retry') await api.post(`/scheduled-messages/${row.id}/retry`, { confirmUncertain: row.deliveryUncertain });
      else await api.delete(`/scheduled-messages/${row.id}`);
      await load();
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível atualizar o agendamento.'); }
    finally { setBusy(null); }
  }
  return <section aria-label="Histórico de agendamentos" style={{ marginTop: 20 }}>
    <h4>Histórico de agendamentos</h4>
    {error && <p role="alert">{error}</p>}
    {!rows.length && <p>Nenhum agendamento para este contato.</p>}
    <div style={{ maxHeight: 280, overflowY: 'auto' }}>
      {rows.map(row => <article key={row.id} style={{ borderBottom: '1px solid #64748b44', padding: '12px 0' }}>
        <strong>{labels[row.status] || row.status}</strong> · {new Date(row.sendAt).toLocaleString('pt-BR')}
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.body}</p>
        <small>{row.attempts} tentativa(s){row.nextAttemptAt ? ` · Próxima: ${new Date(row.nextAttemptAt).toLocaleString('pt-BR')}` : ''}</small>
        {row.lastError && <p role="status">{row.lastError}</p>}
        {['blocked', 'failed'].includes(row.status) && <button disabled={busy === row.id} onClick={() => act(row, 'retry')}>Tentar novamente</button>}
        {['queued', 'blocked', 'failed'].includes(row.status) && <button disabled={busy === row.id} onClick={() => act(row, 'cancel')}>Cancelar</button>}
      </article>)}
    </div>
  </section>;
}
