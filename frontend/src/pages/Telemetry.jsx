import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Filter,
  MonitorCog,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import api, {
  approveTelemetryEvent,
  getTelemetryQueue,
  ignoreTelemetryEvent,
  monitorTelemetryEvent,
} from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import EmptyState from '../components/ui/EmptyState';

const PAGE_SIZE = 40;
const EMPTY_FILTERS = { q: '', severity: '', status: '', type: '', from: '', to: '' };

const STATUS_LABELS = {
  OPEN: 'Aberto',
  NEW: 'Novo',
  MONITORING: 'Monitorando',
  IGNORED: 'Ignorado',
  APPROVED: 'Aprovado',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
  RECEIVED: 'Recebido',
  ERROR: 'Erro',
};
const SEVERITY_LABELS = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Médio', LOW: 'Baixo', INFO: 'Informativo' };

function unwrap(value) {
  if (!value || typeof value !== 'object') return {};
  return value.data && typeof value.data === 'object' ? value.data : value;
}

function normalizePayload(value) {
  const payload = unwrap(value);
  const events = Array.isArray(payload.events) ? payload.events : Array.isArray(payload.items) ? payload.items : Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.data) ? payload.data : [];
  const pagination = payload.pagination || {};
  const page = Number(pagination.page ?? payload.page ?? 1) || 1;
  const limit = Number(pagination.pageSize ?? pagination.limit ?? payload.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const total = Number(pagination.total ?? payload.total ?? events.length) || 0;
  const totalPages = Number(pagination.totalPages ?? payload.totalPages) || Math.max(1, Math.ceil(total / limit));
  return {
    events,
    pagination: { page, limit, total, totalPages, hasPrevious: pagination.hasPrevious ?? page > 1, hasNext: pagination.hasNext ?? payload.hasMore ?? page < totalPages },
    summary: payload.summary || {},
  };
}

function normalizeEvent(event) {
  return {
    ...event,
    type: event.type || event.eventType || event.kind || 'EVENT',
    severity: String(event.severity || event.priority || 'INFO').toUpperCase(),
    status: String(event.status || 'OPEN').toUpperCase(),
    customer: event.customer || event.client || event.customerName || event.contact || null,
    equipment: event.equipment || event.device || event.printer || null,
    measurement: event.measurement || event.reading || event.metric || null,
    meter: event.meter || event.currentMeter || null,
  };
}

function displayCustomer(value) {
  if (!value) return 'Cliente não informado';
  if (typeof value === 'string') return value;
  return value.name || value.companyName || value.document || value.id || 'Cliente não informado';
}

function displayEquipment(value) {
  if (!value) return 'Equipamento não informado';
  if (typeof value === 'string') return value;
  return value.name || value.model || value.serial || value.serialNumber || value.id || 'Equipamento não informado';
}

function displayMeasurement(value) {
  if (value === null || value === undefined || value === '') return 'Sem leitura registrada';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return Object.entries(value).slice(0, 4).map(([key, item]) => `${key}: ${item}`).join(' · ');
}

function displayMeter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const parts = [];
  if (value.pageCounter !== null && value.pageCounter !== undefined) {
    parts.push(`Contador: ${Number(value.pageCounter).toLocaleString('pt-BR')}`);
  }
  const counters = value.usageCounters || value.usage_counters;
  if (counters && typeof counters === 'object' && !Array.isArray(counters)) {
    Object.entries(counters).slice(0, 3).forEach(([key, counter]) => {
      const number = Number(counter);
      parts.push(`${labelize(key)}: ${Number.isFinite(number) ? number.toLocaleString('pt-BR') : String(counter)}`);
    });
  }
  return parts.join(' · ');
}

