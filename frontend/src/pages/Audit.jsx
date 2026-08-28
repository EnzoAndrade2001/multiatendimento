import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Eye,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { getAuditEvents } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import EmptyState from '../components/ui/EmptyState';

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
  q: '',
  actorId: '',
  action: '',
  resourceType: '',
  status: '',
  from: '',
  to: '',
};

const STATUS_LABELS = {
  SUCCESS: 'Sucesso',
  FAILED: 'Falhou',
  DENIED: 'Negado',
  DENIED_OR_FAILED: 'Negado/falhou',
  PENDING: 'Pendente',
  COMPLETED_WITH_WARNINGS: 'Concluído com avisos',
};

const SENSITIVE_KEY = /token|secret|password|senha|authorization|cookie|api.?key|credential|chave/i;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(payload) {
  const events = normalizeList(payload?.events || payload?.rows || payload?.logs || payload?.data);
  const rawPagination = payload?.pagination || {};
  const page = Number(rawPagination.page ?? payload?.page ?? 1) || 1;
  const limit = Number(rawPagination.limit ?? rawPagination.pageSize ?? payload?.limit ?? payload?.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const total = Number(rawPagination.total ?? payload?.total ?? events.length) || 0;
  const totalPages = Number(rawPagination.totalPages ?? payload?.totalPages) || Math.max(1, Math.ceil(total / limit));
  const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
  const actors = normalizeList(payload?.filters?.actors || payload?.actors || payload?.users);
  const actions = normalizeList(payload?.filters?.actions || payload?.actions);
  const resources = normalizeList(payload?.filters?.resourceTypes || payload?.resourceTypes);
  return {
    events,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasPrevious: rawPagination.hasPrevious ?? page > 1,
      hasNext: rawPagination.hasNext ?? page < totalPages,
    },
    summary,
    actors,
    actions,
    resources,
  };
}

function actorName(event) {
  const actor = event?.actor || event?.user;
  return actor?.name || actor?.email || event?.actorName || event?.userName || (event?.actorId ? `Usuário ${String(event.actorId).slice(0, 8)}` : 'Sistema');
}

function actorMeta(event) {
  const actor = event?.actor || event?.user;
  return actor?.email || event?.actorEmail || (event?.actorId ? String(event.actorId).slice(0, 12) : 'Automação');
}

function labelize(value) {
  if (!value) return '—';
  return String(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeMetadata(value, depth = 0) {
  if (depth > 4) return '[conteúdo ocultado]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' ? value.slice(0, 1000) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeMetadata(item, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value).slice(0, 80).reduce((result, [key, item]) => {
      result[key] = SENSITIVE_KEY.test(key) ? '[ocultado]' : safeMetadata(item, depth + 1);
      return result;
    }, {});
  }
  return String(value).slice(0, 1000);
}

function statusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (['SUCCESS', 'COMPLETED'].includes(normalized)) return 'success';
  if (['FAILED', 'DENIED', 'DENIED_OR_FAILED'].includes(normalized)) return 'danger';
  if (['PENDING', 'PROCESSING'].includes(normalized)) return 'warning';
  return 'neutral';
}

function optionValue(item) {
  if (typeof item === 'string') return { value: item, label: labelize(item) };
  return {
    value: item?.id || item?.value || item?.key || item?.name || '',
    label: item?.label || item?.name || item?.email || labelize(item?.value || item?.key || item?.id),
  };
}

