import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BellRing, CalendarClock, CheckCircle2, ChevronRight, ClipboardList,
  ExternalLink, History, Link2, Loader2, MessageCircle, RefreshCw, ShieldAlert, UserRound,
  X,
} from 'lucide-react';
import {
  BACKEND_URL, approveTelemetryEvent, assignParkIncident, consolidateParkServiceOrder, getParkBindingCandidates,
  getParkEquipmentTimeline, getParkQueue, getUsers, ignoreTelemetryEvent, monitorTelemetryEvent,
  notifyParkIncident, resolveParkBinding, sendOSManagerCopy,
} from '../../services/api';
import { toast } from '../../utils/toast';
import './DecisionCenter.css';

const fmtInt = (value) => Number(value || 0).toLocaleString('pt-BR');
const digits = (value) => String(value || '').replace(/\D/g, '');
const fmtDate = (value, withTime = true) => {
  if (!value) return 'Não definido';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não definido';
  return date.toLocaleString('pt-BR', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' });
};
const ageLabel = (minutes) => {
  const value = Number(minutes || 0);
  if (value < 60) return `há ${Math.max(1, value)} min`;
  if (value < 2880) return `há ${Math.floor(value / 60)} h`;
  return `há ${Math.floor(value / 1440)} dias`;
};
const tomorrowAtTen = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function priorityOf(item) {
  if (item.priority?.level) return item.priority;
  let score = String(item.severity).toUpperCase() === 'CRITICAL' ? 55 : 20;
  if (item.mappingState !== 'MATCHED') score += 25;
  if (item.isHardware) score += 20;
  if (Number.isFinite(item.toner?.daysLeft) && item.toner.daysLeft <= 3) score += 25;
  if (item.openServiceOrder) score -= 35;
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 75 ? 'P1' : score >= 50 ? 'P2' : score >= 25 ? 'P3' : 'P4', reasons: [] };
}

function recommendationOf(item) {
  if (item.recommendation) return item.recommendation;
  if (item.mappingState !== 'MATCHED') return { action: 'FIX_BINDING', label: 'Corrigir vínculo', explanation: 'Confirme cliente e equipamento antes de decidir.', confidence: 'high' };
  if (item.openServiceOrder) return { action: 'VIEW_SERVICE_ORDER', label: 'Ver O.S. existente', explanation: 'Já existe atendimento aberto para este equipamento.', confidence: 'high' };
  if (item.isHardware || (Number.isFinite(item.toner?.daysLeft) && item.toner.daysLeft <= 3)) return { action: 'OPEN_SERVICE_ORDER', label: 'Abrir O.S. agora', explanation: 'O risco exige ação operacional.', confidence: 'medium' };
  return { action: 'MONITOR', label: 'Monitorar com prazo', explanation: 'Acompanhe a próxima leitura antes de abrir chamado.', confidence: 'low' };
}

