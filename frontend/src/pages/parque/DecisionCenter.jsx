import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BellRing, CalendarClock, CheckCircle2, ChevronRight, ClipboardList,
  ExternalLink, History, Link2, Loader2, MessageCircle, RefreshCw, ShieldAlert, UserRound,
  X, Search, SlidersHorizontal, Save, UsersRound, TimerReset,
} from 'lucide-react';
import {
  BACKEND_URL, approveTelemetryEvent, assignParkIncident, consolidateParkServiceOrder,
  getParkBindingCandidates, getParkEquipmentTimeline, getParkQueue, getUsers, ignoreTelemetryEvent,
  monitorTelemetryEvent, notifyParkIncident, resolveParkBinding, sendOSManagerCopy, bulkParkIncidents,
} from '../../services/api';
import { toast } from '../../utils/toast';
import { usePermissions } from '../../auth/PermissionContext';
import { CrmCustomerProfileModal } from '../CRM';
import IncidentInsights from './IncidentInsights';
import './DecisionCenter.css';

const PRIORITY_LABELS = { P1: 'Crítica', P2: 'Alta', P3: 'Média', P4: 'Baixa' };
const EVENT_LABELS = {
  'toner.low': 'Toner baixo', 'toner.empty': 'Toner esgotado',
  'supply.low': 'Suprimento baixo', 'supply.empty': 'Suprimento esgotado',
  'printer.offline': 'Equipamento offline', 'device.offline': 'Equipamento offline',
  'hardware.error': 'Falha no equipamento', 'paper.jam': 'Atolamento de papel',
  'meter.reading': 'Leitura do contador', telemetry: 'Alerta de telemetria',
};
const EVENT_WORDS = {
  toner: 'toner', supply: 'suprimento', printer: 'equipamento', device: 'equipamento',
  hardware: 'equipamento', meter: 'contador', reading: 'leitura', low: 'baixo',
  empty: 'esgotado', offline: 'offline', error: 'com falha', warning: 'em atenção',
  jam: 'atolamento', paper: 'papel', cover: 'tampa', open: 'aberta', maintenance: 'manutenção',
};
const priorityLabel = (level) => PRIORITY_LABELS[String(level || '').toUpperCase()] || 'Não definida';
const eventLabel = (type) => {
  const raw = String(type || 'telemetry').trim();
  if (EVENT_LABELS[raw.toLowerCase()]) return EVENT_LABELS[raw.toLowerCase()];
  const readable = raw.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    .map((word) => EVENT_WORDS[word.toLowerCase()] || word).join(' ');
  return readable ? readable.charAt(0).toLocaleUpperCase('pt-BR') + readable.slice(1) : 'Alerta de telemetria';
};

function healthPresentation(item) {
  if (item.healthScore === null || item.healthScore === undefined || item.healthScore === '') return { label: 'Saúde não calculada', tone: 'unknown', detail: 'Não há dados suficientes para calcular a saúde do equipamento.' };
  const score = Number(item.healthScore);
  if (!Number.isFinite(score)) return { label: 'Saúde não calculada', tone: 'unknown', detail: 'Não há dados suficientes para calcular a saúde do equipamento.' };
  const tone = score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'bad';
  const status = tone === 'ok' ? 'Saudável' : tone === 'warn' ? 'Atenção' : 'Crítico';
  const calls = Number(item.callCount90d || 0);
  const callPenalty = Math.min(60, calls * 9);
  const agePenalty = Math.min(20, Math.floor(Number(item.ageMinutes || 0) / 1440) * 3);
  const inactivePenalty = item.equipment?.isActive === false ? 25 : 0;
  const parts = ['Nota inicial: 100', `${calls} chamado(s) em 90 dias: -${callPenalty}`];
  if (agePenalty) parts.push(`tempo pendente: -${agePenalty}`);
  if (inactivePenalty) parts.push('equipamento inativo: -25');
  parts.push(`resultado: ${score}/100`);
  return { label: `${status} — ${score}/100`, tone, detail: parts.join('; ') };
}

const incidentContext = (item) => ({
  customer: item.customerName,
  equipment: item.equipment?.model
    ? `${item.equipment.model}${item.serialNumber ? ` (série ${item.serialNumber})` : ''}`
    : (item.serialNumber || null),
  eventType: eventLabel(item.eventType),
  priority: item._priority?.level ? `${priorityLabel(item._priority.level)} (${item._priority.level})` : null,
  recommendation: item._recommendation?.label,
});

const fmtInt = (value) => Number(value || 0).toLocaleString('pt-BR');
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

const EMPTY_ADVANCED_FILTERS = {
  query: '', assignee: 'all', priority: 'all', eventType: 'all', location: '',
  ownership: 'all', deadline: 'all', recurrence: 'all', dateFrom: '', dateTo: '',
};
const SAVED_VIEWS_KEY = 'sentinela.decision.savedViews.v1';

function safeSavedViews() {
  try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]'); } catch { return []; }
}

function itemDueAt(item) {
  return item.workflow?.decisionDueAt || item.workflow?.monitoringUntil || null;
}

function itemAssigneeId(item) {
  return String(item.workflow?.assignedTo?.id || item.workflow?.assignedToId || '');
}

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