export default function Audit() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (targetPage = page, signal) => {
    setLoading(true);
    setError('');
    const params = { page: targetPage, pageSize: PAGE_SIZE };
    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (!String(value || '').trim()) return;
      if (key === 'from') params.from = `${value}T00:00:00.000Z`;
      else if (key === 'to') params.to = `${value}T23:59:59.999Z`;
      else if (key === 'q') params.search = String(value).trim();
      else if (key === 'actorId') params.userId = String(value).trim();
      else if (key === 'resourceType') params.entityType = String(value).trim();
      else params[key] = String(value).trim();
    });
    try {
      const response = await getAuditEvents(params, signal);
      setData(normalizePayload(response?.data));
    } catch (requestError) {
      if (requestError?.code === 'ERR_CANCELED' || requestError?.name === 'CanceledError') return;
      setData(null);
      setError(requestError?.response?.data?.error || 'Não foi possível carregar a auditoria.');
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

  const rows = data?.events || [];
  const pagination = data?.pagination || { page, total: 0, totalPages: 1, hasPrevious: false, hasNext: false };
  const summary = data?.summary || {};
  const fallbackStats = useMemo(() => ({
    total: pagination.total || rows.length,
    success: rows.filter((event) => statusTone(event.status) === 'success').length,
    failed: rows.filter((event) => statusTone(event.status) === 'danger').length,
  }), [pagination.total, rows]);
  const stats = {
    total: Number(summary.total ?? summary.count ?? fallbackStats.total) || 0,
    success: Number(summary.success ?? summary.succeeded ?? summary.successful ?? fallbackStats.success) || 0,
    failed: Number(summary.failed ?? summary.errors ?? summary.denied ?? fallbackStats.failed) || 0,
  };
  const actors = data?.actors || [];
  const actions = data?.actions || [];
  const resources = data?.resources || [];

  return (
    <main style={s.page} className="audit-page">
      <style>{responsiveCss}</style>
      <PageHeader
        kicker="Segurança e conformidade"
        title="Auditoria do sistema"
        subtitle="Consulte as ações realizadas na empresa, com contexto suficiente para suporte, segurança e conformidade."
        actions={(
          <ActionButton variant="secondary" onClick={() => load(page)} loading={loading}>
            <RefreshCw size={16} /> Atualizar
          </ActionButton>
        )}
      />

      <section style={s.statGrid} className="audit-stat-grid" aria-label="Resumo da auditoria">
        <Stat icon={<Activity size={19} />} label="Eventos no filtro" value={stats.total} />
        <Stat icon={<CheckCircle2 size={19} />} label="Sucessos nesta página" value={stats.success} tone="success" />
        <Stat icon={<AlertCircle size={19} />} label="Falhas nesta página" value={stats.failed} tone="danger" />
        <Stat icon={<Clock3 size={19} />} label="Último evento" value={rows[0] ? formatDate(rows[0].createdAt || rows[0].timestamp) : '—'} compact />
      </section>

      <section style={s.card} aria-labelledby="audit-filters-title">
        <div style={s.sectionHeading}>
          <div>
            <h2 id="audit-filters-title" style={s.cardTitle}><Filter size={18} /> Filtros</h2>
            <p style={s.sectionSubtitle}>Refine por período, usuário, ação, recurso ou resultado.</p>
          </div>
          <button type="button" onClick={clearFilters} style={s.clearButton} disabled={loading && !data}>Limpar filtros</button>
        </div>
        <form onSubmit={applyFilters} style={s.filtersGrid} className="audit-filters-grid">
          <label style={s.field}><span>Buscar</span><div className="input-icon" style={s.inputIcon}><Search size={16} /><input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Ação, recurso ou ID..." /></div></label>
          <label style={s.field}><span>Usuário</span>{actors.length ? <div className="input-icon" style={s.inputIcon}><UserRound size={16} /><select value={filters.actorId} onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value }))}><option value="">Todos os usuários</option>{actors.map((actor) => { const option = optionValue(actor); return option.value ? <option key={option.value} value={option.value}>{option.label}</option> : null; })}</select></div> : <div className="input-icon" style={s.inputIcon}><UserRound size={16} /><input value={filters.actorId} onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value }))} placeholder="ID do usuário..." /></div>}</label>
          <label style={s.field}><span>Ação</span><input value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))} placeholder="Ex.: USER_UPDATE" /></label>
          <label style={s.field}><span>Recurso</span><input value={filters.resourceType} onChange={(event) => setFilters((current) => ({ ...current, resourceType: event.target.value }))} placeholder="Ex.: user, ticket..." /></label>
          <label style={s.field}><span>Status</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos os status</option><option value="SUCCESS">Sucesso</option><option value="FAILED">Falhou</option><option value="DENIED">Negado</option><option value="PENDING">Pendente</option></select></label>
          <label style={s.field}><span>De</span><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
          <label style={s.field}><span>Até</span><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
          <div style={s.filterActions}><ActionButton type="submit" loading={loading && !data}><Search size={16} /> Aplicar filtros</ActionButton></div>
        </form>
      </section>

      {error ? <div style={s.error} role="alert"><AlertCircle size={17} /> <span>{error}</span><button type="button" onClick={() => load(page)} style={s.retry}>Tentar novamente</button></div> : null}

      <section style={s.card} aria-labelledby="audit-events-title">
        <div style={s.tableHeading}>
          <div><h2 id="audit-events-title" style={s.cardTitle}><ShieldCheck size={18} /> Eventos registrados</h2><p style={s.sectionSubtitle}>{pagination.total ? `${pagination.total.toLocaleString('pt-BR')} eventos encontrados` : 'Ações recentes da empresa'}</p></div>
          <span style={s.privacyNote}>Segredos e credenciais são ocultados</span>
        </div>
        {loading && !data ? <div style={s.loading}><RefreshCw size={18} className="spin" /> Carregando eventos…</div> : rows.length === 0 ? <EmptyState icon={<Database size={28} />} title="Nenhum evento encontrado" description="Ajuste os filtros ou aguarde novas ações para consultar a auditoria." /> : (
          <div style={s.tableWrap} className="audit-table-wrap">
            <table style={s.table} className="audit-table">
              <thead><tr><th style={s.th}>Data e hora</th><th style={s.th}>Usuário</th><th style={s.th}>Ação</th><th style={s.th}>Recurso</th><th style={s.th}>Status</th><th style={{ ...s.th, textAlign: 'right' }}>Detalhes</th></tr></thead>
              <tbody>{rows.map((event) => {
                const tone = statusTone(event.status);
                return <tr key={event.id || `${event.createdAt}-${event.action}-${event.resourceId}`}>
                  <td style={s.td}><span style={s.dateCell}>{formatDate(event.createdAt || event.timestamp)}</span>{event.requestId ? <small style={s.muted}>ID {String(event.requestId).slice(0, 12)}</small> : null}</td>
                  <td style={s.td}><strong style={s.primary}>{actorName(event)}</strong><small style={s.muted}>{actorMeta(event)}</small></td>
                  <td style={s.td}><span style={s.actionText}>{labelize(event.action)}</span></td>
                  <td style={s.td}><span style={s.resourceText}>{labelize(event.resourceType)}</span>{event.resourceId ? <small style={s.muted}>#{String(event.resourceId).slice(0, 18)}</small> : null}</td>
                  <td style={s.td}><span style={{ ...s.status, ...(s[`${tone}Status`] || {}) }}>{STATUS_LABELS[String(event.status || '').toUpperCase()] || labelize(event.status || 'Desconhecido')}</span></td>
                  <td style={{ ...s.td, textAlign: 'right' }}><button type="button" style={s.detailButton} onClick={() => setSelected(event)}><Eye size={15} /> Ver detalhes</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <div style={s.pagination} aria-label="Paginação da auditoria">
          <span>{pagination.total ? `Página ${pagination.page} de ${pagination.totalPages}` : 'Página 1'}</span>
          <div style={s.paginationActions}><button type="button" style={s.pageButton} disabled={loading || !pagination.hasPrevious} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /> Anterior</button><button type="button" style={s.pageButton} disabled={loading || !pagination.hasNext} onClick={() => setPage((current) => current + 1)}>Próxima <ChevronRight size={16} /></button></div>
        </div>
      </section>

      {selected ? <AuditDetails event={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}

function Stat({ icon, label, value, tone = 'default', compact = false }) {
  return <div style={s.statCard}><div style={{ ...s.statIcon, ...(s[`${tone}Icon`] || {}) }}>{icon}</div><div style={s.statBody}><span style={s.statLabel}>{label}</span><strong style={{ ...s.statValue, ...(compact ? s.statCompact : {}), ...(s[`${tone}Value`] || {}) }}>{value}</strong></div></div>;
}

function AuditDetails({ event, onClose }) {
  const metadata = safeMetadata(event.metadata || event.details || {});
  return <div style={s.overlay} role="presentation" onMouseDown={(click) => { if (click.target === click.currentTarget) onClose(); }}><section style={s.modal} role="dialog" aria-modal="true" aria-labelledby="audit-details-title"><header style={s.modalHeader}><div><p style={s.modalKicker}>Registro de auditoria</p><h2 id="audit-details-title" style={s.modalTitle}>{labelize(event.action)}</h2></div><button type="button" onClick={onClose} style={s.closeButton} aria-label="Fechar"><X size={18} /></button></header><div style={s.detailGrid}><Detail label="Data e hora" value={formatDate(event.createdAt || event.timestamp)} /><Detail label="Usuário" value={actorName(event)} /><Detail label="Recurso" value={`${labelize(event.resourceType)}${event.resourceId ? ` · ${event.resourceId}` : ''}`} /><Detail label="Status" value={STATUS_LABELS[String(event.status || '').toUpperCase()] || labelize(event.status)} /><Detail label="Request ID" value={event.requestId || 'Não informado'} /><Detail label="IP" value={event.ipAddress || 'Não informado'} /></div><div style={s.metaSection}><h3 style={s.metaTitle}>Contexto da ação</h3><pre style={s.metadata}>{JSON.stringify(metadata, null, 2)}</pre></div><p style={s.modalHelp}>Dados sensíveis, credenciais e tokens não são exibidos neste painel.</p><footer style={s.modalFooter}><ActionButton variant="secondary" onClick={onClose}>Fechar</ActionButton></footer></section></div>;
}

function Detail({ label, value }) {
  return <div style={s.detailItem}><span>{label}</span><strong>{value}</strong></div>;
}

const responsiveCss = `
  .audit-page input, .audit-page select { min-height: 40px; width: 100%; min-width: 0; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0 .7rem; background: var(--bg-surface); color: var(--text-main); font: inherit; box-sizing: border-box; }
  .audit-page .audit-filters-grid .input-icon input { border: 0; padding: 0; outline: 0; background: transparent; }
  .audit-page .audit-filters-grid .input-icon select { border: 0; padding: 0; outline: 0; background: transparent; }
  .audit-page input:focus-visible, .audit-page select:focus-visible, .audit-page button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .audit-page .spin { animation: audit-spin .8s linear infinite; }
  @keyframes audit-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @media (max-width: 900px) { .audit-filters-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } .audit-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
  @media (max-width: 620px) { .audit-page { padding: var(--space-4) !important; } .audit-filters-grid, .audit-stat-grid { grid-template-columns: 1fr !important; } .audit-table-wrap { overflow-x: auto; } .audit-table { min-width: 780px; } }
`;

const s = {
  page: { flex: 1, minWidth: 0, overflowY: 'auto', padding: 'var(--space-8)', background: 'var(--bg-base)', color: 'var(--text-main)' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' },
  statCard: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', minWidth: 0 },
  statIcon: { display: 'grid', placeItems: 'center', width: 40, height: 40, flexShrink: 0, borderRadius: 'var(--radius-md)', color: 'var(--accent)', background: 'var(--accent-subtle)' },
  successIcon: { color: 'var(--success)', background: 'var(--success-light)' },
  dangerIcon: { color: 'var(--danger)', background: 'var(--danger-light)' },
  statBody: { minWidth: 0, display: 'grid', gap: 3 },
  statLabel: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 700 },
  statValue: { color: 'var(--text-main)', fontSize: '1.35rem', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statCompact: { fontSize: 'var(--text-sm)' },
  successValue: { color: 'var(--success-text, var(--success))' },
  dangerValue: { color: 'var(--danger-text, var(--danger))' },
  card: { padding: 'var(--space-5)', marginBottom: 'var(--space-5)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow-xs)' },
  sectionHeading: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' },
  tableHeading: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-lg)', fontWeight: 800 },
  sectionSubtitle: { margin: 'var(--space-2) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  clearButton: { border: 0, background: 'transparent', color: 'var(--text-muted)', padding: '.4rem', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 700 },
  filtersGrid: { display: 'grid', gridTemplateColumns: 'minmax(12rem, 1.6fr) repeat(4, minmax(9rem, 1fr)) repeat(2, minmax(9rem, .8fr)) auto', alignItems: 'end', gap: 'var(--space-3)' },
  field: { display: 'grid', gap: '.4rem', minWidth: 0, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 700 },
  inputIcon: { display: 'flex', alignItems: 'center', gap: '.4rem', minWidth: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0 .7rem', background: 'var(--bg-surface)' },
  fieldInput: { minHeight: 40 },
  filterActions: { display: 'flex', justifyContent: 'flex-end' },
  error: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-light)', color: 'var(--danger-text)' },
  retry: { marginLeft: 'auto', border: '1px solid currentColor', borderRadius: 'var(--radius-sm)', padding: '.45rem .65rem', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontWeight: 700, fontSize: 'var(--text-xs)' },
  privacyNote: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', minHeight: '16rem', color: 'var(--text-muted)', fontWeight: 700 },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 760 },
  th: { padding: '.75rem .85rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 800, whiteSpace: 'nowrap' },
  td: { padding: '.8rem .85rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: 'var(--text-sm)', verticalAlign: 'middle' },
  dateCell: { display: 'block', whiteSpace: 'nowrap', color: 'var(--text-main)' },
  primary: { display: 'block', fontSize: 'var(--text-sm)' },
  muted: { display: 'block', marginTop: '.25rem', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  actionText: { color: 'var(--text-main)', fontWeight: 700 },
  resourceText: { display: 'block', color: 'var(--text-muted)' },
  status: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '.28rem .55rem', fontSize: 'var(--text-xs)', fontWeight: 800, whiteSpace: 'nowrap' },
  successStatus: { color: 'var(--success-text, var(--success))', background: 'var(--success-light)' },
  dangerStatus: { color: 'var(--danger-text, var(--danger))', background: 'var(--danger-light)' },
  warningStatus: { color: 'var(--warning-text, var(--warning))', background: 'var(--warning-light)' },
  neutralStatus: { color: 'var(--text-muted)', background: 'var(--bg-surface)' },
  detailButton: { display: 'inline-flex', alignItems: 'center', gap: '.35rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '.45rem .6rem', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 700, whiteSpace: 'nowrap' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
  paginationActions: { display: 'flex', gap: 'var(--space-2)' },
  pageButton: { display: 'inline-flex', alignItems: 'center', gap: '.25rem', minHeight: 36, padding: '.45rem .7rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', font: 'inherit', fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, zIndex: 500, display: 'grid', placeItems: 'center', padding: 'var(--space-5)', background: 'rgba(2, 6, 23, .66)' },
  modal: { width: 'min(100%, 42rem)', maxHeight: 'min(90vh, 48rem)', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', color: 'var(--text-main)', boxShadow: 'var(--shadow-lg)' },
  modalHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', padding: 'var(--space-5)', borderBottom: '1px solid var(--border-color)' },
  modalKicker: { margin: '0 0 .35rem', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 'var(--text-xs)', fontWeight: 800 },
  modalTitle: { margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-xl)', fontWeight: 800 },
  closeButton: { display: 'grid', placeItems: 'center', width: 36, height: 36, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)', padding: 'var(--space-5)' },
  detailItem: { minWidth: 0, padding: '.7rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)' },
  metaSection: { padding: '0 var(--space-5)' },
  metaTitle: { margin: '0 0 var(--space-2)', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  metadata: { maxHeight: 240, overflow: 'auto', margin: 0, padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-base)', color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 'var(--text-xs)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  modalHelp: { margin: 'var(--space-4) var(--space-5) 0', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', padding: 'var(--space-5)', marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-color)' },
};