function mappingText(event) {
  return event.mappingMessage || (event.mappingState === 'MATCHED'
    ? 'Cliente e equipamento identificados no iLux.'
    : 'Cliente ou equipamento ainda não identificado no iLux.');
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

function labelize(value) {
  return String(value || '—').toLowerCase().replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function toneForSeverity(value) {
  if (['CRITICAL', 'HIGH'].includes(value)) return 'danger';
  if (value === 'MEDIUM') return 'warning';
  return 'neutral';
}

function toneForStatus(value) {
  if (['RESOLVED', 'CLOSED', 'APPROVED'].includes(value)) return 'success';
  if (['IGNORED'].includes(value)) return 'muted';
  if (value === 'ERROR') return 'danger';
  if (['MONITORING', 'OPEN', 'NEW'].includes(value)) return 'warning';
  return 'neutral';
}

export default function Telemetry() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [working, setWorking] = useState('');
  const [notice, setNotice] = useState('');
  const [osTypes, setOsTypes] = useState([]);
  const [approval, setApproval] = useState({ cdOstp: '', defect: '' });

  useEffect(() => {
    let active = true;
    api.get('/os/types')
      .then((response) => { if (active) setOsTypes(Array.isArray(response.data) ? response.data : []); })
      .catch(() => { if (active) setOsTypes([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setApproval({ cdOstp: '', defect: selected.message || selected.description || '' });
  }, [selected?.id, selected?.eventId]);

  const load = useCallback(async (targetPage = page, signal) => {
    setLoading(true);
    setError('');
    // The API accepts offset/limit while newer deployments also understand
    // page/pageSize. Sending both keeps the screen compatible during a
    // rolling deploy and makes the offset deterministic for older agents.
    const params = {
      page: targetPage,
      pageSize: PAGE_SIZE,
      limit: PAGE_SIZE,
      offset: Math.max(0, (targetPage - 1) * PAGE_SIZE),
    };
    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (!String(value || '').trim()) return;
      if (key === 'q') {
        params.q = String(value).trim();
        params.search = params.q;
      }
      else if (key === 'type') params.type = String(value).trim();
      else if (key === 'from') params.from = `${value}T00:00:00.000Z`;
      else if (key === 'to') params.to = `${value}T23:59:59.999Z`;
      else params[key] = String(value).trim();
    });
    try {
      const response = await getTelemetryQueue(params, signal);
      setData(normalizePayload(response?.data));
    } catch (requestError) {
      if (requestError?.code === 'ERR_CANCELED' || requestError?.name === 'CanceledError') return;
      setData(null);
      setError(requestError?.response?.data?.error || 'Não foi possível carregar a fila de telemetria.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [appliedFilters, page]);

  useEffect(() => {
    const controller = new AbortController();
    load(page, controller.signal);
    return () => controller.abort();
  }, [load, page]);

  function applyFilters(event) {
    event?.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  }
  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
  }

  async function runAction(action, event) {
    const id = event?.id || event?.eventId;
    if (!id) return;
    setWorking(`${action}:${id}`);
    setError('');
    try {
      if (action === 'ignore') await ignoreTelemetryEvent(id);
      if (action === 'monitor') await monitorTelemetryEvent(id);
      if (action === 'approve') {
        if (!approval.cdOstp) throw new Error('Selecione o tipo de O.S. antes de aprovar.');
        await approveTelemetryEvent(id, { cdOstp: approval.cdOstp, defect: approval.defect });
      }
      setNotice(action === 'ignore' ? 'Evento ignorado.' : action === 'monitor' ? 'Evento mantido em acompanhamento nesta fila. Nenhuma O.S. ou mensagem foi criada.' : 'Evento aprovado; a abertura da O.S. foi solicitada.');
      setSelected(null);
      await load(page);
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Não foi possível concluir esta ação.');
    } finally {
      setWorking('');
    }
  }

  const rows = (data?.events || []).map(normalizeEvent);
  const pagination = data?.pagination || { page, total: 0, totalPages: 1, hasPrevious: false, hasNext: false };
  const summary = data?.summary || {};
  const stats = useMemo(() => ({
    total: Number(summary.total ?? pagination.total ?? rows.length) || 0,
    critical: Number(summary.critical ?? rows.filter((item) => item.severity === 'CRITICAL').length) || 0,
    open: Number(summary.open ?? summary.pending ?? rows.filter((item) => ['OPEN', 'NEW'].includes(item.status)).length) || 0,
    monitoring: Number(summary.monitoring ?? rows.filter((item) => item.status === 'MONITORING').length) || 0,
  }), [pagination.total, rows, summary]);

  return (
    <main className="telemetry-page" style={styles.page}>
      <style>{responsiveCss}</style>
      <PageHeader
        kicker="Operação"
        title="Telemetria"
        subtitle="Acompanhe sinais do parque, priorize ocorrências e decida quando monitorar ou abrir uma O.S."
        actions={<ActionButton variant="secondary" onClick={() => load(page)} loading={loading}><RefreshCw size={16} /> Atualizar</ActionButton>}
      />

      {error ? <div style={styles.error} role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => load(page)} style={styles.retry}>Tentar novamente</button></div> : null}
      {notice ? <div style={styles.notice} role="status"><CheckCircle2 size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} style={styles.closeNotice} aria-label="Fechar aviso"><X size={15} /></button></div> : null}

      <section style={styles.statGrid} className="telemetry-stat-grid" aria-label="Resumo da telemetria">
        <Stat icon={<Activity size={19} />} label="Eventos no filtro" value={stats.total} />
        <Stat icon={<ShieldAlert size={19} />} label="Críticos" value={stats.critical} tone="danger" />
        <Stat icon={<Clock3 size={19} />} label="Aguardando decisão" value={stats.open} tone="warning" />
        <Stat icon={<MonitorCog size={19} />} label="Em monitoramento" value={stats.monitoring} tone="success" />
      </section>

      <section style={styles.card} aria-labelledby="telemetry-filter-title">
        <div style={styles.sectionHeading}><div><h2 id="telemetry-filter-title" style={styles.cardTitle}><Filter size={18} /> Filtros da fila</h2><p style={styles.subtitleSmall}>Use os filtros para encontrar rapidamente uma ocorrência específica.</p></div><button type="button" style={styles.clearButton} onClick={clearFilters}>Limpar filtros</button></div>
        <form onSubmit={applyFilters} style={styles.filtersGrid} className="telemetry-filters-grid">
          <label style={styles.field}><span>Buscar</span><div style={styles.inputIcon}><Search size={16} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Cliente, equipamento ou série..." /></div></label>
          <label style={styles.field}><span>Tipo de evento</span><input value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))} placeholder="Ex.: toner_low, offline" /></label>
          <label style={styles.field}><span>Severidade</span><select value={filters.severity} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value }))}><option value="">Todas</option>{Object.entries(SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label style={styles.field}><span>Status</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label style={styles.field}><span>De</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
          <label style={styles.field}><span>Até</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
          <div style={styles.filterAction}><ActionButton type="submit" loading={loading && !data}><Search size={16} /> Aplicar</ActionButton></div>
        </form>
      </section>

      <section style={styles.card} aria-labelledby="telemetry-queue-title">
        <div style={styles.tableHeading}><div><h2 id="telemetry-queue-title" style={styles.cardTitle}><Activity size={18} /> Fila operacional</h2><p style={styles.subtitleSmall}>{pagination.total ? `${pagination.total.toLocaleString('pt-BR')} eventos encontrados` : 'Eventos recentes do PrintGuard'}</p></div><span style={styles.note}>Atualização sob demanda</span></div>
        {loading && !data ? <div style={styles.loading}><RefreshCw size={18} className="spin" /> Carregando telemetria…</div> : rows.length === 0 ? <EmptyState icon={<Activity size={28} />} title="Nenhum evento na fila" description="Quando o PrintGuard enviar um sinal, ele aparecerá aqui para triagem." /> : <div style={styles.tableWrap} className="telemetry-table-wrap"><table style={styles.table} className="telemetry-table"><thead><tr><th style={styles.th}>Evento</th><th style={styles.th}>Cliente / equipamento</th><th style={styles.th}>Leitura</th><th style={styles.th}>Severidade</th><th style={styles.th}>Status</th><th style={{ ...styles.th, textAlign: 'right' }}>Ações</th></tr></thead><tbody>{rows.map((event) => { const severityTone = toneForSeverity(event.severity); const statusTone = toneForStatus(event.status); const eventId = event.id || event.eventId; const meterLabel = displayMeter(event.meter); return <tr key={eventId || `${event.createdAt}-${event.type}`}><td style={styles.td}><strong>{labelize(event.type)}</strong><small style={styles.muted}>{dateLabel(event.createdAt || event.timestamp)}</small></td><td style={styles.td}><strong>{displayCustomer(event.customer)}</strong><small style={styles.muted}>{displayEquipment(event.equipment)}</small></td><td style={styles.td}><span style={styles.measurement}>{displayMeasurement(event.measurement)}</span>{meterLabel ? <small style={styles.meterInline}>{meterLabel}</small> : null}</td><td style={styles.td}><span style={{ ...styles.badge, ...(styles[`${severityTone}Badge`] || {}) }}>{SEVERITY_LABELS[event.severity] || labelize(event.severity)}</span></td><td style={styles.td}><span style={{ ...styles.badge, ...(styles[`${statusTone}Badge`] || {}) }}>{STATUS_LABELS[event.status] || labelize(event.status)}</span></td><td style={{ ...styles.td, textAlign: 'right' }}><button type="button" style={styles.detailButton} onClick={() => setSelected(event)}><Eye size={15} /> Detalhes</button></td></tr>; })}</tbody></table></div>}
        <div style={styles.pagination}><span>{pagination.total ? `Página ${pagination.page} de ${pagination.totalPages}` : 'Página 1'}</span><div style={styles.paginationActions}><button type="button" style={styles.pageButton} disabled={loading || !pagination.hasPrevious} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /> Anterior</button><button type="button" style={styles.pageButton} disabled={loading || !pagination.hasNext} onClick={() => setPage((current) => current + 1)}>Próxima <ChevronRight size={16} /></button></div></div>
      </section>

      {selected ? <TelemetryDetails event={selected} working={working} onAction={runAction} onClose={() => setSelected(null)} osTypes={osTypes} approval={approval} onApprovalChange={setApproval} /> : null}
    </main>
  );
}