export default function DecisionCenter({ osTypes = [], onSummaryChange }) {
  const { user, can } = usePermissions();
  const canManage = can('telemetry.manage');
  const canAudit = can('audit.view');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('priority');
  const [selected, setSelected] = useState({});
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(EMPTY_ADVANCED_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedViews, setSavedViews] = useState(safeSavedViews);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [{ data: queue }, usersResult] = await Promise.all([
        getParkQueue({ windowHours: 168, limit: 200 }),
        getUsers().catch(() => ({ data: [] })),
      ]);
      setData(queue);
      onSummaryChange?.(queue?.summary || {});
      setUsers(Array.isArray(usersResult.data) ? usersResult.data.filter((u) => u.active !== false) : []);
      setLastUpdatedAt(new Date());
    } catch (error) {
      if (!silent) toast.error(error.response?.data?.error || 'Não foi possível carregar a operação diária.');
    } finally {
      loadingRef.current = false;
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [onSummaryChange]);
  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

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
      contact: data?.summary?.contactableCustomers ?? new Set(all.filter((i) => i.contactable && i.customer?.id).map((i) => i.customer.id)).size,
      unlinked: data?.summary?.unlinked ?? all.filter((i) => i.mappingState !== 'MATCHED').length,
      openOs: data?.summary?.openServiceOrders ?? all.filter((i) => i.openServiceOrder).length,
      monitoring: data?.summary?.monitoring ?? all.filter((i) => i.state === 'MONITORING').length,
      mine: all.filter((i) => user?.id && i.workflow?.assignedTo?.id === user.id).length,
    };
  }, [all, data, user]);

  const management = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const resolved = all.filter((i) => ['RESOLVED', 'IGNORED', 'APPROVED', 'CLOSED'].includes(String(i.state).toUpperCase()));
    const completedToday = resolved.filter((i) => new Date(i.workflow?.resolvedAt || i.updatedAt || 0) >= todayStart).length;
    const withDue = all.filter((i) => itemDueAt(i));
    const onTime = withDue.filter((i) => new Date(itemDueAt(i)).getTime() >= now || resolved.includes(i)).length;
    const decisionMinutes = resolved.map((i) => {
      const start = new Date(i.receivedAt || i.createdAt || 0).getTime();
      const end = new Date(i.workflow?.resolvedAt || i.updatedAt || 0).getTime();
      return start && end > start ? (end - start) / 60000 : null;
    }).filter(Number.isFinite);
    // IncidentInsights pode fornecer estes campos no payload sem quebrar instalações antigas.
    const insights = data?.management || data?.incidentInsights || data?.insights || {};
    return {
      completedToday: insights.completedToday ?? completedToday,
      sla: insights.slaCompliancePct ?? insights.slaPercent ?? (withDue.length ? Math.round((onTime / withDue.length) * 100) : 100),
      avgDecision: insights.avgDecisionMinutes ?? insights.averageDecisionMinutes ?? (decisionMinutes.length ? Math.round(decisionMinutes.reduce((a, b) => a + b, 0) / decisionMinutes.length) : null),
      unassigned: insights.unassigned ?? all.filter((i) => !itemAssigneeId(i)).length,
      openOs: insights.openServiceOrders ?? all.filter((i) => i.openServiceOrder).length,
      reopened: insights.reopened ?? all.filter((i) => Number(i.workflow?.reopenCount || i.reopenCount || 0) > 0).length,
    };
  }, [all, data]);

  const visible = useMemo(() => {
    const now = Date.now();
    let list = all.filter((i) => {
      if (filter === 'mine') return user?.id && i.workflow?.assignedTo?.id === user.id;
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
    }).filter((i) => {
      const q = advanced.query.trim().toLocaleLowerCase('pt-BR');
      const haystack = [i.customerName, i.serialNumber, i.equipment?.model, i.contract?.number,
        i.contract?.externalId, i.openServiceOrder?.number, i.eventType].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      if (q && !haystack.includes(q)) return false;
      if (advanced.assignee !== 'all' && itemAssigneeId(i) !== advanced.assignee) return false;
      if (advanced.priority !== 'all' && i._priority.level !== advanced.priority) return false;
      if (advanced.eventType !== 'all' && i.eventType !== advanced.eventType) return false;
      const place = [i.equipment?.city, i.equipment?.state, i.customer?.city, i.customer?.state, i.equipment?.installLocation].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      if (advanced.location && !place.includes(advanced.location.toLocaleLowerCase('pt-BR'))) return false;
      if (advanced.ownership === 'unassigned' && itemAssigneeId(i)) return false;
      if (advanced.ownership === 'assigned' && !itemAssigneeId(i)) return false;
      const due = itemDueAt(i) ? new Date(itemDueAt(i)) : null;
      if (advanced.deadline === 'none' && due) return false;
      if (advanced.deadline === 'overdue' && (!due || due.getTime() >= now)) return false;
      if (advanced.deadline === 'today' && (!due || due.toDateString() !== new Date().toDateString())) return false;
      const recurrence = Number(i.callCount90d || i.workflow?.reopenCount || i.reopenCount || 0);
      if (advanced.recurrence === 'yes' && recurrence < 2) return false;
      const detected = new Date(i.detectedAt || i.createdAt || i.receivedAt || 0);
      if (advanced.dateFrom && detected < new Date(`${advanced.dateFrom}T00:00:00`)) return false;
      if (advanced.dateTo && detected > new Date(`${advanced.dateTo}T23:59:59`)) return false;
      return true;
    });
    list = [...list].sort((a, b) => sort === 'age'
      ? Number(b.ageMinutes || 0) - Number(a.ageMinutes || 0)
      : Number(b._priority.score || 0) - Number(a._priority.score || 0));
    return list;
  }, [all, filter, sort, user, advanced]);

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
        monitoringCondition: form.condition, nextStep: form.note, context: incidentContext(dialog.item),
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
        const { data: result } = await consolidateParkServiceOrder({ eventIds: dialog.items.map((i) => i.id), cdOstp: typeCode });
        await refreshAfter(result?.reused ? 'O.S. já existente vinculada; nenhuma duplicata foi criada.' : 'O.S. consolidada criada para a reposição.');
      } else {
        const { data: result } = await approveTelemetryEvent(dialog.item.id, { cdOstp: typeCode });
        await refreshAfter(result?.reused ? 'O.S. existente vinculada; nenhuma duplicata foi criada.' : 'O.S. criada e vinculada à ocorrência.');
      }
    } catch (error) { toast.error(error.response?.data?.error || 'Falha ao abrir a O.S.'); }
    finally { setBusy(false); }
  }

  async function notifyManager(item) {
    setBusy(true);
    try {
      if (item.openServiceOrder?.id) {
        await sendOSManagerCopy(item.openServiceOrder.id);
        toast.success('Cópia da O.S. enviada ao gestor.');
      } else {
        const { data: result } = await notifyParkIncident(item.id, { channel: 'manager', context: incidentContext(item) });
        if (result?.delivered) toast.success('Gestor notificado por WhatsApp.');
        else toast.info('Registrado. Revise o WhatsApp e a instância em Configurações › Atendimento › Cópia automática de O.S.');
      }
    } catch (error) { toast.error(error.response?.data?.error || 'Não foi possível notificar o gestor.'); }
    finally { setBusy(false); }
  }

  function saveCurrentView() {
    const name = window.prompt('Nome da visão gerencial:');
    if (!name?.trim()) return;
    const view = { id: `${Date.now()}`, name: name.trim(), filter, sort, advanced };
    const next = [...savedViews.filter((v) => v.name !== view.name), view];
    setSavedViews(next);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    toast.success('Visão salva neste navegador.');
  }

  function applySavedView(id) {
    if (!id) return;
    const view = savedViews.find((v) => v.id === id);
    if (!view) return;
    setFilter(view.filter || 'all'); setSort(view.sort || 'priority');
    setAdvanced({ ...EMPTY_ADVANCED_FILTERS, ...view.advanced }); setShowAdvanced(true);
  }

  async function runBulk(form) {
    setBusy(true);
    const items = selectedList;
    if (form.action !== 'notify') {
      try {
        await bulkParkIncidents({
          eventIds: items.map((item) => item.id), action: form.action.toUpperCase(),
          assignedToId: form.assignedToId || null,
          decisionDueAt: form.action === 'assign' && form.until ? new Date(form.until).toISOString() : undefined,
          monitoringUntil: form.action === 'monitor' && form.until ? new Date(form.until).toISOString() : undefined,
          monitoringCondition: form.condition, nextStep: form.note, reason: form.reason,
        });
        await refreshAfter(`Ação aplicada a ${items.length} ocorrência(s).`);
      } catch (error) { toast.error(error.response?.data?.error || 'Não foi possível aplicar a ação em lote.'); }
      finally { setBusy(false); }
      return;
    }
    const tasks = items.map((item) => {
      return notifyParkIncident(item.id, { channel: 'manager', context: incidentContext(item) });
    });
    try {
      const results = await Promise.allSettled(tasks);
      const failures = results.filter((r) => r.status === 'rejected').length;
      if (failures) toast.error(`${items.length - failures} concluída(s); ${failures} falharam e permanecerão selecionadas.`);
      else toast.success(`Ação aplicada a ${items.length} ocorrência(s).`);
      setDialog(null);
      if (!failures) setSelected({});
      await load();
    } finally { setBusy(false); }
  }

  async function openConversation(item) {
    if (!item.customer?.id) { toast.error('Cliente não vinculado ao CRM — corrija o vínculo primeiro.'); return; }
    if (item.activeTicketId) {
      window.location.assign(`/inbox?ticketId=${encodeURIComponent(item.activeTicketId)}`);
      return;
    }
    setDialog({ type: 'crm360', item, tab: 'contacts' });
  }

  if (loading) return <div className="park-loading"><Loader2 className="spin" size={18} /> Montando operação diária…</div>;
  if (!data) return <div className="park-empty">Telemetria indisponível.</div>;

  const windowLabel = `${data.summary?.windowHours || 72} horas`;
  const kpis = [
    ['action', 'Ação hoje', summary.action, ShieldAlert, 'danger', `Ocorrências críticas (P1) ou de alta prioridade (P2) sem O.S. aberta, entre ${all.length} ocorrências da janela de ${windowLabel}.`],
    ['risk', 'Risco em até 3 dias', summary.risk, AlertTriangle, 'warning', 'Ocorrências com previsão de término do suprimento em até 3 dias, calculada pelo histórico de contador.'],
    ['overdue', 'Decisões vencidas', summary.overdue, CalendarClock, 'danger', `Ocorrências cujo prazo de decisão venceu na janela de ${windowLabel}.`],
    ['contact', 'Clientes com contato', summary.contact, MessageCircle, 'info', `Clientes distintos afetados com telefone preenchido; denominador: ${data.summary?.affectedCustomers || 0} clientes.`],
    ['unlinked', 'Vínculos pendentes', summary.unlinked, Link2, 'warning', 'Ocorrências sem vínculo confirmado entre cliente e equipamento.'],
    ['openOs', 'Com O.S. aberta', summary.openOs, ClipboardList, 'success', 'Ocorrências cujo equipamento possui O.S. ativa; não representa O.S. distintas.'],
    ['monitoring', 'Em monitoramento', summary.monitoring, CheckCircle2, 'success', 'Ocorrências com prazo de monitoramento ainda vigente.'],
  ];

  return <div className="park-decision">
    <div className="park-kpi-groups">
      <section className="park-kpi-group" aria-labelledby="park-alerts-title">
        <header><div><b id="park-alerts-title">Alertas da fila</b><span>Clique em um indicador para filtrar as ocorrências</span></div></header>
        <div className="park-kpis alerts">
          {kpis.map(([key, label, value, Icon, tone, definition]) => <button key={key} className={`park-kpi ${filter === key ? 'active' : ''}`} title={definition} aria-label={`${label}: ${fmtInt(value)}. ${definition}`} onClick={() => setFilter(filter === key ? 'all' : key)}>
            <span className={`park-kpi-icon ${tone}`}><Icon size={17} /></span>
            <span><b>{fmtInt(value)}</b><small>{label}</small></span>
          </button>)}
        </div>
      </section>
      <details className="park-kpi-more">
        <summary><span><b>Gestão de hoje</b><small>ritmo, SLA e distribuição do trabalho</small></span><ChevronRight size={14} /></summary>
        <div className="park-kpis management">
          {[
            ['Decisões hoje', management.completedToday, CheckCircle2, 'success'],
            ['SLA no prazo', `${management.sla}%`, TimerReset, management.sla >= 90 ? 'success' : 'warning'],
            ['Tempo médio decisão', management.avgDecision == null ? '—' : `${management.avgDecision} min`, CalendarClock, 'info'],
            ['Sem responsável', management.unassigned, UsersRound, management.unassigned ? 'danger' : 'success'],
            ['O.S. em andamento', management.openOs, ClipboardList, 'info'],
            ['Reabertas', management.reopened, RefreshCw, management.reopened ? 'warning' : 'success'],
          ].map(([label, value, Icon, tone]) => <div className="park-kpi" key={label} title="Indicador calculado com a fila carregada">
            <span className={`park-kpi-icon ${tone}`}><Icon size={17} /></span><span><b>{value}</b><small>{label}</small></span>
          </div>)}
        </div>
      </details>
    </div>

    <section className="park-toolbar">
      <div><b>Ocorrências que exigem decisão</b><span>{visible.length} de {all.length} ocorrência(s)</span></div>
      <div className="park-toolbar-actions">
        <select defaultValue="" onChange={(e) => applySavedView(e.target.value)} aria-label="Visões salvas">
          <option value="">Visões salvas</option>{savedViews.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button className="park-btn" onClick={saveCurrentView} title="Salvar filtros atuais"><Save size={14} /> Salvar visão</button>
        <button className={`park-btn ${showAdvanced ? 'primary' : ''}`} onClick={() => setShowAdvanced((v) => !v)}><SlidersHorizontal size={14} /> Filtros</button>
        {user?.id && (
          <button className={`park-btn ${filter === 'mine' ? 'primary' : ''}`} onClick={() => setFilter(filter === 'mine' ? 'all' : 'mine')}>
            <UserRound size={14} /> Minha fila{summary.mine ? ` (${summary.mine})` : ''}
          </button>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenação">
          <option value="priority">Maior prioridade</option><option value="age">Mais antigas</option>
        </select>
        {filter !== 'all' && <button className="park-btn ghost" onClick={() => setFilter('all')}>Limpar filtro</button>}
        <span className="park-last-update" title="Novos alertas chegam pelo PrintGuard em tempo real; esta fila é relida automaticamente a cada 60 segundos.">
          {lastUpdatedAt ? `Atualizado às ${lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Aguardando atualização'}
        </span>
        <button className="park-btn" disabled={refreshing} onClick={() => load({ silent: true })}><RefreshCw className={refreshing ? 'spin' : ''} size={15} /> Atualizar</button>
        {canAudit && <a className="park-btn" href="/audit?resource=printguard_event" title="Abrir a trilha completa das decisões do parque"><ExternalLink size={14} /> Auditoria completa</a>}
      </div>
    </section>

    {showAdvanced && <AdvancedFilters value={advanced} onChange={setAdvanced} users={users} incidents={all}
      onClear={() => { setAdvanced(EMPTY_ADVANCED_FILTERS); setFilter('all'); }} />}

    {selectedList.length > 0 && <section className={`park-selection ${selectionReady ? '' : 'blocked'}`}>
      <span><b>{selectedList.length} selecionado(s).</b> Atribua, monitore, notifique ou encerre ocorrências em conjunto.</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="park-btn" onClick={() => setSelected({})}>Limpar</button>
        <button className="park-btn primary" onClick={() => setDialog({ type: 'bulk', items: selectedList })}>Ação em lote</button>
        {selectedList.length > 1 && <button disabled={!selectionReady} className="park-btn primary" onClick={() => setDialog({ type: 'os', items: selectedList, item: selectedList[0] })}>Gerar 1 O.S.</button>}
      </div>
    </section>}

    <div className="park-workspace">
      <section className="park-list">
        {visible.length === 0 && <div className="park-empty">Nenhuma ocorrência neste filtro.</div>}
        {visible.map((item) => <IncidentRow key={item.id} item={item} checked={Boolean(selected[item.id])} canManage={canManage}
          onToggle={() => setSelected((prev) => { const next = { ...prev }; if (next[item.id]) delete next[item.id]; else next[item.id] = item; return next; })}
          onDialog={(type) => setDialog({ type, item })} onNotify={() => notifyManager(item)}
          onConversation={() => openConversation(item)} busy={busy} />)}
      </section>
      <ReplenishmentPanel groups={data.replenishment || []} incidents={all} selected={selected} setSelected={setSelected} canManage={canManage} onOs={(items) => setDialog({ type: 'os', items, item: items[0] })} />
    </div>

    {dialog?.type === 'monitor' && <MonitorDialog item={dialog.item} users={users} busy={busy} onClose={() => setDialog(null)} onSave={saveMonitor} />}
    {dialog?.type === 'ignore' && <IgnoreDialog busy={busy} onClose={() => setDialog(null)} onSave={saveIgnore} />}
    {dialog?.type === 'os' && <OsDialog item={dialog.item} count={dialog.items?.length || 1} osTypes={osTypes} busy={busy} onClose={() => setDialog(null)} onSave={saveOs} />}
    {dialog?.type === 'os-open' && <OpenOrdersDialog item={dialog.item} onClose={() => setDialog(null)} />}
    {dialog?.type === 'binding' && <BindingDialog item={dialog.item} busy={busy} onClose={() => setDialog(null)} onDone={() => refreshAfter('Vínculo corrigido e fila recalculada.')} />}
    {dialog?.type === 'timeline' && <TimelineDialog item={dialog.item} onClose={() => setDialog(null)} />}
    {dialog?.type === 'assign' && <AssignDialog item={dialog.item} users={users} busy={busy} onClose={() => setDialog(null)} onDone={() => refreshAfter('Responsável notificado no chat interno.')} />}
    {dialog?.type === 'bulk' && <BulkActionDialog count={dialog.items.length} users={users} busy={busy} onClose={() => setDialog(null)} onSave={runBulk} />}
    {dialog?.type === 'crm360' && dialog.item.customer?.id && (
      <CrmCustomerProfileModal
        customerId={dialog.item.customer.id}
        initialTab={dialog.tab || 'overview'}
        onClose={() => setDialog(null)}
        onOpenConversation={() => setDialog(null)}
        onOpenServiceOrder={() => setDialog(null)}
      />
    )}
  </div>;
}

function AdvancedFilters({ value, onChange, users, incidents, onClear }) {
  const set = (key, next) => onChange((old) => ({ ...old, [key]: next }));
  const eventTypes = [...new Set(incidents.map((i) => i.eventType).filter(Boolean))].sort();
  return <section className="park-selection" aria-label="Filtros avançados" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
    <div className="park-advanced-grid">
      <label style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 9, top: 11 }} />
        <input style={{ paddingLeft: 30, width: '100%' }} value={value.query} onChange={(e) => set('query', e.target.value)} placeholder="Cliente, série, equipamento, contrato ou O.S." />
      </label>
      <select value={value.assignee} onChange={(e) => set('assignee', e.target.value)} aria-label="Responsável"><option value="all">Todos responsáveis</option>{users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}</select>
      <select value={value.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Prioridade"><option value="all">Todas prioridades</option>{['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p} value={p}>{priorityLabel(p)} ({p})</option>)}</select>
      <select value={value.eventType} onChange={(e) => set('eventType', e.target.value)} aria-label="Tipo"><option value="all">Todos os tipos</option>{eventTypes.map((t) => <option key={t} value={t}>{eventLabel(t)}</option>)}</select>
      <input value={value.location} onChange={(e) => set('location', e.target.value)} placeholder="Cidade, UF ou rota" />
      <select aria-label="Situação de atribuição" value={value.ownership} onChange={(e) => set('ownership', e.target.value)}><option value="all">Com ou sem responsável</option><option value="unassigned">Sem responsável</option><option value="assigned">Com responsável</option></select>
      <select aria-label="Situação do prazo" value={value.deadline} onChange={(e) => set('deadline', e.target.value)}><option value="all">Todos os prazos</option><option value="overdue">Prazo vencido</option><option value="today">Vence hoje</option><option value="none">Sem prazo</option></select>
      <select aria-label="Reincidência" value={value.recurrence} onChange={(e) => set('recurrence', e.target.value)}><option value="all">Todos os históricos</option><option value="yes">Somente reincidentes</option></select>
      <input type="date" title="Detectado a partir de" value={value.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
      <div style={{ display: 'flex', gap: 6 }}><input type="date" title="Detectado até" value={value.dateTo} onChange={(e) => set('dateTo', e.target.value)} /><button className="park-btn ghost" onClick={onClear}>Limpar</button></div>
    </div>
  </section>;
}

function BulkActionDialog({ count, users, busy, onClose, onSave }) {
  const [form, setForm] = useState({ action: 'assign', assignedToId: '', until: tomorrowAtTen(), condition: '', reason: 'DUPLICATE', note: '' });
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const needsDue = ['assign', 'monitor'].includes(form.action);
  const invalid = (needsDue && !form.until) || (form.action === 'assign' && !form.assignedToId) || (form.action === 'monitor' && !form.condition.trim());
  return <Modal eyebrow="Gestão em lote" title={`Agir sobre ${count} ocorrência(s)`} onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || invalid} onClick={() => onSave(form)}>{busy ? 'Aplicando…' : 'Aplicar a todos'}</button></>}>
    <p>A ação será registrada individualmente na auditoria de cada ocorrência.</p>
    <label>Ação<select value={form.action} onChange={(e) => set('action', e.target.value)}><option value="assign">Atribuir responsável e prazo</option><option value="monitor">Iniciar monitoramento</option><option value="notify">Notificar gestor</option><option value="ignore">Ignorar duplicadas/sem ação</option></select></label>
    {['assign', 'monitor'].includes(form.action) && <label>Responsável<select value={form.assignedToId} onChange={(e) => set('assignedToId', e.target.value)}><option value="">{form.action === 'assign' ? 'Selecione…' : 'Sem responsável definido'}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
    {needsDue && <label>Prazo<input type="datetime-local" value={form.until} onChange={(e) => set('until', e.target.value)} /></label>}
    {form.action === 'monitor' && <label>Condição para reavaliar<input value={form.condition} onChange={(e) => set('condition', e.target.value)} placeholder="Ex.: confirmar próxima leitura" /></label>}
    {form.action === 'ignore' && <label>Motivo<select value={form.reason} onChange={(e) => set('reason', e.target.value)}><option value="DUPLICATE">Ocorrência duplicada</option><option value="FALSE_POSITIVE">Falso positivo</option><option value="NO_ACTION_REQUIRED">Sem ação necessária</option></select></label>}
    {form.action !== 'notify' && <label>Próximo passo / justificativa<textarea rows="3" value={form.note} onChange={(e) => set('note', e.target.value)} /></label>}
  </Modal>;
}

function IncidentRow({ item, checked, onToggle, onDialog, onNotify, onConversation, busy, canManage }) {
  const priority = item._priority;
  const rec = item._recommendation;
  const hasCustomer = Boolean(item.customer?.id);
  const linked = item.mappingState === 'MATCHED';
  const reasons = priority.reasons?.length ? priority.reasons : [rec.explanation];
  const due = item.workflow?.decisionDueAt || item.workflow?.monitoringUntil;
  // Detecção antiga que só chegou agora (re-sync do PrintGuard): mostra os dois.
  const receivedMin = item.receivedAt ? Math.max(0, Math.round((Date.now() - new Date(item.receivedAt).getTime()) / 60000)) : null;
  const showReceived = receivedMin != null && Math.abs((item.ageMinutes || 0) - receivedMin) > 36 * 60;
  const health = healthPresentation(item);
  return <article className={`park-incident priority-${priority.level.toLowerCase()}`}>
    <div className="park-inc-head">
      <label><input type="checkbox" checked={checked} disabled={!canManage} title={canManage ? '' : 'Requer permissão para gerenciar o Sentinela'} onChange={onToggle} /> <span className={`park-priority ${priority.level.toLowerCase()}`} title={`Código operacional ${priority.level}`}>{priorityLabel(priority.level)} <small>{priority.level}</small></span></label>
      <span className="park-event" title={`Código PrintGuard: ${item.eventType}`}>{eventLabel(item.eventType)}</span>
      <span className="park-age">detectado {ageLabel(item.ageMinutes)}{showReceived ? ` · recebido ${ageLabel(receivedMin)}` : ''}</span>
    </div>
    <div className="park-inc-grid">
      <div className={`park-inc-identity${linked ? '' : ' provisional'}`}>
        <h3>{item.customerName || 'Cliente não identificado'}{linked ? '' : <em className="park-provisional-tag"> · provável, confirme o vínculo</em>}</h3>
        <b>{item.equipment?.model || 'Equipamento não identificado'}</b>
        <span>Série: {item.serialNumber || 'não informada'}{item.equipment?.sector ? ` · ${item.equipment.sector}` : ''}</span>
        <span>{item.customer?.address || item.equipment?.installLocation || item.equipment?.address || 'Endereço não informado'}</span>
        {(item.equipment?.city || item.equipment?.state) && <span>{[item.equipment.city, item.equipment.state].filter(Boolean).join(' / ')}</span>}
        {item.contract && <span>Contrato #{item.contract.number || item.contract.externalId || '—'}{item.franchise?.franchise ? ` · ${fmtInt(item.franchise.franchise)} pág.` : ''}</span>}
      </div>
      <div className="park-inc-evidence">
        <small>EVIDÊNCIA E IMPACTO</small>
        <b>{reasons[0]}</b>
        <span className={`park-health ${health.tone}`} title={health.detail}>{health.label} <small>ⓘ</small> · {item.callCount90d || 0} chamado(s)/90d</span>
        {item.toner?.daysLeft != null && (item.toner.daysLeft <= 21 || item.trend?.reliable) && (
          <span>
            Previsão: {item.toner.daysLeft <= 1 ? 'menos de 1 dia' : `~${Math.ceil(item.toner.daysLeft)} dias`}
            {item.trend?.pagesPerDay ? ` · ${Math.round(item.trend.pagesPerDay)} pág./dia` : ''}
            {!item.trend?.reliable ? ` · estimativa (${item.trend?.points || 0} leitura(s))` : ''}
          </span>
        )}
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
        ? <button className="park-btn primary" disabled={!canManage} onClick={() => onDialog('binding')}><Link2 size={14} /> Corrigir vínculo</button>
        : item.openServiceOrder
          ? <button className="park-btn primary" title="Este equipamento já tem O.S. em aberto; revise-a antes de criar outra" onClick={() => onDialog('os-open')}><ClipboardList size={14} /> Ver O.S. existente{(item.openServiceOrders?.length || 1) > 1 ? ` (${item.openServiceOrders.length})` : ''}</button>
          : <button className="park-btn primary" disabled={!canManage} onClick={() => onDialog('os')}><ClipboardList size={14} /> Abrir O.S.</button>}
      <button className="park-btn" disabled={!hasCustomer || busy} title={hasCustomer ? (item.activeTicketId ? 'Continuar conversa ativa' : 'Abrir ficha para iniciar atendimento') : 'Cliente não vinculado ao CRM'} onClick={onConversation}><MessageCircle size={14} /> {item.activeTicketId ? 'Atendimento' : 'Abrir ficha'}</button>
      <details className="park-more-actions"><summary className="park-btn">Mais ações <ChevronRight size={14} /></summary><div>
        <button className="park-btn" title="Definir responsável, prazo e condição para a ocorrência voltar à decisão" disabled={!canManage} onClick={() => onDialog('monitor')}><CalendarClock size={14} /> Monitorar com prazo</button>
        <button className="park-btn" title="Enviar a ocorrência para a Minha fila de um responsável e avisá-lo no chat interno" disabled={!canManage} onClick={() => onDialog('assign')}><UserRound size={14} /> Atribuir responsável</button>
        <button className="park-btn" onClick={() => onDialog('timeline')}><History size={14} /> Timeline do equipamento</button>
        <button className="park-btn" disabled={!hasCustomer} onClick={() => onDialog('crm360')}><ClipboardList size={14} /> CRM 360</button>
        <button className="park-btn" disabled={busy || !canManage} onClick={onNotify}><BellRing size={14} /> Gestor</button>
        <button className="park-btn danger" disabled={!canManage} onClick={() => onDialog('ignore')}>Ignorar</button>
      </div></details>
    </div>
    <IncidentInsights incident={item} />
  </article>;
}

function ReplenishmentPanel({ groups, incidents, selected, setSelected, onOs, canManage }) {
  return <aside className="park-replenishment">
    <header><div><b>Reposição da semana</b><span>Consolide por cliente e evite chamados duplicados.</span></div><span>{groups.length}</span></header>
    {!groups.length && <div className="park-empty">Sem reposição sugerida.</div>}
    {groups.map((group) => {
      const items = group.eventIds?.map((id) => incidents.find((i) => i.id === id)).filter(Boolean) || [];
      const usable = items.filter((i) => i.mappingState === 'MATCHED' && !i.openServiceOrder);
      const allSelected = usable.length && usable.every((i) => selected[i.id]);
      return <div className="park-replenishment-group" key={group.customer?.id || group.customer?.name}>
        <b>{group.customer?.name}</b><span>{group.total} item(ns) · {group.urgent} urgente(s)</span>
        <ul>{group.items?.slice(0, 5).map((i) => <li key={i.eventId}>
          <b>{[i.supply?.color, i.supply?.code].filter(Boolean).join(' / ') || 'Suprimento não identificado'}</b> · {i.equipment?.model || i.serialNumber}
          {i.toner?.daysLeft != null && (i.toner.daysLeft <= 21 || i.trend?.reliable) ? ` · consumo em ~${Math.max(0, Math.ceil(i.toner.daysLeft))}d${i.trend?.reliable ? '' : '?'}` : ''}
          {i.supply?.stockAvailable != null ? ` · estoque ${i.supply.stockAvailable}${i.supply.minimumStock != null ? ` (mín. ${i.supply.minimumStock})` : ''}` : ' · estoque não integrado'}
          {i.supply?.technician ? ` · ${i.supply.technician}` : ''}{i.supply?.route ? ` · rota ${i.supply.route}` : ''}{i.openServiceOrder ? ' · já tem O.S.' : ''}
        </li>)}</ul>
        <small>{group.items?.some((i) => i.supply?.deliveryStatus || i.supply?.estimatedDeliveryAt) ? 'Status e prazo recebidos da telemetria; confirme antes do envio.' : 'Rota, prazo e status de entrega não integrados; confirme antes da O.S.'}</small>
        <div><button className="park-btn" disabled={!usable.length || !canManage} onClick={() => setSelected((prev) => {
          const next = { ...prev }; usable.forEach((i) => { if (allSelected) delete next[i.id]; else next[i.id] = i; }); return next;
        })}>{allSelected ? 'Limpar seleção' : 'Selecionar itens'}</button>
        <button className="park-btn primary" disabled={!usable.length || !canManage} onClick={() => onOs(usable)}>Gerar 1 O.S.</button></div>
      </div>;
    })}
  </aside>;
}

function Modal({ title, eyebrow, onClose, children, footer }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.querySelector('button, input, select, textarea')?.focus();
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [onClose]);
  return <div className="park-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section ref={dialogRef} className="park-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><small>{eyebrow}</small><h2>{title}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={19} /></button></header>
      <div className="park-modal-body">{children}</div>{footer && <footer>{footer}</footer>}
    </section>
  </div>;
}

function MonitorDialog({ item, users, busy, onClose, onSave }) {
  const [form, setForm] = useState({ until: tomorrowAtTen(), assignedToId: item.workflow?.assignedTo?.id || '', condition: item.workflow?.monitoringCondition || 'Escalar se o nível cair novamente ou não houver nova leitura.', note: item.workflow?.nextStep || '' });
  return <Modal eyebrow="Decisão assistida" title="Monitorar com compromisso" onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || !form.until || !form.condition.trim()} onClick={() => onSave(form)}>Salvar monitoramento</button></>}>
    <p>Monitorar não resolve nem arquiva. A ocorrência fica em “Em monitoramento”, o responsável definido é avisado e ela volta automaticamente para decisão ao vencer o prazo.</p>
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

function OpenOrdersDialog({ item, onClose }) {
  const orders = item.openServiceOrders?.length ? item.openServiceOrders : (item.openServiceOrder ? [item.openServiceOrder] : []);
  const openPdf = (o) => window.open(`${BACKEND_URL}/api/os/${encodeURIComponent(o.number || o.id)}/pdf?token=${localStorage.getItem('token')}`, '_blank', 'noopener,noreferrer');
  return (
    <Modal eyebrow="Atenção" title="Este equipamento já tem O.S. em aberto" onClose={onClose}
      footer={<button className="park-btn primary" onClick={onClose}>Fechar</button>}>
      <p>{item.equipment?.model || 'Equipamento'} · {item.serialNumber || 'sem série'} — evite duplicar o atendimento. Revise as O.S. abertas antes de abrir uma nova.</p>
      <div className="park-timeline">
        {orders.map((o) => (
          <div key={o.id}>
            <b>O.S. {o.number || o.id}</b>
            <span>{o.createdAt ? fmtDate(o.createdAt, false) : ''}</span>
            <p>{[o.status, o.defect].filter(Boolean).join(' · ') || 'Sem descrição'}</p>
            <button className="park-btn" style={{ marginTop: 6 }} onClick={() => openPdf(o)}>
              <ExternalLink size={13} /> Revisar esta O.S.
            </button>
          </div>
        ))}
        {orders.length === 0 && <p>Não foi possível listar as O.S. abertas — confira no iLux.</p>}
      </div>
    </Modal>
  );
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
  return <Modal eyebrow="Visão consolidada" title="Timeline do equipamento" onClose={onClose} footer={<button className="park-btn" onClick={onClose}>Fechar</button>}>
    {!data ? <div className="park-loading"><Loader2 className="spin" /> Carregando…</div> : <div className="park-timeline">{(data.events || data.timeline || []).length === 0 && <p>Sem eventos no período.</p>}{(data.events || data.timeline || []).map((e, idx) => <div key={e.id || idx}><b title={`Código PrintGuard: ${e.eventType || e.type || 'Evento'}`}>{eventLabel(e.eventType || e.type || 'Evento')}</b><span>{fmtDate(e.occurredAt || e.createdAt)}</span><p>{e.description || e.status || e.state}</p></div>)}</div>}
  </Modal>;
}

function AssignDialog({ item, users, busy, onClose, onDone }) {
  const [form, setForm] = useState({ assignedToId: item.workflow?.assignedTo?.id || '', decisionDueAt: '', nextStep: item.workflow?.nextStep || '' });
  async function save() {
    try {
      await assignParkIncident(item.id, {
        ...form,
        decisionDueAt: form.decisionDueAt ? new Date(form.decisionDueAt).toISOString() : null,
        context: incidentContext(item),
      });
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Falha ao atribuir ocorrência.'); }
  }
  return <Modal eyebrow="Responsabilidade" title="Atribuir decisão" onClose={onClose} footer={<><button className="park-btn" onClick={onClose}>Cancelar</button><button className="park-btn primary" disabled={busy || !form.assignedToId} onClick={save}>Salvar e avisar</button></>}>
    <p>O responsável recebe um aviso no chat interno e a ocorrência entra na “Minha fila” dele. Atribuir não abre O.S., não contata o cliente e não encerra o alerta.</p>
    <label>Responsável<select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}><option value="">Selecione…</option>{users.map((u) => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
    <label>Prazo da decisão<input type="datetime-local" value={form.decisionDueAt} onChange={(e) => setForm({ ...form, decisionDueAt: e.target.value })} /></label>
    <label>Próximo passo<textarea value={form.nextStep} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} placeholder="O que essa pessoa precisa fazer?" /></label>
  </Modal>;
}
