import React, { useEffect, useState, useMemo, useRef } from 'react';
import { getBillingReports, triggerBillingProcess } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer
} from 'recharts';
import {
  BarChart2,
  CheckCircle2,
  PhoneOff,
  UserX,
  Users,
  Clock,
  Filter,
  Printer,
  Download,
  RefreshCw,
  Search,
  AlertTriangle,
  CalendarDays
} from 'lucide-react';

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

const STATUS_COLORS = {
  SUCCESS: '#16a34a',
  SKIPPED_OPTIN: '#d97706',
  SKIPPED_NOCONTACT: '#dc2626',
  FAILED: '#64748b',
  RECEIVED: '#16a34a',
  NOT_SENT: '#dc2626',
  NO_PHONE: '#dc2626',
  SKIPPED: '#d97706',
};

function compareSortValues(left, right) {
  if (left == null || left === '') return right == null || right === '' ? 0 : 1;
  if (right == null || right === '') return -1;

  const leftDate = left instanceof Date ? left.getTime() : Date.parse(left);
  const rightDate = right instanceof Date ? right.getTime() : Date.parse(right);
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;

  return String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function sortRows(rows, sortConfig, getValue) {
  if (!sortConfig?.key) return rows;
  const direction = sortConfig.direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => direction * compareSortValues(getValue(left, sortConfig.key), getValue(right, sortConfig.key)));
}

function coverageDetail(contact) {
  if (contact.status === 'RECEIVED' && contact.lastSentAt) {
    return `Enviado em ${new Date(contact.lastSentAt).toLocaleString('pt-BR')}`;
  }
  return contact.lastError || (contact.status === 'NO_PHONE' ? 'Contato sem telefone cadastrado.' : 'Nenhum envio concluído no período.');
}

function billingLogDetail(log) {
  if (log.status === 'SUCCESS') return 'Enviado para o WhatsApp com sucesso.';
  const raw = log.errorMessage || 'Falha sem mensagem detalhada.';
  if (/status code 400/i.test(raw)) {
    return 'WhatsApp recusou a solicitacao (HTTP 400). Verifique o telefone, a instancia e tente novamente.';
  }
  if (/status code 401|status code 403/i.test(raw)) {
    return 'A instancia recusou a autenticacao. Verifique a conexao do WhatsApp.';
  }
  return raw;
}

