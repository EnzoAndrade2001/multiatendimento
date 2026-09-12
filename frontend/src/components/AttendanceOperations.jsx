import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function AttendanceOperations() {
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = () => api.get('/attendance-operations').then(({ data }) => setState(current => current ? { ...current, alerts: data.alerts } : data)).catch(() => setNotice('Não foi possível carregar a configuração.'));
    load(); const timer = setInterval(load, 30000); return () => clearInterval(timer);
  }, []);
  if (!state) return <p>{notice || 'Carregando regras de atendimento…'}</p>;
  const p = state.policy;
  const change = (key, value) => setState(s => ({ ...s, policy: { ...s.policy, [key]: value } }));
  const ruleChange = (index, key, value) => change('rules', p.rules.map((r, i) => i === index ? { ...r, [key]: value } : r));
  return <section style={{ display: 'grid', gap: 16 }}>
    <h2>SLA e distribuição de atendimentos</h2>
    <p>O SLA mede a primeira resposta humana de cada conversa. A regra de equipe prevalece sobre a regra geral; dentro da equipe, a prioridade específica prevalece. A distribuição respeita equipe, disponibilidade e capacidade.</p>
    <label><input type="checkbox" checked={p.slaEnabled} onChange={e => change('slaEnabled', e.target.checked)} /> Ativar SLA</label>
    {p.rules.map((r, i) => <fieldset key={i} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: 12 }}>
      <legend>Regra {i + 1}</legend>
      <label>Equipe <select value={r.teamId || ''} onChange={e => ruleChange(i, 'teamId', e.target.value || null)}><option value="">Todas</option>{state.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Prioridade <select value={r.priority || ''} onChange={e => ruleChange(i, 'priority', e.target.value || null)}><option value="">Todas</option>{[['low','Baixa'],['medium','Média'],['high','Alta'],['urgent','Urgente']].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Prazo (min) <input type="number" min="1" max="10080" value={r.minutes} onChange={e => ruleChange(i, 'minutes', Number(e.target.value))} style={{ width: 85 }} /></label>
      <label>Avisar antes (min) <input type="number" min="0" value={r.warningMinutes} onChange={e => ruleChange(i, 'warningMinutes', Number(e.target.value))} style={{ width: 85 }} /></label>
      <label><input type="checkbox" checked={r.businessHours} onChange={e => ruleChange(i, 'businessHours', e.target.checked)} />Contar horário comercial</label>
      <button type="button" onClick={() => change('rules', p.rules.filter((_, n) => n !== i))}>Remover</button>
    </fieldset>)}
    <button type="button" onClick={() => change('rules', [...p.rules, { teamId: null, priority: null, minutes: 60, warningMinutes: 10, businessHours: false }])}>Adicionar regra de SLA</button>
    <label><input type="checkbox" checked={p.assignmentEnabled} onChange={e => change('assignmentEnabled', e.target.checked)} /> Distribuição automática</label>
    <label>Limite de conversas por atendente <input type="number" min="1" max="100" value={p.maxActiveTickets} onChange={e => change('maxActiveTickets', Number(e.target.value))} /></label>
    <label><input type="checkbox" checked={p.redistributeUnavailable} onChange={e => change('redistributeUnavailable', e.target.checked)} /> Redistribuir conversas de atendentes indisponíveis</label>
    <label>Considerar desconectado após (min) <input type="number" min="2" max="1440" value={p.unavailableMinutes} onChange={e => change('unavailableMinutes', Number(e.target.value))} /></label>
    <p>Atendentes precisam marcar “Disponível para distribuição”. Ao sair do sistema, deixam de receber novas conversas após dois minutos. Conversas em bot ficam fora da distribuição. Se ninguém tiver capacidade, a conversa aguarda.</p>
    <button disabled={busy} onClick={async () => { setBusy(true); try { await api.put('/attendance-operations', p); setNotice('Configuração salva. As regras serão aplicadas em até 30 segundos.'); } catch (e) { setNotice(e.response?.data?.error || 'Falha ao salvar.'); } finally { setBusy(false); } }}>Salvar regras</button>
    {notice && <p role="status">{notice}</p>}
    <h3>Escalações de SLA</h3>
    <p>Atualização a cada 30 segundos. Até 100 conversas, ordenadas pelo prazo mais antigo.</p>
    {state.alerts.length === 0 ? <p>Nenhuma conversa em alerta.</p> : <table><thead><tr><th>Cliente</th><th>Responsável / equipe</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>{state.alerts.map(t => <tr key={t.id}><td><Link to={`/inbox?ticketId=${encodeURIComponent(t.id)}`}>{t.contact?.name || 'Abrir conversa'}</Link></td><td>{t.agent?.name || 'Sem responsável'} / {t.team?.name || 'Geral'}</td><td>{new Date(t.slaDueAt).toLocaleString('pt-BR')}</td><td>{t.slaBreachedAt ? 'Vencido — ação do supervisor' : 'Próximo do vencimento'}</td></tr>)}</tbody></table>}
  </section>;
}