export default function DecisionCenter({ osTypes = [] }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('priority');
  const [selected, setSelected] = useState({});
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: queue }, usersResult] = await Promise.all([
        getParkQueue({ windowHours: 168, limit: 200 }),
        getUsers().catch(() => ({ data: [] })),
      ]);
      setData(queue);
      setUsers(Array.isArray(usersResult.data) ? usersResult.data.filter((u) => u.active !== false) : []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível carregar a fila gerencial.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const all = useMemo(() => (data?.incidents || []).map((item) => ({
    ...item, _priority: priorityOf(item), _recommendation: recommendationOf(item),
  })), [data]);
  const summary = useMemo(() => {
    const now = Date.now();
    return {
      action: data?.summary?.actionNow ?? all.filter((i) => ['P1', 'P2'].includes(i._priority.level) && !i.openServiceOrder).length,
      risk: data?.summary?.riskWithin3Days ?? all.filter((i) => Number.isFinite(i.toner?.daysLeft) && i.toner.daysLeft <= 3).length,
      overdue: data?.summary?.overdueDecisions ?? all.filter((i) => {
        const due = i.workflow?.decisionDueAt || i.workflow?.monitoringUntil;
        return due && new Date(due).getTime() < now;
      }).length,
      contact: all.filter((i) => ['P1', 'P2'].includes(i._priority.level) && i.customer?.phone).length,
      unlinked: data?.summary?.unlinked ?? all.filter((i) => i.mappingState !== 'MATCHED').length,
      openOs: data?.summary?.openServiceOrders ?? all.filter((i) => i.openServiceOrder).length,
      monitoring: data?.summary?.monitoring ?? all.filter((i) => i.state === 'MONITORING').length,
    };
  }, [all, data]);

  const visible = useMemo(() => {
    const now = Date.now();
    let list = all.filter((i) => {
      if (filter === 'action') return ['P1', 'P2'].includes(i._priority.level) && !i.openServiceOrder;
      if (filter === 'risk') return Number.isFinite(i.toner?.daysLeft) && i.toner.daysLeft <= 3;
      if (filter === 'overdue') {
        const due = i.workflow?.decisionDueAt || i.workflow?.monitoringUntil;
        return due && new Date(due).getTime() < now;
      }
      if (filter === 'contact') return ['P1', 'P2'].includes(i._priority.level) && Boolean(i.customer?.phone);
      if (filter === 'unlinked') return i.mappingState !== 'MATCHED';
      if (filter === 'openOs') return Boolean(i.openServiceOrder);
      if (filter === 'monitoring') return i.state === 'MONITORING';
      return true;
    });
    list = [...list].sort((a, b) => sort === 'age'
      ? Number(b.ageMinutes || 0) - Number(a.ageMinutes || 0)
      : Number(b._priority.score || 0) - Number(a._priority.score || 0));
    return list;
  }, [all, filter, sort]);

  const selectedList = Object.values(selected);
  const sameCustomer = selectedList.length > 1 && new Set(selectedList.map((i) => i.customer?.id)).size === 1;
  const selectionReady = sameCustomer && selectedList.every((i) => i.mappingState === 'MATCHED' && !i.openServiceOrder);

  const refreshAfter = async (message) => {
    if (message) toast.success(message);
    setDialog(null); setSelected({}); await load();
  };

  async function saveMonitor(form) {
    setBusy(true);
    try {
      await monitorTelemetryEvent(dialog.item.id, {
        monitoringUntil: new Date(form.until).toISOString(), assignedToId: form.assignedToId || null,
        monitoringCondition: form.condition, nextStep: form.note,
      });
      await refreshAfter('Monitoramento agendado com responsável e prazo.');
    } catch (error) { toast.error(error.response?.data?.error || 'Falha ao agendar monitoramento.'); }
    finally { setBusy(false); }
  }

  async function saveIgnore(form) {
    setBusy(true);
    try {
      await ignoreTelemetryEvent(dialog.item.id, { reason: form.reason, note: form.note });
      await refreshAfter('Ocorrência retirada da fila e registrada na auditoria.');
    } catch (error) { toast.error(error.response?.data?.error || 'Falha ao ignorar ocorrência.'); }
    finally { setBusy(false); }
  }

  async function saveOs(typeCode) {
    setBusy(true);
    try {
      if (dialog.items?.length > 1) {
        await consolidateParkServiceOrder({ eventIds: dialog.items.map((i) => i.id), cdOstp: typeCode });
        await refreshAfter('O.S. consolidada criada para a reposição.');
      } else {
        await approveTelemetryEvent(dialog.item.id, { cdOstp: typeCode });
        await refreshAfter('O.S. criada e vinculada à ocorrência.');
      }
    } catch (error) { toast.error(error.response?.data?.error || 'Falha ao abrir a O.S.'); }
    finally { setBusy(false); }
  }

  async function notifyManager(item) {
    setBusy(true);
    try {
      if (item.openServiceOrder?.id) await sendOSManagerCopy(item.openServiceOrder.id);
      else await notifyParkIncident(item.id, { channel: 'manager' });
      toast.success('Gestor notificado.');
    } catch (error) { toast.error(error.response?.data?.error || 'Não foi possível notificar o gestor.'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="park-loading"><Loader2 className="spin" size={18} /> Montando fila gerencial…</div>;
  if (!data) return <div className="park-empty">Telemetria indisponível.</div>;

  const kpis = [
    ['action', 'Ação hoje', summary.action, ShieldAlert, 'danger'],
    ['risk', 'Risco em até 3 dias', summary.risk, AlertTriangle, 'warning'],
    ['overdue', 'Decisões vencidas', summary.overdue, CalendarClock, 'danger'],
    ['contact', 'Clientes a contatar', summary.contact, MessageCircle, 'info'],
    ['unlinked', 'Vínculos pendentes', summary.unlinked, Link2, 'warning'],
    ['openOs', 'Com O.S. aberta', summary.openOs, ClipboardList, 'success'],
    ['monitoring', 'Em monitoramento', summary.monitoring, CheckCircle2, 'success'],
  ];

  return <div className="park-decision">
    <section className="park-kpis" aria-label="Resumo executivo">
      {kpis.map(([key, label, value, Icon, tone]) => <button key={key} className={`park-kpi ${filter === key ? 'active' : ''}`} onClick={() => setFilter(filter === key ? 'all' : key)}>
        <span className={`park-kpi-icon ${tone}`}><Icon size={17} /></span>
        <span><b>{fmtInt(value)}</b><small>{label}</small></span>
      </button>)}
    </section>

    <section className="park-toolbar">
      <div><b>Fila de decisão gerencial</b><span>{visible.length} de {all.length} ocorrência(s)</span></div>
      <div className="park-toolbar-actions">
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenação">
          <option value="priority">Maior prioridade</option><option value="age">Mais antigas</option>
        </select>
        {filter !== 'all' && <button className="park-btn ghost" onClick={() => setFilter('all')}>Limpar filtro</button>}
        <button className="park-btn" onClick={load}><RefreshCw size={15} /> Atualizar</button>
      </div>
    </section>

    {selectedList.length > 1 && <section className={`park-selection ${selectionReady ? '' : 'blocked'}`}>
      <span><b>{selectedList.length} selecionados.</b> {selectionReady ? 'Podem ser consolidados em uma única O.S. de reposição.' : 'Para consolidar, selecione ocorrências vinculadas do mesmo cliente e sem O.S. aberta.'}</span>
      <button disabled={!selectionReady} className="park-btn primary" onClick={() => setDialog({ type: 'os', items: selectedList, item: selectedList[0] })}>Gerar 1 O.S.</button>
    </section>}

    <div className="park-workspace">
      <section className="park-list">
        {visible.length === 0 && <div className="park-empty">Nenhuma ocorrência neste filtro.</div>}
        {visible.map((item) => <IncidentRow key={item.id} item={item} checked={Boolean(selected[item.id])}
          onToggle={() => setSelected((prev) => { const next = { ...prev }; if (next[item.id]) delete next[item.id]; else next[item.id] = item; return next; })}
          onDialog={(type) => setDialog({ type, item })} onNotify={() => notifyManager(item)} busy={busy} />)}
      </section>
      <ReplenishmentPanel groups={data.replenishment || []} incidents={all} selected={selected} setSelected={setSelected} onOs={(items) => setDialog({ type: 'os', items, item: items[0] })} />
    </div>

    {dialog?.type === 'monitor' && <MonitorDialog item={dialog.item} users={users} busy={busy} onClose={() => setDialog(null)} onSave={saveMonitor} />}
    {dialog?.type === 'ignore' && <IgnoreDialog busy={busy} onClose={() => setDialog(null)} onSave={saveIgnore} />}
    {dialog?.type === 'os' && <OsDialog item={dialog.item} count={dialog.items?.length || 1} osTypes={osTypes} busy={busy} onClose={() => setDialog(null)} onSave={saveOs} />}
    {dialog?.type === 'binding' && <BindingDialog item={dialog.item} busy={busy} onClose={() => setDialog(null)} onDone={() => refreshAfter('Vínculo corrigido e fila recalculada.')} />}
    {dialog?.type === 'timeline' && <TimelineDialog item={dialog.item} onClose={() => setDialog(null)} />}
    {dialog?.type === 'assign' && <AssignDialog item={dialog.item} users={users} busy={busy} onClose={() => setDialog(null)} onDone={() => refreshAfter('Responsável e próximo passo atualizados.')} />}
  </div>;
}

function IncidentRow({ item, checked, onToggle, onDialog, onNotify, busy }) {
  const priority = item._priority;
  const rec = item._recommendation;
  const phone = digits(item.customer?.phone);
  const reasons = priority.reasons?.length ? priority.reasons : [rec.explanation];
  const due = item.workflow?.decisionDueAt || item.workflow?.monitoringUntil;
  return <article className={`park-incident priority-${priority.level.toLowerCase()}`}>
    <div className="park-inc-head">
      <label><input type="checkbox" checked={checked} onChange={onToggle} /> <span className={`park-priority ${priority.level.toLowerCase()}`}>{priority.level}</span></label>
      <span className="park-event">{item.eventType}</span><span className="park-age">{ageLabel(item.ageMinutes)}</span>
    </div>
    <div className="park-inc-grid">
      <div className="park-inc-identity">
        <h3>{item.customerName || 'Cliente não identificado'}</h3>
        <b>{item.equipment?.model || 'Equipamento não identificado'}</b>
        <span>Série: {item.serialNumber || 'não informada'}{item.equipment?.sector ? ` · ${item.equipment.sector}` : ''}</span>
        <span>{item.customer?.address || item.equipment?.address || 'Endereço não informado'}</span>
        {item.contract && <span>Contrato #{item.contract.number || item.contract.externalId || '—'}{item.franchise?.limit ? ` · ${fmtInt(item.franchise.limit)} pág.` : ''}</span>}
      </div>
      <div className="park-inc-evidence">
        <small>EVIDÊNCIA E IMPACTO</small>
        <b>{reasons[0]}</b>
        <span>Saúde {item.healthScore ?? '—'} · {item.callCount90d || 0} chamado(s)/90d</span>
        {item.toner?.daysLeft != null && <span>Previsão: {item.toner.daysLeft <= 1 ? 'menos de 1 dia' : `~${Math.ceil(item.toner.daysLeft)} dias`}{item.trend?.pagesPerDay ? ` · ${Math.round(item.trend.pagesPerDay)} pág./dia` : ''}</span>}
        {item.mappingState !== 'MATCHED' && <span className="park-warning">Vínculo {String(item.mappingState || 'pendente').toLowerCase()}</span>}
      </div>
      <div className="park-inc-recommendation">
        <small>RECOMENDAÇÃO</small><b>{rec.label}</b><span>{rec.explanation}</span>
        <em>Confiança {rec.confidence === 'high' ? 'alta' : rec.confidence === 'medium' ? 'média' : 'baixa'}</em>
      </div>
      <div className="park-inc-owner">
        <small>RESPONSÁVEL / PRAZO</small><b>{item.workflow?.assignedTo?.name || 'Não atribuído'}</b>
        <span>{due ? fmtDate(due) : 'Sem prazo definido'}</span><span>{item.workflow?.nextStep || 'Próximo passo não registrado'}</span>
      </div>
    </div>
    <div className="park-inc-actions">
      {item.mappingState !== 'MATCHED'
        ? <button className="park-btn primary" onClick={() => onDialog('binding')}><Link2 size={14} /> Corrigir vínculo</button>
        : item.openServiceOrder
          ? <button className="park-btn primary" onClick={() => window.open(`${BACKEND_URL}/api/os/${encodeURIComponent(item.openServiceOrder.number || item.openServiceOrder.id)}/pdf?token=${localStorage.getItem('token')}`, '_blank', 'noopener,noreferrer')}><ExternalLink size={14} /> O.S. {item.openServiceOrder.number || ''}</button>
          : <button className="park-btn primary" onClick={() => onDialog('os')}><ClipboardList size={14} /> Abrir O.S.</button>}
      <button className="park-btn" onClick={() => onDialog('monitor')}><CalendarClock size={14} /> Monitorar</button>
      <button className="park-btn" onClick={() => onDialog('assign')}><UserRound size={14} /> Atribuir</button>
      <button className="park-btn" onClick={() => onDialog('timeline')}><History size={14} /> Histórico</button>
      <button className="park-btn" onClick={() => window.open(`/crm?q=${encodeURIComponent(item.customerName || '')}`, '_blank')}><ExternalLink size={14} /> CRM 360</button>
      <button className="park-btn" disabled={!phone} title={phone ? 'Abrir conversa no WhatsApp' : 'Telefone não disponível'} onClick={() => window.open(`https://wa.me/${phone}`, '_blank')}><MessageCircle size={14} /> WhatsApp</button>
      <button className="park-btn" disabled={busy} onClick={onNotify}><BellRing size={14} /> Gestor</button>
      <button className="park-btn danger" onClick={() => onDialog('ignore')}>Ignorar</button>
    </div>
  </article>;
}

function ReplenishmentPanel({ groups, incidents, selected, setSelected, onOs }) {
  return <aside className="park-replenishment">
    <header><div><b>Reposição da semana</b><span>Consolide por cliente e evite chamados duplicados.</span></div><span>{groups.length}</span></header>
    {!groups.length && <div className="park-empty">Sem reposição sugerida.</div>}
    {groups.map((group) => {
      const items = group.eventIds?.map((id) => incidents.find((i) => i.id === id)).filter(Boolean) || [];
      const usable = items.filter((i) => i.mappingState === 'MATCHED' && !i.openServiceOrder);
      const allSelected = usable.length && usable.every((i) => selected[i.id]);
      return <div className="park-replenishment-group" key={group.customer?.id || group.customer?.name}>
        <b>{group.customer?.name}</b><span>{group.total} item(ns) · {group.urgent} urgente(s)</span>
        <ul>{group.items?.slice(0, 5).map((i) => <li key={i.eventId}>{i.equipment?.model || i.serialNumber} {i.toner?.daysLeft != null ? `· ~${Math.max(0, Math.ceil(i.toner.daysLeft))}d` : ''}{i.openServiceOrder ? ' · já tem O.S.' : ''}</li>)}</ul>
        <small>Estoque e rota: fonte ainda não integrada.</small>
        <div><button className="park-btn" disabled={!usable.length} onClick={() => setSelected((prev) => {
          const next = { ...prev }; usable.forEach((i) => { if (allSelected) delete next[i.id]; else next[i.id] = i; }); return next;
        })}>{allSelected ? 'Limpar seleção' : 'Selecionar itens'}</button>
        <button className="park-btn primary" disabled={!usable.length} onClick={() => onOs(usable)}>Gerar 1 O.S.</button></div>
      </div>;
    })}
  </aside>;
}

function Modal({ title, eyebrow, onClose, children, footer }) {
  return <div className="park-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="park-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={19} /></button></header>
      <div className="park-modal-body">{children}</div>{footer && <footer>{footer}</footer>}
    </section>
  </div>;
}

function MonitorDialog({ item, users, busy, onClose, onSave }) {
  const [form, setForm] = useState({ until: tomorrowAtTen(), assignedToId: item.workflow?.assignedTo?.id || '', condition: item.workflow?.monitoringCondition || 'Escalar se o nível cair novamente ou não houver nova leitura.', note: item.workflow?.nextStep || '' });
  return <Modal eyebrow="Decisão assistida" title="Monitorar com compromisso" onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || !form.until || !form.condition.trim()} onClick={() => onSave(form)}>Salvar monitoramento</button></>}>
    <p>Monitorar não é arquivar: a ocorrência volta para decisão ao vencer o prazo.</p>
    <label>Reavaliar em<input type="datetime-local" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></label>
    <label>Responsável<select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}><option value="">Não atribuído</option>{users.map((u) => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
    <label>Condição de escalonamento<textarea value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} /></label>
    <label>Próximo passo / observação<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
  </Modal>;
}

function IgnoreDialog({ busy, onClose, onSave }) {
  const [form, setForm] = useState({ reason: '', note: '' });
  return <Modal eyebrow="Auditoria obrigatória" title="Ignorar ocorrência" onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn danger" disabled={busy || !form.reason || (form.reason === 'OTHER' && !form.note.trim())} onClick={() => onSave(form)}>Confirmar e registrar</button></>}>
    <p>O motivo fica no histórico para medir ruído da telemetria e decisões da equipe.</p>
    <label>Motivo<select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}><option value="">Selecione…</option><option value="FALSE_POSITIVE">Falso positivo</option><option value="ALREADY_SUPPLIED">Suprimento já enviado</option><option value="OPEN_ORDER">Já existe O.S.</option><option value="DUPLICATE">Evento duplicado</option><option value="EQUIPMENT_INACTIVE">Equipamento inativo</option><option value="NO_CONTRACT">Fora de contrato</option><option value="OTHER">Outro</option></select></label>
    <label>Observação<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Contexto da decisão" /></label>
  </Modal>;
}

function OsDialog({ item, count, osTypes, busy, onClose, onSave }) {
  const [code, setCode] = useState(item.suggestedOsType?.code || '');
  return <Modal eyebrow="Abertura no iLux" title={count > 1 ? `Consolidar ${count} ocorrências` : 'Abrir ordem de serviço'} onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || !code} onClick={() => onSave(code)}>Confirmar O.S.</button></>}>
    <p>{count > 1 ? 'Será criada uma única O.S. para o cliente, reunindo os itens selecionados.' : item._recommendation?.explanation}</p>
    <label>Tipo de O.S.<select value={code} onChange={(e) => setCode(e.target.value)}><option value="">Selecione…</option>{osTypes.map((type) => <option key={type.code || type.id} value={type.code || type.id}>{type.code ? `${type.code} — ` : ''}{type.name}</option>)}</select></label>
  </Modal>;
}