function billingLogCategory(log) {
  if (log.status === 'SUCCESS') return 'Enviado';
  if (log.status === 'SKIPPED' && log.errorMessage?.includes('Opt-in')) return 'Sem opt-in';
  if (log.status === 'SKIPPED') return 'Sem telefone';
  if (/status code 400/i.test(log.errorMessage || '')) return 'Falha tecnica - HTTP 400';
  return 'Falha tecnica';
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function formatDateOnly(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function normalizeReportPayload(payload) {
  return {
    stats: payload?.stats && typeof payload.stats === 'object' ? payload.stats : null,
    logs: Array.isArray(payload?.logs) ? payload.logs : [],
    coverageAnalysis: Array.isArray(payload?.coverageAnalysis) ? payload.coverageAnalysis : [],
    coverageSummary: payload?.coverageSummary && typeof payload.coverageSummary === 'object'
      ? payload.coverageSummary
      : null,
  };
}

function SortableHeader({ label, scope, sortKey, sortConfig, onSort }) {
  const active = sortConfig?.key === sortKey;
  const direction = active ? sortConfig.direction : null;
  return (
    <th style={s.th} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="table-sort-button" style={s.tableSortButton} onClick={() => onSort(scope, sortKey)}>
        <span>{label}</span>
        <span className="sort-indicator" aria-hidden="true">{active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

export default function BillingReports() {
  const [period, setPeriod] = useState('today');
  const [customRange, setCustomRange] = useState(null);
  const [customRangeDraft, setCustomRangeDraft] = useState({ startDate: '', endDate: '' });
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ stats: null, logs: [], coverageAnalysis: [], coverageSummary: null });
  const [filterType, setFilterType] = useState('ALL');
  const [coverageFilter, setCoverageFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('logs');
  const [sortConfig, setSortConfig] = useState({
    logs: { key: 'sentAt', direction: 'desc' },
    coverage: { key: 'name', direction: 'asc' },
  });
  const requestControllerRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    loadData();
    return () => requestControllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customRange]);

  function handlePrint() {
    window.print();
  }

  function selectPeriod(value) {
    setPeriod(value);
    setCustomRange(null);
    setCustomRangeOpen(false);
  }

  function applyCustomRange() {
    const { startDate, endDate } = customRangeDraft;
    if (!startDate || !endDate || startDate > endDate) {
      setActionMessage('Informe um periodo personalizado valido.');
      return;
    }
    setActionMessage('');
    setCustomRange({ startDate, endDate });
    setCustomRangeOpen(false);
  }

  function handleSort(scope, key) {
    setSortConfig((current) => {
      const previous = current[scope];
      const direction = previous?.key === key && previous.direction === 'asc' ? 'desc' : 'asc';
      return { ...current, [scope]: { key, direction } };
    });
  }

  async function loadData({ silent = false } = {}) {
    const requestId = ++requestIdRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    if (!silent) setLoading(true);
    setRefreshing(true);
    setLoadError('');
    try {
      const res = await getBillingReports(customRange ? { ...customRange } : { period }, { signal: controller.signal });
      if (requestId !== requestIdRef.current) return;
      setData(normalizeReportPayload(res?.data));
      setUpdatedAt(new Date());
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      if (requestId !== requestIdRef.current) return;
      console.error('Erro ao buscar relatório de cobrança:', err);
      setLoadError(err.response?.data?.error || 'Não foi possível carregar os relatórios.');
    } finally {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function requestBillingRetry() {
    setActionMessage('Solicitando nova leitura das pendencias ao agente...');
    try {
      await triggerBillingProcess();
      setActionMessage('Reprocessamento solicitado. O agente tentara os titulos pendentes na proxima leitura.');
    } catch (err) {
      setActionMessage(err.response?.data?.error || 'Nao foi possivel solicitar o reprocessamento.');
    }
  }

  function exportCsv() {
    const rows = activeTab === 'logs'
      ? [
          ['Data / Hora', 'Cliente', 'CPF/CNPJ', 'Status', 'Detalhe'],
          ...sortedLogs.map((log) => [
            new Date(log.sentAt).toLocaleString('pt-BR'),
            log.clientName || 'Cliente nao identificado',
            log.cpfCnpj || '',
            billingLogCategory(log),
            billingLogDetail(log),
          ]),
        ]
      : [
          ['Cliente', 'CPF/CNPJ', 'Telefone / WhatsApp', 'Envio no periodo', 'Detalhe'],
          ...sortedCoverage.map((contact) => [
            contact.name,
            contact.cpfCnpj,
            contact.phone || 'Sem telefone',
            contact.status === 'RECEIVED' ? 'Recebeu' : contact.status === 'NO_PHONE' ? 'Sem telefone' : 'Faltou enviar',
            coverageDetail(contact),
          ]),
        ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-cobranca-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const chartData = useMemo(() => {
    if (!data.stats) return [];
    return [
      { name: 'Enviados com Sucesso', value: data.stats.success, color: STATUS_COLORS.SUCCESS },
      { name: 'Sem Opt-in (Caixinha)', value: data.stats.skippedOptIn, color: STATUS_COLORS.SKIPPED_OPTIN },
      { name: 'Sem Telefone', value: data.stats.skippedNoContact, color: STATUS_COLORS.SKIPPED_NOCONTACT },
      { name: 'Erro Técnico', value: data.stats.failed, color: STATUS_COLORS.FAILED },
    ].filter(d => d.value > 0);
  }, [data.stats]);

  const filteredLogs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return data.logs.filter((log) => {
      const matchesType = filterType === 'ALL'
        || (filterType === 'SUCCESS' && log.status === 'SUCCESS')
        || (filterType === 'FAILED' && log.status === 'FAILED')
        || (filterType === 'SKIPPED_OPTIN' && log.status === 'SKIPPED' && log.errorMessage?.includes('Opt-in'))
        || (filterType === 'SKIPPED_NOCONTACT' && log.status === 'SKIPPED' && !log.errorMessage?.includes('Opt-in'));
      const haystack = `${log.clientName || ''} ${log.cpfCnpj || ''} ${log.errorMessage || ''}`.toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  }, [data.logs, filterType, searchTerm]);

  const filteredCoverage = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (data.coverageAnalysis || []).filter((contact) => {
      const matchesStatus = coverageFilter === 'ALL' || contact.status === coverageFilter;
      const haystack = `${contact.name || ''} ${contact.cpfCnpj || ''} ${contact.phone || ''} ${coverageDetail(contact)}`.toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [data.coverageAnalysis, coverageFilter, searchTerm]);

  const sortedLogs = useMemo(() => sortRows(
    filteredLogs,
    sortConfig.logs,
    (log, key) => {
      if (key === 'client') return `${log.clientName || ''} ${log.cpfCnpj || ''}`;
      if (key === 'status') return billingLogCategory(log);
      if (key === 'detail') return billingLogDetail(log);
      return log.sentAt;
    },
  ), [filteredLogs, sortConfig.logs]);

  const sortedCoverage = useMemo(() => sortRows(
    filteredCoverage,
    sortConfig.coverage,
    (contact, key) => {
      if (key === 'client') return `${contact.name || ''} ${contact.cpfCnpj || ''}`;
      if (key === 'phone') return contact.phone;
      if (key === 'status') return contact.status;
      if (key === 'detail') return coverageDetail(contact);
      return contact.name;
    },
  ), [filteredCoverage, sortConfig.coverage]);

  if (loading && !data.stats) {
    return (
      <div style={s.container}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '60vh' }}>
          <div style={{ color: 'var(--text-muted)' }}>Carregando métricas...</div>
        </div>
      </div>
    );
  }

  if (loadError && !data.stats) {
    return (
      <div style={s.container}>
        <div style={s.errorState} role="alert">
          <AlertTriangle size={22} />
          <strong>{loadError}</strong>
          <button type="button" style={s.retryBtn} onClick={() => loadData()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  const { stats } = data;
  // Entrega = enviados / tentativas reais (quem tinha opt-in + telefone),
  // calculado no backend. Cai para 0 quando não houve nenhuma tentativa real.
  const deliveryRate = stats?.deliveryRate ?? 0;
  const eligibleAttempts = stats?.eligibleAttempts ?? ((stats?.success || 0) + (stats?.failed || 0));
  const reportPeriodLabel = customRange
    ? `${formatDateOnly(customRange.startDate)} a ${formatDateOnly(customRange.endDate)}`
    : PERIOD_OPTIONS.find((option) => option.value === period)?.label || `${period} dias`;

  return (
    <div style={s.container} className="billing-report-container">
      <style>{`
        @keyframes billing-spin { to { transform: rotate(360deg); } }
        .billing-spin { animation: billing-spin 0.9s linear infinite; }
        @media print {
          @page { size: landscape; margin: 12mm; }
          html, body, #root,
          .app-layout-root, .app-layout-content,
          .billing-report-container {
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          .app-layout-root, .app-layout-content, .billing-report-container {
            display: block !important;
          }
          nav, header, .no-print { display: none !important; }
          .billing-report-container { padding: 0 !important; background: #fff !important; color: #111827 !important; }
          .billing-report-container .content,
          .billing-report-container .table-box,
          .billing-report-container .print-full {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
          }
          .billing-report-container .table-box { display: block !important; border: 1px solid #cbd5e1 !important; padding: 14px !important; }
          .billing-report-container .print-full { display: block !important; border: 1px solid #cbd5e1 !important; }
          .main-section-print { display: block !important; grid-template-columns: 1fr !important; }
          table { display: table !important; width: 100% !important; height: auto !important; border-collapse: collapse !important; page-break-after: auto; }
          thead { display: table-header-group !important; }
          tbody { display: table-row-group !important; }
          tr { display: table-row !important; page-break-inside: avoid; break-inside: avoid; }
          th, td { display: table-cell !important; border-bottom: 1px solid #cbd5e1 !important; padding: 8px !important; color: #1f2937 !important; background: #fff !important; }
          th { background: #f1f5f9 !important; color: #334155 !important; }
          .status-badge { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .table-sort-button { color: inherit !important; background: transparent !important; border: 0 !important; padding: 0 !important; cursor: default !important; }
          .sort-indicator { display: none !important; }
          thead { display: table-header-group; }
          .coverage-summary { color: #111827 !important; background: #f8fafc !important; border-color: #94a3b8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .coverage-summary span { display: block; font-size: 11px; color: #555 !important; }
          .coverage-summary strong { color: #111827 !important; }
          body { background: #fff !important; color: #111827 !important; }
        }
      `}</style>
      <PageHeader
        title="Relatórios de Cobrança"
        subtitle="Analise a efetividade dos envios automáticos de boletos via WhatsApp."
        actions={
          <div style={s.headerActions}>
            <button onClick={handlePrint} className="no-print" style={s.printBtn}>
              <Printer size={16} /> Salvar PDF
            </button>
            <button onClick={exportCsv} className="no-print" style={s.secondaryActionBtn} title="Exportar os dados filtrados para Excel">
              <Download size={16} /> CSV/Excel
            </button>
            <button onClick={() => loadData({ silent: true })} className="no-print" style={s.secondaryActionBtn} disabled={refreshing} title="Atualizar relatórios">
              <RefreshCw size={16} className={refreshing ? 'billing-spin' : ''} /> Atualizar
            </button>
            <div style={s.periodGroup} className="no-print">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                style={{ ...s.periodBtn, ...(period === opt.value && !customRange ? s.periodBtnActive : {}) }}
                onClick={() => selectPeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            <button type="button" style={{ ...s.periodBtn, ...(customRange ? s.periodBtnActive : {}) }} onClick={() => setCustomRangeOpen((open) => !open)}>
              Personalizado
            </button>
            </div>
          </div>
        }
      />

      <div style={s.reportMeta} className="no-print">
        <span><CalendarDays size={15} /> Periodo: <strong>{reportPeriodLabel}</strong></span>
        <span>{updatedAt ? `Atualizado as ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Aguardando atualizacao'}</span>
      </div>
      {customRangeOpen && (
        <div style={s.customRangePanel} className="no-print">
          <label style={s.dateField}>De<input type="date" style={s.dateInput} value={customRangeDraft.startDate} onChange={(event) => setCustomRangeDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
          <label style={s.dateField}>Ate<input type="date" style={s.dateInput} value={customRangeDraft.endDate} onChange={(event) => setCustomRangeDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
          <button type="button" style={s.applyRangeBtn} onClick={applyCustomRange}>Aplicar periodo</button>
        </div>
      )}
      {actionMessage ? <div style={s.actionMessage} className="no-print">{actionMessage}</div> : null}
      {loadError ? (
        <div style={s.inlineError} className="no-print" role="alert">
          <AlertTriangle size={15} />
          <span>{loadError}</span>
          <button type="button" style={s.inlineErrorButton} onClick={() => loadData({ silent: true })}>Tentar novamente</button>
        </div>
      ) : null}

      <div style={s.content}>
        {/* KPIs */}
        <div style={s.kpiGrid} className="no-print">
          <div style={s.kpiCard}>
            <div style={s.kpiHeader}>
              <span style={s.kpiTitle}>Total Processado</span>
              <BarChart2 size={18} color="var(--accent)" />
            </div>
            <div style={s.kpiValue}>{stats?.total || 0}</div>
            <div style={s.kpiSub}>Registros no período — a maioria é checagem sem opt-in</div>
          </div>

          <div style={s.kpiCard}>
            <div style={s.kpiHeader}>
              <span style={s.kpiTitle}>Taxa de Entrega</span>
              <CheckCircle2 size={18} color={STATUS_COLORS.SUCCESS} />
            </div>
            <div style={{ ...s.kpiValue, color: STATUS_COLORS.SUCCESS }}>{eligibleAttempts > 0 ? `${deliveryRate}%` : '—'}</div>
            <div style={s.kpiSub}>{stats?.success || 0} de {eligibleAttempts} tentativas reais (com opt-in + telefone)</div>
          </div>

          <div style={s.kpiCard}>
            <div style={s.kpiHeader}>
              <span style={s.kpiTitle}>Base Opt-in CRM</span>
              <Users size={18} color="var(--accent, #3b82f6)" />
            </div>
            <div style={{ ...s.kpiValue, color: 'var(--accent, #3b82f6)' }}>{stats?.totalOptIn || 0}</div>
            <div style={s.kpiSub}>Total de clientes que aceitam cobrança no CRM</div>
          </div>

          <div style={s.kpiCard}>
            <div style={s.kpiHeader}>
              <span style={s.kpiTitle}>Sem Permissão (Falta Opt-in)</span>
              <UserX size={18} color={STATUS_COLORS.SKIPPED_OPTIN} />
            </div>
            <div style={{ ...s.kpiValue, color: STATUS_COLORS.SKIPPED_OPTIN }}>{stats?.skippedOptIn || 0}</div>
            <div style={s.kpiSub}>Caixinha desmarcada na hora do envio</div>
          </div>

          <div style={s.kpiCard}>
            <div style={s.kpiHeader}>
              <span style={s.kpiTitle}>Sem Telefone</span>
              <PhoneOff size={18} color={STATUS_COLORS.SKIPPED_NOCONTACT} />
            </div>
            <div style={{ ...s.kpiValue, color: STATUS_COLORS.SKIPPED_NOCONTACT }}>{stats?.skippedNoContact || 0}</div>
            <div style={s.kpiSub}>Contato não encontrado ou telefone em branco</div>
          </div>

          <div style={s.kpiCard}>
            <div style={s.kpiHeader}>
              <span style={s.kpiTitle}>Falhas tecnicas</span>
              <AlertTriangle size={18} color={STATUS_COLORS.FAILED} />
            </div>
            <div style={{ ...s.kpiValue, color: STATUS_COLORS.FAILED }}>{stats?.failed || 0}</div>
            <div style={s.kpiSub}>{eligibleAttempts > 0 ? `${stats?.failureRate ?? 0}% das tentativas reais falharam` : 'Nenhuma tentativa real no período'}</div>
          </div>
        </div>

        <div style={s.mainSection} className="main-section-print">
          {/* Chart */}
          <div style={s.chartBox} className="no-print">
            <h3 style={s.boxTitle}>Distribuição dos Resultados</h3>
            {chartData.length > 0 ? (
              <>
              <div style={{ height: '300px', width: '100%' }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={chartData}
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value) => [`${value} boletos`, '']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={s.chartBars}>
                {chartData.map((entry) => {
                  const percentage = stats?.total ? Math.round((entry.value / stats.total) * 100) : 0;
                  return (
                    <div key={entry.name} style={s.chartBarRow}>
                      <div style={s.chartBarLabel}><span>{entry.name}</span><strong>{entry.value} ({percentage}%)</strong></div>
                      <div style={s.chartTrack}><div style={{ ...s.chartFill, width: `${percentage}%`, background: entry.color }} /></div>
                    </div>
                  );
                })}
              </div>
              </>
            ) : (
              <div style={s.emptyState}>Sem dados no período</div>
            )}
          </div>

          {/* Audit Table */}
          <div style={s.tableBox} className="table-box">
            <div style={{ ...s.tableHeader, borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }} className="no-print">
                <button 
                  style={activeTab === 'logs' ? s.tabActive : s.tabInactive} 
                  onClick={() => setActiveTab('logs')}
                >
                  Disparos (Logs)
                </button>
                <button 
                  style={activeTab === 'coverage' ? s.tabActive : s.tabInactive} 
                  onClick={() => setActiveTab('coverage')}
                >
                  Análise de Cobertura (Base x Enviados)
                </button>
              </div>
              <h3 style={s.boxTitle} className="only-print">Relatório de {activeTab === 'logs' ? 'Disparos' : 'Análise de Cobertura'}</h3>
              
              {activeTab === 'logs' && (
                <div style={s.filterGroup} className="no-print">
                  <Filter size={16} color="var(--text-muted)" />
                  <select
                    style={s.select}
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option value="ALL">Todos os Resultados</option>
                    <option value="SUCCESS">Somente Sucesso</option>
                    <option value="SKIPPED_OPTIN">Sem Opt-in (Caixinha)</option>
                    <option value="SKIPPED_NOCONTACT">Sem Contato/Telefone</option>
                    <option value="FAILED">Falha Técnica</option>
                  </select>
                </div>
              )}
            </div>

            <div style={s.tableToolbar} className="no-print">
              <div style={s.searchBox}>
                <Search size={16} color="var(--text-muted)" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={activeTab === 'logs' ? 'Buscar cliente, CNPJ ou erro...' : 'Buscar cliente, telefone ou detalhe...'}
                  style={s.searchInput}
                />
              </div>
              {activeTab === 'coverage' ? (
                <div style={s.filterGroup}>
                  <Filter size={16} color="var(--text-muted)" />
                  <select style={s.select} value={coverageFilter} onChange={(event) => setCoverageFilter(event.target.value)}>
                    <option value="ALL">Todos os clientes</option>
                    <option value="RECEIVED">Receberam</option>
                    <option value="NOT_SENT">Faltou enviar</option>
                    <option value="FAILED">Falha técnica</option>
                    <option value="NO_PHONE">Sem telefone</option>
                    <option value="SKIPPED">Sem opt-in</option>
                  </select>
                </div>
              ) : (
                <button type="button" style={s.retryBtn} onClick={requestBillingRetry}>
                  Reprocessar pendências
                </button>
              )}
              <span style={s.resultCount}>{activeTab === 'logs'
                ? (data.stats?.logsTruncated ? `${sortedLogs.length} de ${data.stats.total} registros` : `${sortedLogs.length} registros`)
                : `${sortedCoverage.length} clientes`}</span>
            </div>

            {activeTab === 'coverage' && (
              <div style={s.coverageSummary} className="coverage-summary">
                <div style={s.coverageSummaryTop}>
                <div style={s.coverageIntro}>
                  <strong>Conferência de cobertura</strong>
                  <span>Clientes com cobrança autorizada no CRM x envios concluídos no período</span>
                </div>
                <div style={s.coverageMetrics}>
                  <div style={s.coverageMetric}><strong>{data.coverageSummary?.expected || 0}</strong><span>Deveriam receber</span></div>
                  <div style={{ ...s.coverageMetric, color: STATUS_COLORS.RECEIVED }}><strong>{data.coverageSummary?.received || 0}</strong><span>Receberam</span></div>
                  <div style={{ ...s.coverageMetric, color: STATUS_COLORS.NOT_SENT }}><strong>{data.coverageSummary?.notReceived || 0}</strong><span>Não receberam</span></div>
                  <div style={{ ...s.coverageMetric, color: STATUS_COLORS.RECEIVED }}><strong>{data.coverageSummary?.rate || 0}%</strong><span>Cobertura</span></div>
                </div>
                </div>
                <div style={s.coverageReasons}>
                  <span>Falhas: <strong>{data.coverageSummary?.failed || 0}</strong></span>
                  <span>Sem telefone: <strong>{data.coverageSummary?.noPhone || 0}</strong></span>
                  <span>Sem opt-in: <strong>{data.coverageSummary?.skipped || 0}</strong></span>
                  <span>Nao processados: <strong>{data.coverageSummary?.notSent || 0}</strong></span>
                </div>
              </div>
            )}

            <div style={s.tableWrapper} className="print-full">
              <table style={s.table}>
                {activeTab === 'logs' ? (
                  <>
                    <thead>
                      <tr>
                        <SortableHeader label="Data / Hora" scope="logs" sortKey="sentAt" sortConfig={sortConfig.logs} onSort={handleSort} />
                        <SortableHeader label="Cliente (CPF/CNPJ)" scope="logs" sortKey="client" sortConfig={sortConfig.logs} onSort={handleSort} />
                        <SortableHeader label="Status" scope="logs" sortKey="status" sortConfig={sortConfig.logs} onSort={handleSort} />
                        <SortableHeader label="Detalhe" scope="logs" sortKey="detail" sortConfig={sortConfig.logs} onSort={handleSort} />
                        <th style={s.th} className="no-print">Acao</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLogs.map((log) => {
                        const isSuccess = log.status === 'SUCCESS';
                        const isSkipped = log.status === 'SKIPPED';
                        const isFailed = log.status === 'FAILED';
                        const isOptin = log.errorMessage?.includes('Opt-in');
                        const badgeColor = isSuccess ? STATUS_COLORS.SUCCESS : isFailed ? STATUS_COLORS.FAILED : (isOptin ? STATUS_COLORS.SKIPPED_OPTIN : STATUS_COLORS.SKIPPED_NOCONTACT);

                        return (
                          <tr key={log.id}>
                            <td style={s.tdTime}>
                              <Clock size={14} style={{ marginRight: '6px' }} className="no-print" />
                              {new Date(log.sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td style={s.tdClient}>
                              <strong>{log.clientName || (log.cpfCnpj ? 'Cliente sem nome' : 'Cliente nao identificado')}</strong>
                              <br />
                              <span style={s.cnpj}>{log.cpfCnpj}</span>
                            </td>
                            <td style={s.td}>
                              <span className="status-badge" style={{ ...s.badge, backgroundColor: `${badgeColor}20`, color: badgeColor }}>
                                {isSuccess ? 'Enviado' : isSkipped ? (isOptin ? 'Sem Permissão' : 'S/ Telefone') : 'Erro'}
                              </span>
                            </td>
                            <td style={s.tdMessage}>
                              <strong style={s.detailCategory}>{billingLogCategory(log)}</strong>
                              <span style={s.detailText}>{billingLogDetail(log)}</span>
                            </td>
                            <td style={s.tdAction} className="no-print">
                              {log.status === 'FAILED' ? <button type="button" style={s.retrySmallBtn} onClick={requestBillingRetry}>Tentar novamente</button> : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {sortedLogs.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            Nenhum registro encontrado para este filtro.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <SortableHeader label="Cliente" scope="coverage" sortKey="client" sortConfig={sortConfig.coverage} onSort={handleSort} />
                        <SortableHeader label="Telefone / WhatsApp" scope="coverage" sortKey="phone" sortConfig={sortConfig.coverage} onSort={handleSort} />
                        <SortableHeader label="Envio no Período" scope="coverage" sortKey="status" sortConfig={sortConfig.coverage} onSort={handleSort} />
                        <SortableHeader label="Detalhe" scope="coverage" sortKey="detail" sortConfig={sortConfig.coverage} onSort={handleSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCoverage.map((contact) => {
                        const badgeColor = STATUS_COLORS[contact.status] || STATUS_COLORS.FAILED;
                        return (
                          <tr key={contact.id}>
                            <td style={s.tdClient}>
                              <strong>{contact.name}</strong>
                              <br />
                              <span style={s.cnpj}>{contact.cpfCnpj}</span>
                            </td>
                            <td style={s.tdMessage}>
                              {contact.phone || 'Sem telefone'}
                            </td>
                            <td style={s.td}>
                              <span className="status-badge" style={{ ...s.badge, backgroundColor: `${badgeColor}20`, color: badgeColor }}>
                                {contact.status === 'RECEIVED' ? '✓ Recebeu' : contact.status === 'NO_PHONE' ? 'Sem telefone' : contact.status === 'FAILED' ? 'Falha no envio' : 'Faltou enviar'}
                              </span>
                            </td>
                            <td style={s.tdMessage}>
                              {coverageDetail(contact)}
                            </td>
                          </tr>
                        );
                      })}
                      {sortedCoverage.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            Nenhum cliente com opt-in encontrado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  container: {
    padding: 'var(--space-6)',
    background: 'var(--bg-base)',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflowY: 'auto'
  },
  headerActions: {
    display: 'flex',
    gap: 'var(--space-3)',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  secondaryActionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '8px 12px',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-main)',
    fontWeight: 700,
    cursor: 'pointer',
  },
  reportMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    marginTop: 'var(--space-3)',
    color: 'var(--text-muted)',
    fontSize: '0.78rem',
  },
  customRangePanel: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 'var(--space-3)',
    marginTop: 'var(--space-3)',
    padding: 'var(--space-3)',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
  },
  dateField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    fontWeight: 700,
  },
  dateInput: {
    minHeight: '36px',
    padding: '6px 9px',
    border: '1px solid var(--border-color)',
    borderRadius: '7px',
    background: 'var(--bg-base)',
    color: 'var(--text-main)',
    font: 'inherit',
  },
  applyRangeBtn: {
    padding: '9px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    fontWeight: 800,
    cursor: 'pointer',
  },
  actionMessage: {
    marginTop: 'var(--space-3)',
    padding: '10px 14px',
    border: '1px solid var(--accent-border)',
    borderRadius: '10px',
    background: 'var(--accent-light)',
    color: 'var(--text-main)',
    fontSize: '0.82rem',
    fontWeight: 600,
  },
  inlineError: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    marginTop: 'var(--space-3)',
    padding: '10px 14px',
    border: '1px solid rgba(220, 38, 38, 0.35)',
    borderRadius: '10px',
    background: 'rgba(220, 38, 38, 0.08)',
    color: '#dc2626',
    fontSize: '0.82rem',
    fontWeight: 600,
  },
  inlineErrorButton: {
    marginLeft: 'auto',
    padding: '5px 9px',
    border: '1px solid currentColor',
    borderRadius: '6px',
    background: 'transparent',
    color: 'inherit',
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-3)',
    minHeight: '60vh',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  periodGroup: {
    display: 'flex',
    gap: 'var(--space-2)',
    background: 'var(--bg-panel)',
    padding: 'var(--space-1)',
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
  },
  periodBtn: {
    padding: 'var(--space-2) var(--space-4)',
    border: 'none',
    background: 'transparent',
    borderRadius: '8px',
    color: 'var(--text-muted)',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  periodBtnActive: {
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
  },
  content: {
    marginTop: 'var(--space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)'
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 'var(--space-6)',
  },
  kpiCard: {
    background: 'var(--bg-panel)',
    padding: 'var(--space-5)',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
  },
  kpiHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-3)'
  },
  kpiTitle: {
    fontSize: '0.875rem',
    color: 'var(--text-muted)',
    fontWeight: 600
  },
  kpiValue: {
    fontSize: '2rem',
    fontWeight: 800,
    color: 'var(--text-main)',
    lineHeight: 1
  },
  kpiSub: {
    marginTop: 'var(--space-2)',
    fontSize: '0.75rem',
    color: 'var(--text-muted)'
  },
  mainSection: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: 'var(--space-6)',
    alignItems: 'start'
  },
  chartBox: {
    background: 'var(--bg-panel)',
    padding: 'var(--space-6)',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
  },
  chartBars: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.7rem',
    marginTop: 'var(--space-3)',
  },
  chartBarRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  chartBarLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-2)',
    color: 'var(--text-muted)',
    fontSize: '0.72rem',
  },
  chartTrack: {
    height: '7px',
    background: 'var(--bg-base)',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  chartFill: {
    height: '100%',
    minWidth: '3px',
    borderRadius: '999px',
  },
  tableBox: {
    background: 'var(--bg-panel)',
    padding: 'var(--space-6)',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  coverageSummary: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 'var(--space-4)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    background: 'var(--bg-base)',
  },
  coverageSummaryTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
  },
  coverageReasons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
  },
  coverageMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(80px, 1fr))',
    gap: 'var(--space-4)',
    textAlign: 'center',
  },
  coverageIntro: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  coverageMetric: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    fontSize: '0.75rem',
  },
  boxTitle: {
    margin: '0 0 var(--space-4) 0',
    fontSize: '1rem',
    fontWeight: 700
  },
  tableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-4)'
  },
  tableToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
    flexWrap: 'wrap',
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    flex: '1 1 260px',
    minWidth: '220px',
    padding: '8px 11px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
  },
  searchInput: {
    width: '100%',
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'var(--text-main)',
    font: 'inherit',
  },
  resultCount: {
    marginLeft: 'auto',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    whiteSpace: 'nowrap',
  },
  retryBtn: {
    padding: '9px 13px',
    border: '1px solid var(--accent-border)',
    borderRadius: '8px',
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    background: 'var(--bg-base)',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: '8px',
    border: '1px solid var(--border-color)'
  },
  select: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-main)',
    fontSize: '0.875rem',
    outline: 'none',
    cursor: 'pointer'
  },
  tdAction: {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
    whiteSpace: 'nowrap',
  },
  retrySmallBtn: {
    padding: '5px 8px',
    border: '1px solid var(--accent-border)',
    borderRadius: '6px',
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    fontSize: '0.7rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
  detailCategory: {
    display: 'block',
    marginBottom: '2px',
    color: 'var(--text-main)',
    fontSize: '0.72rem',
  },
  detailText: {
    display: 'block',
  },
  tableWrapper: {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: '400px',
    border: '1px solid var(--border-color)',
    borderRadius: '8px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
    fontSize: '0.875rem'
  },
  tableSortButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    width: '100%',
    padding: 0,
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  th: {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    fontWeight: 600,
    background: 'var(--bg-base)',
    position: 'sticky',
    top: 0,
    zIndex: 1
  },
  td: {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
  },
  tdTime: {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap'
  },
  tdClient: {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
    maxWidth: '200px'
  },
  cnpj: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '2px',
    display: 'block'
  },
  tdMessage: {
    padding: 'var(--space-3) var(--space-4)',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    maxWidth: '250px'
  },
  badge: {
    padding: '4px 8px',
    borderRadius: '20px',
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    height: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)'
  },
  printBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    borderRadius: '8px',
    color: 'var(--text-inverse)',
    fontWeight: 600,
    cursor: 'pointer'
  },
  tabActive: {
    padding: '8px 16px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderBottom: '2px solid var(--accent)',
    color: 'var(--accent)',
    fontWeight: 700,
    cursor: 'pointer',
    borderRadius: '8px 8px 0 0'
  },
  tabInactive: {
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--text-muted)',
    fontWeight: 600,
    cursor: 'pointer'
  }
};
