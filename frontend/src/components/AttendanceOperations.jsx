import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import api from '../services/api';

const priorityOptions = [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['urgent', 'Urgente']];

export default function AttendanceOperations({ styles }) {
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('success');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => api.get('/attendance-operations')
      .then(({ data }) => setState((current) => (current ? { ...current, alerts: data.alerts } : data)))
      .catch(() => { setNoticeType('error'); setNotice('Não foi possível carregar a configuração.'); });
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  if (!state) return <div style={styles.card}><p style={styles.hint}>{notice || 'Carregando regras de atendimento…'}</p></div>;

  const policy = state.policy;
  const change = (key, value) => setState((current) => ({ ...current, policy: { ...current.policy, [key]: value } }));
  const ruleChange = (index, key, value) => change('rules', policy.rules.map((rule, itemIndex) => (
    itemIndex === index ? { ...rule, [key]: value } : rule
  )));
  const toggle = (title, description, checked, onChange) => (
    <div style={styles.toggleCard}>
      <div style={styles.toggleInfo}>
        <span style={{ ...styles.toggleStatus, color: checked ? 'var(--accent)' : 'var(--text-dim)' }}>{title}</span>
        <p style={styles.toggleHint}>{description}</p>
      </div>
      <input type="checkbox" style={styles.switch} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  );

  async function save() {
    setBusy(true);
    setNotice('');
    try {
      await api.put('/attendance-operations', policy);
      setNoticeType('success');
      setNotice('Configuração salva. As regras serão aplicadas em até 30 segundos.');
    } catch (error) {
      setNoticeType('error');
      setNotice(error.response?.data?.error || 'Não foi possível salvar as regras.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>SLA e distribuição</h2>
      <div style={styles.form}>
        {toggle(
          policy.slaEnabled ? 'SLA ativo' : 'SLA desativado',
          'Monitora o prazo até a primeira resposta humana.',
          policy.slaEnabled,
          (value) => change('slaEnabled', value),
        )}

        {policy.slaEnabled ? <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <span style={styles.label}>Regras de prazo</span>
            <button type="button" style={localStyles.secondaryButton} onClick={() => change('rules', [...policy.rules, { teamId: null, priority: null, minutes: 60, warningMinutes: 10, businessHours: false }])}>
              <Plus size={15} /> Adicionar
            </button>
          </div>
          {!policy.rules.length ? <div style={localStyles.empty}>Adicione uma regra para ativar o SLA.</div> : null}
          {policy.rules.map((rule, index) => <div key={index} style={localStyles.ruleCard}>
            <div style={localStyles.ruleHeader}><strong>Regra {index + 1}</strong><button type="button" style={localStyles.removeButton} onClick={() => change('rules', policy.rules.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover regra ${index + 1}`}><Trash2 size={15} /></button></div>
            <div className="attendance-rule-grid" style={localStyles.grid}>
              <label style={styles.field}><span style={styles.label}>Equipe</span><select style={styles.input} value={rule.teamId || ''} onChange={(event) => ruleChange(index, 'teamId', event.target.value || null)}><option value="">Todas</option>{state.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <label style={styles.field}><span style={styles.label}>Prioridade</span><select style={styles.input} value={rule.priority || ''} onChange={(event) => ruleChange(index, 'priority', event.target.value || null)}><option value="">Todas</option>{priorityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label style={styles.field}><span style={styles.label}>Prazo em minutos</span><input style={styles.input} type="number" min="1" max="10080" value={rule.minutes} onChange={(event) => ruleChange(index, 'minutes', Number(event.target.value))} /></label>
              <label style={styles.field}><span style={styles.label}>Avisar antes</span><input style={styles.input} type="number" min="0" value={rule.warningMinutes} onChange={(event) => ruleChange(index, 'warningMinutes', Number(event.target.value))} /></label>
            </div>
            <label style={localStyles.inlineCheck}><input type="checkbox" checked={rule.businessHours} onChange={(event) => ruleChange(index, 'businessHours', event.target.checked)} /> Contar apenas horário comercial</label>
          </div>)}
        </div> : null}

        {toggle(
          policy.assignmentEnabled ? 'Distribuição automática ativa' : 'Distribuição automática desativada',
          'A IA atende primeiro; somente conversas na fila humana são distribuídas.',
          policy.assignmentEnabled,
          (value) => change('assignmentEnabled', value),
        )}

        {policy.assignmentEnabled ? <>
          <div className="attendance-rule-grid" style={localStyles.grid}>
            <label style={styles.field}><span style={styles.label}>Limite por atendente</span><input style={styles.input} type="number" min="1" max="100" value={policy.maxActiveTickets} onChange={(event) => change('maxActiveTickets', Number(event.target.value))} /></label>
            <label style={styles.field}><span style={styles.label}>Desconectar após (min)</span><input style={styles.input} type="number" min="2" max="1440" value={policy.unavailableMinutes} onChange={(event) => change('unavailableMinutes', Number(event.target.value))} /></label>
          </div>
          {toggle(
            'Redistribuir indisponíveis',
            'Move a conversa para outro atendente quando o responsável ficar indisponível.',
            policy.redistributeUnavailable,
            (value) => change('redistributeUnavailable', value),
          )}
          <div style={localStyles.info}>A distribuição respeita equipe, disponibilidade e capacidade. Em empate, recebe quem possui menos conversas ativas.</div>
        </> : null}

        {notice ? <div role="status" style={{ ...localStyles.notice, ...(noticeType === 'error' ? localStyles.noticeError : {}) }}>{notice}</div> : null}
        <button type="button" style={styles.saveBtn} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar SLA e distribuição'}</button>
      </div>
    </div>

    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Alertas de SLA</h2>
      <p style={styles.hint}>Atualização automática a cada 30 segundos.</p>
      {!state.alerts.length ? <div style={localStyles.empty}>Nenhuma conversa em alerta.</div> : <div style={localStyles.alertList}>
        {state.alerts.map((ticket) => <Link className="attendance-alert-item" key={ticket.id} to={`/inbox?ticketId=${encodeURIComponent(ticket.id)}`} style={localStyles.alertItem}>
          <AlertTriangle size={17} />
          <span><strong>{ticket.contact?.name || 'Abrir conversa'}</strong><small>{ticket.agent?.name || 'Sem responsável'} · {new Date(ticket.slaDueAt).toLocaleString('pt-BR')}</small></span>
          <b>{ticket.slaBreachedAt ? 'Vencido' : 'A vencer'}</b>
        </Link>)}
      </div>}
    </div>
  </>;
}

const localStyles = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' },
  ruleCard: { padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '14px', background: 'var(--bg-base)', display: 'grid', gap: '0.85rem' },
  ruleHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-main)' },
  secondaryButton: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.7rem', borderRadius: '9px', border: '1px solid var(--border-color)', color: 'var(--text-main)', background: 'var(--bg-base)', cursor: 'pointer', fontWeight: 700 },
  removeButton: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 9, border: '1px solid var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-light)', cursor: 'pointer' },
  inlineCheck: { display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  info: { padding: '0.85rem 1rem', border: '1px solid var(--accent-border)', borderRadius: 12, background: 'var(--accent-light)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.55 },
  notice: { padding: '0.75rem 0.9rem', borderRadius: 10, background: 'var(--success-light)', color: 'var(--success-text)', fontSize: 'var(--text-sm)', fontWeight: 700 },
  noticeError: { background: 'var(--danger-light)', color: 'var(--danger-text)' },
  empty: { padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: 12, color: 'var(--text-dim)', textAlign: 'center', fontSize: 'var(--text-sm)' },
  alertList: { display: 'grid', gap: '0.65rem', marginTop: '1rem' },
  alertItem: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '0.7rem', padding: '0.85rem', border: '1px solid var(--warning-border)', borderRadius: 12, background: 'var(--warning-light)', color: 'var(--text-main)', textDecoration: 'none' },
};