function BindingDialog({ item, busy, onClose, onDone }) {
  const [loading, setLoading] = useState(true); const [data, setData] = useState(null); const [equipmentId, setEquipmentId] = useState('');
  useEffect(() => { getParkBindingCandidates(item.id).then(({ data: value }) => setData(value)).catch((e) => toast.error(e.response?.data?.error || 'Falha ao buscar candidatos.')).finally(() => setLoading(false)); }, [item.id]);
  const equipment = data?.equipments?.find((e) => e.id === equipmentId);
  const customer = data?.customers?.find((c) => c.id === equipment?.customerId);
  async function save() { try { await resolveParkBinding(item.id, { customerId: customer?.id, equipmentId }); onDone(); } catch (e) { toast.error(e.response?.data?.error || 'Falha ao corrigir vínculo.'); } }
  return <Modal eyebrow="Qualidade cadastral" title="Corrigir vínculo" onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || !customer || !equipmentId} onClick={save}>Confirmar vínculo</button></>}>
    {loading ? <div className="park-loading"><Loader2 className="spin" /> Buscando no iLux…</div> : <>
      <p>Evento: {item.serialNumber || 'série não informada'}. Selecione o equipamento correto; o cliente será validado automaticamente.</p>
      <label>Equipamento<select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}><option value="">Selecione…</option>{data?.equipments?.map((e) => { const owner = data.customers?.find((c) => c.id === e.customerId); return <option value={e.id} key={e.id}>{e.model || e.externalId} · {e.serialNumber || 'sem série'} · {owner?.name || 'cliente não identificado'}</option>; })}</select></label>
      {equipment && <div className="park-confirmation"><b>{customer?.name}</b><span>{equipment.model} · {equipment.serialNumber}</span><span>{equipment.address || customer?.address || 'Endereço não informado'}</span></div>}
    </>}
  </Modal>;
}