function Stat({ icon, label, value, tone = 'default' }) { return <div style={styles.statCard}><span style={{ ...styles.statIcon, ...(styles[`${tone}Icon`] || {}) }}>{icon}</span><span style={styles.statBody}><small>{label}</small><strong>{Number(value || 0).toLocaleString('pt-BR')}</strong></span></div>; }

function TelemetryDetails({ event, working, onAction, onClose, osTypes, approval, onApprovalChange }) {
  const id = event?.id || event?.eventId;
  const severityTone = toneForSeverity(event.severity);
  const statusTone = toneForStatus(event.status);
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
  return (
    <aside style={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="telemetry-detail-title">
      <header style={styles.drawerHeader}>
        <div><p style={styles.kicker}>Detalhe da ocorrência</p><h2 id="telemetry-detail-title" style={styles.drawerTitle}>{labelize(event.type)}</h2><span style={styles.drawerDate}>{dateLabel(event.createdAt || event.timestamp)}</span></div>
        <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Fechar"><X size={18} /></button>
      </header>
      <div style={styles.drawerBody}>
        <div style={styles.badgeRow}><span style={{ ...styles.badge, ...(styles[`${severityTone}Badge`] || {}) }}>{SEVERITY_LABELS[event.severity] || labelize(event.severity)}</span><span style={{ ...styles.badge, ...(styles[`${statusTone}Badge`] || {}) }}>{STATUS_LABELS[event.status] || labelize(event.status)}</span></div>
        <Detail label="Cliente" value={displayCustomer(event.customer)} />
        <Detail label="Equipamento" value={displayEquipment(event.equipment)} />
        <Detail label="Leitura" value={displayMeasurement(event.measurement)} />
        {displayMeter(event.meter) ? <Detail label="Contador atual" value={displayMeter(event.meter)} /> : null}
        <div style={event.mappingState === 'MATCHED' ? styles.mappingOk : styles.messageBox}>{mappingText(event)}</div>
        {event.message || event.description ? <div style={styles.messageBox}>{event.message || event.description}</div> : null}
        {metadata ? <details style={styles.meta}><summary>Contexto técnico</summary><pre>{JSON.stringify(metadata, null, 2)}</pre></details> : null}
        <section style={styles.approvalBox}>
          <strong>Abertura de O.S. no iLux</strong>
          <label style={styles.field}><span>Tipo de O.S. obrigatório</span><select value={approval.cdOstp} onChange={(changeEvent) => onApprovalChange((current) => ({ ...current, cdOstp: changeEvent.target.value }))}><option value="">Selecione...</option>{osTypes.map((type) => <option key={type.code} value={type.code}>{type.name} ({type.code})</option>)}</select></label>
          <label style={styles.field}><span>Defeito / motivo</span><textarea style={styles.textarea} value={approval.defect} onChange={(changeEvent) => onApprovalChange((current) => ({ ...current, defect: changeEvent.target.value }))} placeholder="Se vazio, será usada a descrição da telemetria." /></label>
        </section>
        <div style={styles.monitorHelp}><MonitorCog size={16} /><span><strong>Monitorar:</strong> mantém esta ocorrência em acompanhamento na própria fila, sem abrir O.S. e sem enviar mensagem. As próximas leituras continuam sendo coletadas pelo PrintGuard.</span></div>
      </div>
      <footer style={styles.drawerFooter}>
        <button type="button" style={styles.drawerAction} onClick={() => onAction('ignore', event)} disabled={!id || Boolean(working)}><XCircle size={15} /> Ignorar</button>
        <button type="button" style={styles.drawerAction} title="Manter em acompanhamento nesta fila, sem abrir O.S." onClick={() => onAction('monitor', event)} disabled={!id || Boolean(working)}><MonitorCog size={15} /> Monitorar</button>
        <ActionButton onClick={() => onAction('approve', event)} loading={working === `approve:${id}`} disabled={!id || event.canOpenServiceOrder === false || !approval.cdOstp || Boolean(working && working !== `approve:${id}`)}><Check size={15} /> Aprovar / abrir O.S.</ActionButton>
      </footer>
    </aside>
  );
}

function Detail({ label, value }) { return <div style={styles.detail}><span>{label}</span><strong title={value}>{value}</strong></div>; }

const responsiveCss = `
  .telemetry-page input, .telemetry-page select { min-height: 40px; width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0 .7rem; background: var(--bg-surface); color: var(--text-main); font: inherit; }
  .telemetry-page input:focus-visible, .telemetry-page select:focus-visible, .telemetry-page button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .telemetry-page .input-icon input { border: 0; padding: 0; outline: 0; background: transparent; }
  .telemetry-page .spin { animation: telemetry-spin .8s linear infinite; }
  @keyframes telemetry-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @media (max-width: 900px) { .telemetry-filters-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } .telemetry-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
  @media (max-width: 620px) { .telemetry-page { padding: 1rem !important; } .telemetry-filters-grid, .telemetry-stat-grid { grid-template-columns: 1fr !important; } .telemetry-table-wrap { overflow-x: auto; } .telemetry-table { min-width: 900px; } .telemetry-drawer { width: 100% !important; } }
`;

const styles = {
  page: { flex: 1, minWidth: 0, overflowY: 'auto', padding: 'var(--space-8)', background: 'var(--bg-base)', color: 'var(--text-main)' },
  header: { marginBottom: 'var(--space-6)' },
  kicker: { margin: '0 0 .4rem', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' },
  title: { margin: 0, color: 'var(--text-main)', fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 850 },
  subtitle: { margin: '.45rem 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-md)', lineHeight: 1.5 },
  subtitleSmall: { margin: '.35rem 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  error: { display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: 'var(--space-4)', padding: '.75rem 1rem', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-light)', color: 'var(--danger-text)' },
  retry: { marginLeft: 'auto', border: '1px solid currentColor', borderRadius: 'var(--radius-sm)', padding: '.4rem .6rem', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 },
  notice: { display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: 'var(--space-4)', padding: '.75rem 1rem', border: '1px solid var(--success-border, var(--border-color))', borderRadius: 'var(--radius-md)', background: 'var(--success-light)', color: 'var(--success-text, var(--success))' },
  closeNotice: { display: 'grid', placeItems: 'center', marginLeft: 'auto', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' },
  statCard: { display: 'flex', alignItems: 'center', gap: '.7rem', minWidth: 0, padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)' },
  statIcon: { display: 'grid', placeItems: 'center', width: 40, height: 40, flexShrink: 0, borderRadius: 'var(--radius-md)', color: 'var(--accent)', background: 'var(--accent-light)' },
  dangerIcon: { color: 'var(--danger-text, var(--danger))', background: 'var(--danger-light)' }, warningIcon: { color: 'var(--warning-text, var(--warning))', background: 'var(--warning-light)' }, successIcon: { color: 'var(--success-text, var(--success))', background: 'var(--success-light)' },
  statBody: { display: 'grid', gap: '.25rem', minWidth: 0 },
  card: { minWidth: 0, padding: 'var(--space-5)', marginBottom: 'var(--space-5)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow-xs)' },
  sectionHeading: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }, tableHeading: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: 'var(--space-4)', flexWrap: 'wrap' },
  cardTitle: { display: 'flex', alignItems: 'center', gap: '.45rem', margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-lg)', fontWeight: 800 },
  clearButton: { border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 }, note: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  filtersGrid: { display: 'grid', gridTemplateColumns: 'minmax(14rem, 1.7fr) minmax(12rem, 1.2fr) repeat(2, minmax(9rem, 1fr)) repeat(2, minmax(8rem, .75fr)) auto', alignItems: 'end', gap: 'var(--space-3)' },
  field: { display: 'grid', gap: '.4rem', minWidth: 0, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800 }, inputIcon: { display: 'flex', alignItems: 'center', gap: '.45rem', minWidth: 0, padding: '0 .7rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-muted)' }, filterAction: { display: 'flex', justifyContent: 'flex-end' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }, table: { width: '100%', borderCollapse: 'collapse', minWidth: 850 }, th: { padding: '.7rem .8rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 800, whiteSpace: 'nowrap' }, td: { padding: '.8rem .8rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: 'var(--text-sm)', verticalAlign: 'middle' }, muted: { display: 'block', marginTop: '.2rem', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' }, measurement: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }, meterInline: { display: 'block', marginTop: '.28rem', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }, badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '.28rem .5rem', fontSize: 'var(--text-xs)', fontWeight: 800, whiteSpace: 'nowrap' }, successBadge: { color: 'var(--success-text, var(--success))', background: 'var(--success-light)' }, dangerBadge: { color: 'var(--danger-text, var(--danger))', background: 'var(--danger-light)' }, warningBadge: { color: 'var(--warning-text, var(--warning))', background: 'var(--warning-light)' }, mutedBadge: { color: 'var(--text-muted)', background: 'var(--bg-surface)' }, neutralBadge: { color: 'var(--text-muted)', background: 'var(--bg-surface)' }, detailButton: { display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.45rem .6rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-main)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 }, loading: { minHeight: '15rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '.5rem', color: 'var(--text-muted)', fontWeight: 700 }, pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }, paginationActions: { display: 'flex', gap: '.45rem' }, pageButton: { display: 'inline-flex', alignItems: 'center', gap: '.25rem', minHeight: 36, padding: '.4rem .6rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 },
  drawer: { position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', width: 'min(32rem, 100%)', borderLeft: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-main)', boxShadow: '-18px 0 45px rgba(0,0,0,.22)' }, drawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: 'var(--space-5)', borderBottom: '1px solid var(--border-color)' }, drawerTitle: { margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-xl)', fontWeight: 800 }, drawerDate: { display: 'block', marginTop: '.35rem', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }, closeButton: { display: 'grid', placeItems: 'center', width: 36, height: 36, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }, drawerBody: { flex: 1, overflowY: 'auto', padding: 'var(--space-5)' }, badgeRow: { display: 'flex', gap: '.45rem', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }, detail: { display: 'grid', gap: '.3rem', padding: '.75rem 0', borderBottom: '1px solid var(--border-color)' }, messageBox: { marginTop: 'var(--space-4)', padding: '.8rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }, mappingOk: { marginTop: 'var(--space-4)', padding: '.8rem', border: '1px solid var(--success-border, var(--border-color))', borderRadius: 'var(--radius-md)', background: 'var(--success-light)', color: 'var(--success-text, var(--success))', fontSize: 'var(--text-sm)', lineHeight: 1.5 }, monitorHelp: { display: 'flex', alignItems: 'flex-start', gap: '.55rem', marginTop: 'var(--space-4)', padding: '.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }, meta: { marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }, approvalBox: { display: 'grid', gap: '.8rem', marginTop: 'var(--space-5)', padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)' }, textarea: { width: '100%', minHeight: 92, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '.7rem', background: 'var(--bg-panel)', color: 'var(--text-main)', font: 'inherit' }, drawerFooter: { display: 'flex', alignItems: 'center', gap: '.5rem', padding: 'var(--space-4) var(--space-5)', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap' }, drawerAction: { display: 'inline-flex', alignItems: 'center', gap: '.35rem', minHeight: 38, padding: '.45rem .65rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 },
};