function TimelineDialog({ item, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { if (item.equipment?.id) getParkEquipmentTimeline(item.equipment.id, { days: 90 }).then(({ data: value }) => setData(value)).catch(() => setData({ events: [] })); }, [item.equipment?.id]);
  return <Modal eyebrow="Visão consolidada" title="Histórico do equipamento" onClose={onClose} footer={<button className="park-btn" onClick={onClose}>Fechar</button>}>
    {!data ? <div className="park-loading"><Loader2 className="spin" /> Carregando…</div> : <div className="park-timeline">{(data.events || data.timeline || []).length === 0 && <p>Sem eventos no período.</p>}{(data.events || data.timeline || []).map((e, idx) => <div key={e.id || idx}><b>{e.eventType || e.type || 'Evento'}</b><span>{fmtDate(e.occurredAt || e.createdAt)}</span><p>{e.description || e.status || e.state}</p></div>)}</div>}
  </Modal>;
}

function AssignDialog({ item, users, busy, onClose, onDone }) {
  const [form, setForm] = useState({ assignedToId: item.workflow?.assignedTo?.id || '', decisionDueAt: '', nextStep: item.workflow?.nextStep || '' });
  async function save() { try { await assignParkIncident(item.id, { ...form, decisionDueAt: form.decisionDueAt ? new Date(form.decisionDueAt).toISOString() : null }); onDone(); } catch (e) { toast.error(e.response?.data?.error || 'Falha ao atribuir ocorrência.'); } }
  return <Modal eyebrow="Responsabilidade" title="Atribuir decisão" onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || !form.assignedToId} onClick={save}>Salvar atribuição</button></>}>
    <label>Responsável<select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}><option value="">Selecione…</option>{users.map((u) => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
    <label>Prazo da decisão<input type="datetime-local" value={form.decisionDueAt} onChange={(e) => setForm({ ...form, decisionDueAt: e.target.value })} /></label>
    <label>Próximo passo<textarea value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} /></label>
  </Modal>;
}
