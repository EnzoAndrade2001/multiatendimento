import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CreditCard,
  Database,
  Download,
  Eye,
  FileText,
  Files,
  Gauge,
  Hash,
  Mail,
  Map as MapIcon,
  MapPin,
  MapPinned,
  PackageSearch,
  Phone,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  User,
  Wrench,
  X,
} from 'lucide-react';
import {
  BACKEND_URL,
  getMediaUrl,
  getCrmCustomer,
  getCrmCustomerContracts,
  getCrmCustomerServiceOrders,
  getCrmCustomer360,
  getCrmReceivableDocuments,
  getCrmCustomers,
  exportCrmCustomers,
  getCrmSummary,
  getCrmFlaggedDocuments,
  prepareCrmReceivableDocument,
  sendCrmReceivableDocuments,
  sendOSManagerCopy,
} from '../services/api';
import { toast } from '../utils/toast';
import { usePermissions } from '../auth/PermissionContext';
import { CrmContactActions, CrmEquipmentFilters, filterCrmEquipments } from '../components/CrmOperationalControls';

const EMPTY_SUMMARY = { customers: 0, equipments: 0, linkedEquipments: 0, contractedEquipments: 0, activeContracts: 0, openServiceOrders: 0 };
const CRM_PAGE_SIZE = 60;
const CRM_VIEW_OPTIONS = [
  { id: 'all', label: 'Todos' },
  { id: 'contracted', label: 'Em contrato' },
  { id: 'open', label: 'O.S. abertas' },
  { id: 'attention', label: 'Requer atenção' },
  { id: 'without-contract', label: 'Sem contrato' },
];

function readSavedCrmViews() {
  try {
    const value = JSON.parse(window.localStorage.getItem('crm-saved-views') || '[]');
    return Array.isArray(value) ? value.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export default function CRM() {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageMeta, setPageMeta] = useState({ total: 0, pageSize: CRM_PAGE_SIZE, hasMore: false });
  const [viewFilter, setViewFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [savedViews, setSavedViews] = useState(readSavedCrmViews);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({ city: '', state: '', hasPhone: '', contractStatus: '', financialStatus: '' });
  const [modalLoading, setModalLoading] = useState(false);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalResources, setModalResources] = useState({ base: 'idle', contracts: 'idle', os: 'idle', view360: 'idle' });
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [flaggedDocuments, setFlaggedDocuments] = useState([]);
  const [flaggedExpanded, setFlaggedExpanded] = useState(false);

  useEffect(() => { load(new URLSearchParams(window.location.search).get('q') || '', 1); }, []);
  useEffect(() => {
    // Reativo: só existe aqui o que alguém já tentou abrir e falhou (documento
    // ambíguo ou ainda não localizado nas pastas). Usuário sem acesso financeiro
    // recebe 403 do backend - o painel simplesmente não aparece para ele.
    getCrmFlaggedDocuments()
      .then((response) => setFlaggedDocuments(arrayOf(response.data?.items)))
      .catch(() => {});
  }, []);

  async function load(search = q, nextPage = 1, options = {}) {
    const activeView = options.viewFilter ?? viewFilter;
    const activeSort = options.sortBy ?? sortBy;
    const activeFilters = options.filtersOverride ?? advancedFilters;
    const customerFilters = {
      view: activeView === 'all' ? undefined : activeView,
      sort: activeSort === 'attention' ? 'attention' : activeSort === 'open' ? 'openOrders' : activeSort === 'contracted' ? 'equipments' : activeSort === 'updated' ? 'updatedAt' : 'name',
      city: activeFilters.city?.trim() || undefined,
      state: activeFilters.state?.trim() || undefined,
      hasPhone: activeFilters.hasPhone || undefined,
      contractStatus: activeFilters.contractStatus || undefined,
      financialStatus: activeFilters.financialStatus || undefined,
    };
    setLoading(true);
    try {
      const [summaryResponse, customersResponse] = await Promise.all([
        getCrmSummary(),
        getCrmCustomers({ q: search, limit: CRM_PAGE_SIZE, page: nextPage, pageSize: CRM_PAGE_SIZE, paginate: true, ...customerFilters }),
      ]);
      setSummary({ ...EMPTY_SUMMARY, ...(summaryResponse.data || {}) });
      const payload = customersResponse.data;
      const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
      setCustomers(items);
      setPage(Array.isArray(payload) ? 1 : Number(payload?.page || nextPage));
      setPageMeta({
        total: Number(payload?.total ?? (Array.isArray(payload) ? items.length : 0)),
        pageSize: Number(payload?.pageSize || payload?.limit || CRM_PAGE_SIZE),
        hasMore: Boolean(payload?.hasMore),
      });
    } finally {
      setLoading(false);
    }
  }

  async function openCustomer(customer, tab = 'overview') {
    setSelectedCustomer(customer);
    setActiveTab(tab);
    setModalLoading(true);
    setRelatedLoading(false);
    setModalError('');
    setModalResources({ base: 'loading', contracts: 'idle', os: 'idle', view360: 'idle' });
    try {
      const response = await getCrmCustomer(customer.id);
      const fullCustomer = response.data || customer;
      setSelectedCustomer(fullCustomer);
      setModalResources({ base: 'ready', contracts: 'loading', os: 'loading', view360: 'loading' });
      setModalLoading(false);
      setRelatedLoading(true);

      const [contractsResult, ordersResult, view360Result] = await Promise.allSettled([
        getCrmCustomerContracts(customer.id),
        getCrmCustomerServiceOrders(customer.id, 25),
        getCrmCustomer360(customer.id),
      ]);
      const contracts = contractsResult.status === 'fulfilled' ? contractsResult.value.data?.items || [] : [];
      const serviceOrders = ordersResult.status === 'fulfilled' ? ordersResult.value.data?.items || [] : [];
      const customer360 = view360Result.status === 'fulfilled' ? view360Result.value.data || null : null;
      setModalResources({
        base: 'ready',
        contracts: contractsResult.status === 'fulfilled' ? 'ready' : 'error',
        os: ordersResult.status === 'fulfilled' ? 'ready' : 'error',
        view360: view360Result.status === 'fulfilled' ? 'ready' : 'error',
      });

      setSelectedCustomer((current) => ({
        ...(current || fullCustomer),
        contracts,
        serviceOrders,
        serviceOrdersPage: ordersResult.status === 'fulfilled' ? ordersResult.value.data : null,
        customer360,
        operationalSummary: {
          ...(current?.operationalSummary || fullCustomer.operationalSummary || {}),
          contracts: contracts.length,
          activeContracts: contracts.filter(isContractActive).length,
          contractValue: contracts.filter(isContractActive).reduce((total, contract) => total + Number(contract.monthlyValue || contract.value || 0), 0),
          openServiceOrders: serviceOrders.filter((order) => !isOrderClosed(order)).length,
          lastServiceOrderAt: serviceOrders[0]?.openedAt || null,
        },
      }));

      if (contractsResult.status === 'rejected' || ordersResult.status === 'rejected' || view360Result.status === 'rejected') {
        setModalError('Algumas informações complementares não puderam ser carregadas. Você pode tentar novamente.');
      }
    } catch (error) {
      setModalResources((current) => ({ ...current, base: 'error' }));
      setModalError(error.code === 'ECONNABORTED'
        ? 'A consulta ao servidor demorou mais que o esperado. Tente novamente.'
        : 'Não foi possível atualizar os dados deste cliente.');
    } finally {
      setModalLoading(false);
      setRelatedLoading(false);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    load(q, 1);
  }

  const customerMetrics = useMemo(() => new Map(customers.map((customer) => [customer.id, getCustomerListMetrics(customer)])), [customers]);
  const filteredCustomers = useMemo(() => {
    const filtered = customers.filter((customer) => matchesCrmView(customer, viewFilter));
    return filtered.sort((firstCustomer, secondCustomer) => compareCrmCustomers(firstCustomer, secondCustomer, sortBy));
  }, [customers, viewFilter, sortBy]);
  const viewCounts = useMemo(() => Object.fromEntries(CRM_VIEW_OPTIONS.map(({ id }) => [
    id,
    customers.filter((customer) => matchesCrmView(customer, id)).length,
  ])), [customers]);

  function chooseView(view) {
    setViewFilter(view);
    setPage(1);
    load(q, 1, { viewFilter: view });
  }

  function saveCurrentView() {
    const name = window.prompt('Nome para esta visão do CRM:');
    const normalized = String(name || '').trim();
    if (!normalized) return;
    const next = [{ id: `${Date.now()}`, name: normalized, filter: viewFilter, sort: sortBy, filters: advancedFilters }, ...savedViews.filter((item) => item.name.toLowerCase() !== normalized.toLowerCase())].slice(0, 8);
    setSavedViews(next);
    try { window.localStorage.setItem('crm-saved-views', JSON.stringify(next)); } catch { /* storage is optional */ }
    toast.success('Visão salva');
  }

  function applySavedView(view) {
    if (!view) return;
    const nextFilters = { city: '', state: '', hasPhone: '', contractStatus: '', financialStatus: '', ...(view.filters || {}) };
    setViewFilter(view.filter || 'all');
    setSortBy(view.sort || 'name');
    setAdvancedFilters(nextFilters);
    setPage(1);
    load(q, 1, { viewFilter: view.filter || 'all', sortBy: view.sort || 'name', filtersOverride: nextFilters });
  }

  function clearSearch() {
    setQ('');
    load('', 1);
  }

  function applyAdvancedFilters(nextFilters = advancedFilters) {
    setAdvancedFilters(nextFilters);
    setPage(1);
    load(q, 1, { filtersOverride: nextFilters });
  }

  function openWhatsApp(customer) {
    const phone = String(customer?.phone || '').replace(/\D/g, '');
    if (!phone) return openCustomer(customer, 'contacts');
    window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer');
  }

  async function exportCustomers() {
    try {
      const activeView = viewFilter;
      const params = {
        q,
        view: activeView === 'all' ? undefined : activeView,
        sort: sortBy === 'attention' ? 'attention' : sortBy === 'open' ? 'openOrders' : sortBy === 'contracted' ? 'equipments' : sortBy === 'updated' ? 'updatedAt' : 'name',
        city: advancedFilters.city?.trim() || undefined,
        state: advancedFilters.state?.trim() || undefined,
        hasPhone: advancedFilters.hasPhone || undefined,
        contractStatus: advancedFilters.contractStatus || undefined,
        financialStatus: advancedFilters.financialStatus || undefined,
      };
      const response = await exportCrmCustomers(params);
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `crm-clientes-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Exportação do CRM iniciada');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível exportar os clientes');
    }
  }

  return (
    <div className="crm-page" style={s.container}>
      <style>{crmResponsiveCss}</style>
      <div className="crm-page-header" style={s.header}>
        <div>
          <p style={s.kicker}>Central de relacionamento ILUX</p>
          <h1 style={s.title}>CRM operacional</h1>
          <p style={s.subtitle}>Informações comerciais e técnicas reunidas para agilizar o atendimento.</p>
        </div>
        <div className="crm-header-actions" style={s.headerActions}>
          <div style={s.syncNotice}>
            <Database size={16} />
            <div>
              <strong style={{ color: 'var(--text-main)' }}>Sincronizado com o ILUX</strong>
              <span>Consulta operacional</span>
            </div>
          </div>
          <button type="button" style={s.refreshBtn} onClick={() => load(q, page)} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
          </button>
          <button type="button" style={s.refreshBtn} onClick={exportCustomers} disabled={loading}>
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="crm-stats" style={s.statsGrid}>
        <Stat icon={<Building2 size={19} />} label="Clientes" value={pick(summary, 'customers', 'totalCustomers')} />
        <Stat icon={<Printer size={19} />} label="Equipamentos cadastrados" value={pick(summary, 'equipments', 'totalEquipments')} />
        <Stat icon={<ShieldCheck size={19} />} label="Equipamentos em contrato" value={pick(summary, 'contractedEquipments')} />
        <Stat icon={<FileText size={19} />} label="Contratos ativos" value={summary.contracts?.active ?? pick(summary, 'activeContracts')} />
        <Stat icon={<ClipboardList size={19} />} label="O.S. abertas" value={summary.serviceOrders?.open ?? pick(summary, 'openServiceOrders', 'openOrders', 'serviceOrdersOpen')} tone="warning" />
        <Stat
          icon={<CircleDollarSign size={19} />}
          label="Mensalidade ativa"
          value={formatCurrency(pick(summary, 'monthlyContractValue', 'activeMonthlyValue', 'monthlyValue', 'monthlyRevenue') ?? summary.contracts?.value)}
          formatted
        />
      </div>

      {flaggedDocuments.length ? (
        <div style={s.flaggedPanel}>
          <button type="button" style={s.flaggedHeader} onClick={() => setFlaggedExpanded((current) => !current)} aria-expanded={flaggedExpanded}>
            <span style={s.flaggedHeaderMain}>
              <Siren size={18} />
              <strong>{flaggedDocuments.length} documento(s) financeiro(s) precisam de revisão</strong>
            </span>
            <ChevronDown size={16} style={{ transform: flaggedExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
          {flaggedExpanded ? (
            <div style={s.flaggedList}>
              {flaggedDocuments.map((item) => {
                const clickable = Boolean(item.customerId);
                const Wrapper = clickable ? 'button' : 'div';
                return (
                  <Wrapper
                    key={item.id}
                    {...(clickable ? { type: 'button', onClick: () => openCustomer({ id: item.customerId }, 'financial') } : {})}
                    style={{ ...s.flaggedItem, ...(clickable ? {} : s.flaggedItemDisabled) }}
                  >
                    <div style={s.flaggedItemMain}>
                      <strong>{item.customerName}</strong>
                      <span>{documentTypeLabel(item.documentType)}{item.invoiceNumber ? ` · NF ${item.invoiceNumber}` : ''}</span>
                      <small>{item.error || 'Documento não localizado nas pastas monitoradas.'}</small>
                    </div>
                    {clickable ? <ChevronRight size={16} /> : <span style={s.flaggedItemHint}>Título não localizado</span>}
                  </Wrapper>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <form className="crm-search" style={s.searchBar} onSubmit={submitSearch}>
        <Search size={19} color="var(--text-dim)" />
        <input
          style={s.searchInput}
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Busque por cliente, CNPJ, telefone, série, patrimônio, endereço ou código ILUX"
        />
        {q ? <button type="button" style={s.clearSearch} onClick={clearSearch} aria-label="Limpar busca"><X size={16} /></button> : null}
        <button type="submit" style={s.searchBtn} disabled={loading}>{loading ? 'Buscando...' : 'Buscar'}</button>
      </form>

      <div className="crm-list-toolbar" style={s.listToolbar}>
        <div style={s.viewChips} role="group" aria-label="Visões do CRM">
          {CRM_VIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              style={{ ...s.viewChip, ...(viewFilter === option.id ? s.viewChipActive : {}) }}
              aria-pressed={viewFilter === option.id}
              onClick={() => chooseView(option.id)}
            >
              {option.label} <span style={s.viewChipCount}>{option.id === 'all' && pageMeta.total ? pageMeta.total.toLocaleString('pt-BR') : viewCounts[option.id]}</span>
            </button>
          ))}
        </div>
        <div className="list-controls" style={s.listControls}>
          <button type="button" style={{ ...s.saveViewBtn, ...(filtersOpen ? s.viewChipActive : {}) }} onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen}><SlidersHorizontal size={14} /> Filtros</button>
          {savedViews.length ? (
            <select value="" style={s.viewSelect} onChange={(event) => applySavedView(savedViews.find((item) => item.id === event.target.value))} aria-label="Aplicar visão salva">
              <option value="">Visões salvas</option>
              {savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
          ) : null}
          <button type="button" style={s.saveViewBtn} onClick={saveCurrentView}>Salvar visão</button>
          <label className="sort-field" style={s.sortField}>
            <span>Ordenar</span>
            <select className="sort-select" value={sortBy} style={s.sortSelect} onChange={(event) => { const nextSort = event.target.value; setSortBy(nextSort); setPage(1); load(q, 1, { sortBy: nextSort }); }} aria-label="Ordenar clientes">
              <option value="name">Nome</option>
              <option value="attention">Atenção primeiro</option>
              <option value="open">O.S. abertas</option>
              <option value="contracted">Equipamentos em contrato</option>
              <option value="updated">Atualização recente</option>
            </select>
          </label>
        </div>
      </div>

      {filtersOpen ? (
        <div style={s.advancedFilters} aria-label="Filtros avançados do CRM">
          <label style={s.advancedFilterField}><span>Cidade</span><input style={s.advancedFilterInput} value={advancedFilters.city} onChange={(event) => setAdvancedFilters((current) => ({ ...current, city: event.target.value }))} placeholder="Todas as cidades" /></label>
          <label style={s.advancedFilterField}><span>UF</span><input style={s.advancedFilterInput} value={advancedFilters.state} onChange={(event) => setAdvancedFilters((current) => ({ ...current, state: event.target.value.toUpperCase() }))} maxLength={2} placeholder="Todas" /></label>
          <label style={s.advancedFilterField}><span>Telefone</span><select style={s.advancedFilterInput} value={advancedFilters.hasPhone} onChange={(event) => setAdvancedFilters((current) => ({ ...current, hasPhone: event.target.value }))}><option value="">Todos</option><option value="true">Com telefone</option><option value="false">Sem telefone</option></select></label>
          <label style={s.advancedFilterField}><span>Contrato</span><select style={s.advancedFilterInput} value={advancedFilters.contractStatus} onChange={(event) => setAdvancedFilters((current) => ({ ...current, contractStatus: event.target.value }))}><option value="">Todos</option><option value="active">Contrato ativo</option><option value="inactive">Contrato encerrado</option><option value="none">Sem contrato</option></select></label>
          <label style={s.advancedFilterField}><span>Financeiro</span><select style={s.advancedFilterInput} value={advancedFilters.financialStatus} onChange={(event) => setAdvancedFilters((current) => ({ ...current, financialStatus: event.target.value }))}><option value="">Todos</option><option value="overdue">Títulos vencidos</option><option value="open">Pendências em aberto</option><option value="clear">Sem pendências</option></select></label>
          <div style={s.advancedFilterActions}><button type="button" style={s.secondaryBtn} onClick={() => applyAdvancedFilters({ city: '', state: '', hasPhone: '', contractStatus: '', financialStatus: '' })}>Limpar</button><button type="button" style={s.primaryBtn} onClick={() => applyAdvancedFilters()}>Aplicar filtros</button></div>
        </div>
      ) : null}

      <div className="crm-result-header" style={s.resultHeader}>
        <strong>Exibindo {filteredCustomers.length.toLocaleString('pt-BR')} nesta página de {(pageMeta.total || customers.length).toLocaleString('pt-BR')} clientes</strong>
        {q ? <span>Resultado para “{q}” · {sortLabel(sortBy)}</span> : <span>{sortLabel(sortBy)}</span>}
      </div>

      <div className="crm-customer-grid" style={s.customerGrid}>
        {filteredCustomers.map((customer) => {
          const metrics = customerMetrics.get(customer.id) || getCustomerListMetrics(customer);
          return (
          <article
            key={customer.id}
            className="crm-customer-card"
            style={s.customerCard}
            role="button"
            tabIndex={0}
            onClick={() => openCustomer(customer)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCustomer(customer); } }}
          >
            <div style={s.customerTop}>
              <div style={s.avatar}><Building2 size={20} /></div>
              <div style={{ minWidth: 0 }}>
                <h2 style={s.customerName}>{customer.fantasyName || customer.name || 'Cliente sem nome'}</h2>
                {customer.fantasyName && customer.name !== customer.fantasyName ? <p style={s.legalName}>{customer.name}</p> : null}
              </div>
            </div>
            <div style={s.cardStatusRow}>
              {metrics.openOrders > 0 ? <span style={{ ...s.statusPill, ...s.statusPillWarning }}><ClipboardList size={12} /> {metrics.openOrders} O.S. aberta{metrics.openOrders === 1 ? '' : 's'}</span> : null}
              {metrics.overdue > 0 ? <span style={{ ...s.statusPill, ...s.statusPillDanger }}><CircleDollarSign size={12} /> {metrics.overdue} vencido{metrics.overdue === 1 ? '' : 's'}</span> : null}
              {metrics.contracted > 0 ? <span style={{ ...s.statusPill, ...s.statusPillSuccess }}><ShieldCheck size={12} /> Em contrato</span> : null}
              {metrics.contracted === 0 && metrics.contracts === 0 ? <span style={s.statusPill}><AlertCircle size={12} /> Sem contrato</span> : null}
            </div>
            <div style={s.metaGrid}>
              <Meta icon={<Hash size={14} />} text={customer.cpfCnpj || `ILUX ${customer.externalId || '—'}`} />
              <Meta icon={<Phone size={14} />} text={customer.phone || 'Telefone não informado'} />
              <Meta icon={<MapPin size={14} />} text={joinLocation(customer) || 'Localização não informada'} wide />
            </div>
            <div style={s.cardMetrics} aria-label="Resumo operacional">
              <span><Printer size={13} /> <strong>{metrics.equipments}</strong> equipamentos</span>
              <span><ShieldCheck size={13} /> <strong>{metrics.contracted}</strong> em contrato</span>
              <span><CircleDollarSign size={13} /> <strong>{formatCurrency(metrics.monthlyValue)}</strong>/mês</span>
            </div>
            <div style={s.cardFooter}>
              <div style={s.counts}>
                <span style={s.badge}><Printer size={13} /> {countOf(customer, 'equipments')} equip.</span>
                {hasValue(customer.contractsCount) || Array.isArray(customer.contracts) ? <span style={s.badgeMuted}><FileText size={13} /> {countOf(customer, 'contracts')} contratos</span> : null}
              </div>
              <div style={s.cardActions} onClick={(event) => event.stopPropagation()}>
                {customer.phone ? <button type="button" style={s.iconCardAction} title="Abrir WhatsApp" aria-label={`Abrir WhatsApp de ${customer.fantasyName || customer.name}`} onClick={() => openWhatsApp(customer)}><Send size={14} /></button> : null}
                <button type="button" style={s.cardAction} onClick={() => openCustomer(customer, 'os')}><ClipboardList size={13} /> O.S.</button>
                <button type="button" style={s.openHint} onClick={() => openCustomer(customer)}>Abrir perfil <ChevronRight size={16} /></button>
              </div>
            </div>
          </article>
          );
        })}
        {!loading && customers.length === 0 ? <div style={s.emptyState}>Nenhum cliente encontrado com os filtros informados. Tente outro termo ou limpe a busca.</div> : null}
        {!loading && customers.length > 0 && filteredCustomers.length === 0 ? <div style={s.emptyState}>Nenhum cliente nesta visão. Tente outra visão ou limpe os filtros.</div> : null}
      </div>

      {(pageMeta.hasMore || page > 1) ? (
        <div style={s.pagination} aria-label="Paginação de clientes">
          <button type="button" style={s.paginationBtn} disabled={loading || page <= 1} onClick={() => load(q, page - 1)}>Anterior</button>
          <span>Página <strong>{page}</strong> de <strong>{Math.max(1, Math.ceil((pageMeta.total || customers.length) / (pageMeta.pageSize || CRM_PAGE_SIZE)))}</strong></span>
          <button type="button" style={s.paginationBtn} disabled={loading || !pageMeta.hasMore} onClick={() => load(q, page + 1)}>Próxima</button>
        </div>
      ) : null}

      {selectedCustomer ? (
        <CustomerModal
          customer={selectedCustomer}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          loading={modalLoading}
          relatedLoading={relatedLoading}
          resourceStatus={modalResources}
          error={modalError}
          onRetry={() => openCustomer(selectedCustomer, activeTab)}
          onClose={() => { setSelectedCustomer(null); setActiveTab('overview'); }}
        />
      ) : null}
    </div>
  );
}

export function CrmCustomerProfileModal({ customerId, initialCustomer, initialTab = 'overview', onClose, onOpenConversation, onOpenServiceOrder }) {
  const [customer, setCustomer] = useState(initialCustomer || null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [error, setError] = useState('');
  const [resourceStatus, setResourceStatus] = useState({ base: 'idle', contracts: 'idle', os: 'idle', view360: 'idle' });

  async function loadProfile() {
    if (!customerId) return;
    setLoading(true);
    setRelatedLoading(false);
    setError('');
    setResourceStatus({ base: 'loading', contracts: 'idle', os: 'idle', view360: 'idle' });
    try {
      const response = await getCrmCustomer(customerId);
      const fullCustomer = response.data || initialCustomer;
      setCustomer(fullCustomer);
      setResourceStatus({ base: 'ready', contracts: 'loading', os: 'loading', view360: 'loading' });
      setLoading(false);
      setRelatedLoading(true);

      const [contractsResult, ordersResult, view360Result] = await Promise.allSettled([
        getCrmCustomerContracts(customerId),
        getCrmCustomerServiceOrders(customerId, 25),
        getCrmCustomer360(customerId),
      ]);
      const contracts = contractsResult.status === 'fulfilled' ? contractsResult.value.data?.items || [] : [];
      const serviceOrders = ordersResult.status === 'fulfilled' ? ordersResult.value.data?.items || [] : [];
      const customer360 = view360Result.status === 'fulfilled' ? view360Result.value.data || null : null;
      setResourceStatus({
        base: 'ready',
        contracts: contractsResult.status === 'fulfilled' ? 'ready' : 'error',
        os: ordersResult.status === 'fulfilled' ? 'ready' : 'error',
        view360: view360Result.status === 'fulfilled' ? 'ready' : 'error',
      });
      setCustomer((current) => ({
        ...(current || fullCustomer),
        contracts,
        serviceOrders,
        serviceOrdersPage: ordersResult.status === 'fulfilled' ? ordersResult.value.data : null,
        customer360,
        operationalSummary: {
          ...(current?.operationalSummary || fullCustomer?.operationalSummary || {}),
          contracts: contracts.length,
          activeContracts: contracts.filter(isContractActive).length,
          contractValue: contracts.filter(isContractActive).reduce((total, contract) => total + Number(contract.monthlyValue || contract.value || 0), 0),
          openServiceOrders: serviceOrders.filter((order) => !isOrderClosed(order)).length,
          lastServiceOrderAt: serviceOrders[0]?.openedAt || null,
        },
      }));
      if (contractsResult.status === 'rejected' || ordersResult.status === 'rejected' || view360Result.status === 'rejected') {
        setError('Algumas informações complementares não puderam ser carregadas. Você pode tentar novamente.');
      }
    } catch (requestError) {
      setResourceStatus((current) => ({ ...current, base: 'error' }));
      setError(requestError.code === 'ECONNABORTED'
        ? 'A consulta ao servidor demorou mais que o esperado. Tente novamente.'
        : 'Não foi possível atualizar os dados deste cliente.');
    } finally {
      setLoading(false);
      setRelatedLoading(false);
    }
  }

  useEffect(() => { loadProfile(); }, [customerId]);

  if (!customer) return null;
  return (
    <CustomerModal
      customer={customer}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      loading={loading}
      relatedLoading={relatedLoading}
      resourceStatus={resourceStatus}
      error={error}
      onRetry={loadProfile}
      onClose={onClose}
      onOpenConversation={onOpenConversation}
      onOpenServiceOrder={onOpenServiceOrder}
    />
  );
}

function CustomerModal({ customer, activeTab, setActiveTab, loading, relatedLoading, resourceStatus = {}, error, onRetry, onClose, onOpenConversation, onOpenServiceOrder }) {
  const { can, loading: permissionsLoading } = usePermissions();
  const equipments = arrayOf(customer.equipments);
  const contracts = arrayOf(customer.contracts);
  const serviceOrders = arrayOf(customer.serviceOrders, customer.orders, customer.osHistory);
  const customer360 = customer.customer360 || {};
  const serverFinancialAllowed = customer360.capabilities?.tabs?.financial;
  const serverCanSendFinancial = customer360.capabilities?.actions?.sendFinancialDocuments;
  const financialAllowed = permissionsLoading
    ? null
    : (typeof serverFinancialAllowed === 'boolean' ? serverFinancialAllowed : can('crm.financial.view'));
  const canSendFinancial = !permissionsLoading
    && (typeof serverCanSendFinancial === 'boolean' ? serverCanSendFinancial : can('crm.financial.send'));
  const resourceForTab = { overview: 'view360', contracts: 'contracts', os: 'os', units: 'view360', contacts: 'view360', financial: 'view360' }[activeTab];
  const activeResourceStatus = loading ? 'loading' : (resourceForTab ? resourceStatus[resourceForTab] : 'ready');

  useEffect(() => {
    if (financialAllowed === false && activeTab === 'financial') setActiveTab('overview');
  }, [financialAllowed, activeTab, setActiveTab]);

  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="crm-profile-backdrop" style={s.modalBackdrop} onMouseDown={onClose}>
      <section className="crm-profile-modal" style={s.modal} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="crm-profile-title">
        <header className="crm-profile-header" style={s.modalHeader}>
          <div style={s.modalIdentity}>
            <div style={s.modalAvatar}><Building2 size={22} /></div>
            <div>
              <p style={s.modalKicker}>Cliente ILUX #{customer.externalId || '—'}</p>
              <h2 id="crm-profile-title" style={s.modalTitle}>{customer.fantasyName || customer.name}</h2>
              <div style={s.headerMeta}>
                {customer.cpfCnpj ? <span>{customer.cpfCnpj}</span> : null}
                {customer.phone ? <span>{customer.phone}</span> : null}
                {joinLocation(customer) ? <span>{joinLocation(customer)}</span> : null}
              </div>
            </div>
          </div>
          <button type="button" style={s.closeBtn} onClick={onClose} aria-label="Fechar"><X size={19} /></button>
        </header>

        <nav className="crm-profile-tabs" style={s.tabs} role="tablist" aria-label="Seções do perfil do cliente">
          <div style={s.tabGroup} role="group" aria-label="Operação">
            <span style={s.tabGroupLabel}>Operação</span>
            <Tab active={activeTab === 'overview'} icon={<User size={16} />} label="Resumo" onClick={() => setActiveTab('overview')} />
            {financialAllowed !== false ? <Tab active={activeTab === 'financial'} disabled={financialAllowed === null} icon={<CreditCard size={16} />} label={financialAllowed === null ? 'Financeiro (…)': 'Financeiro'} onClick={() => setActiveTab('financial')} /> : null}
            <Tab active={activeTab === 'equipments'} icon={<Printer size={16} />} label={`Equipamentos (${equipments.length})`} onClick={() => setActiveTab('equipments')} />
            <Tab active={activeTab === 'os'} icon={<ClipboardList size={16} />} label={`O.S. (${resourceStatus.os === 'loading' ? '…' : serviceOrders.length})`} onClick={() => setActiveTab('os')} />
          </div>
          <div style={s.tabGroupSecondary} role="group" aria-label="Relacionamento">
            <span style={s.tabGroupLabel}>Relacionamento</span>
            <Tab active={activeTab === 'contracts'} icon={<FileText size={16} />} label={`Contratos (${resourceStatus.contracts === 'loading' ? '…' : contracts.length})`} onClick={() => setActiveTab('contracts')} />
            <Tab active={activeTab === 'units'} icon={<MapPinned size={16} />} label={`Unidades (${resourceStatus.view360 === 'loading' ? '…' : arrayOf(customer360.units).length})`} onClick={() => setActiveTab('units')} />
            <Tab active={activeTab === 'contacts'} icon={<Phone size={16} />} label={`Contatos (${resourceStatus.view360 === 'loading' ? '…' : arrayOf(customer360.contacts).length})`} onClick={() => setActiveTab('contacts')} />
          </div>
        </nav>

        <div className="crm-profile-body" style={s.modalBody}>
          {activeResourceStatus === 'loading' ? <TabSkeleton tab={activeTab} /> : null}
          {!loading && error ? <div style={s.errorBox}><AlertCircle size={17} /><span style={{ flex: 1 }}>{error}</span><button type="button" style={s.retryBtn} onClick={onRetry}>Tentar novamente</button></div> : null}
          {activeResourceStatus === 'error' ? <ResourceError onRetry={onRetry} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'overview' ? <OverviewTab customer={customer} equipments={equipments} contracts={contracts} serviceOrders={serviceOrders} customer360={customer360} onOpenConversation={onOpenConversation} onOpenServiceOrder={onOpenServiceOrder} setActiveTab={setActiveTab} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'units' ? <UnitsTab units={arrayOf(customer360.units)} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'contacts' ? <ContactsTab contacts={arrayOf(customer360.contacts)} quickActions={customer360.quickActions} onOpenConversation={onOpenConversation} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'equipments' ? <EquipmentsTab equipments={equipments} evolution={arrayOf(customer360.equipmentEvolution)} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'contracts' ? <ContractsTab contracts={contracts} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'financial' && financialAllowed ? <FinancialTab financial={customer360.financial} loading={relatedLoading} customerId={customer.id} ticketId={customer360.quickActions?.ticketId} canSend={canSendFinancial} /> : null}
          {activeResourceStatus === 'ready' && activeTab === 'os' ? <OsTab customerId={customer.id} serviceOrders={serviceOrders} initialPage={customer.serviceOrdersPage} onRefresh={onRetry} /> : null}
        </div>

        <footer style={s.modalFooter}>
          <span><Clock3 size={14} /> Sincronizado em {formatDate(customer360.sync?.lastSyncedAt || customer360.generatedAt || customer.syncedAt || customer.updatedAt) || 'data não informada'}</span>
          <button type="button" style={s.secondaryBtn} onClick={onClose}>Fechar</button>
        </footer>
      </section>
    </div>
  );
}

function OverviewTab({ customer, equipments, contracts, serviceOrders, customer360, onOpenConversation, onOpenServiceOrder, setActiveTab }) {
  const operational = customer.operationalSummary || {};
  const alerts = arrayOf(customer360?.alerts);
  const sla = customer360?.sla || null;
  const activeContracts = pick(operational, 'activeContracts') ?? contracts.filter(isContractActive).length;
  const openOrders = pick(operational, 'openServiceOrders') ?? serviceOrders.filter((order) => !isOrderClosed(order)).length;
  const monthlyValue = Number(operational.monthlyRevenue || 0)
    || Number(operational.contractValue || 0)
    || sumMonthlyValue(contracts);
  return (
    <div style={s.sectionStack}>
      <div style={s.profileStats}>
        <MiniStat icon={<Printer size={18} />} value={pick(operational, 'equipments') ?? equipments.length} label="Equipamentos" />
        <MiniStat icon={<FileText size={18} />} value={activeContracts} label="Contratos ativos" />
        <MiniStat icon={<AlertCircle size={18} />} value={openOrders} label="O.S. em aberto" warning={openOrders > 0} />
        <MiniStat icon={<CircleDollarSign size={18} />} value={formatCurrency(monthlyValue)} label="Valor mensal" />
      </div>
      {customer360?.quickActions ? <QuickActions actions={customer360.quickActions} onOpenConversation={onOpenConversation} onOpenServiceOrder={onOpenServiceOrder} setActiveTab={setActiveTab} /> : null}
      {alerts.length ? <AlertsPanel alerts={alerts} setActiveTab={setActiveTab} /> : (
        customer360?.generatedAt ? <div style={s.healthyBox}><ShieldCheck size={18} /> Nenhum alerta operacional identificado para este cliente.</div> : null
      )}
      {sla ? <SlaPanel sla={sla} setActiveTab={setActiveTab} /> : null}
      <InfoSection title="Identificação" icon={<User size={17} />}>
        <div style={s.infoGrid}>
          <Info label="Razão social" value={customer.name} wide />
          <Info label="Nome fantasia" value={customer.fantasyName} />
          <Info label="Código ILUX" value={customer.externalId} />
          <Info label="CNPJ / CPF" value={customer.cpfCnpj} />
          <Info label="Inscrição estadual" value={pick(customer, 'stateRegistration', 'inscEst', 'ie') || pick(customer.raw || {}, 'INSCEST', 'inscest')} />
        </div>
      </InfoSection>
      <InfoSection title="Contato" icon={<Phone size={17} />}>
        <div style={s.infoGrid}>
          <Info label="Responsável" value={customer.contactName} />
          <Info label="Telefone" value={customer.phone} />
          <Info label="E-mail" value={customer.email} wide />
        </div>
      </InfoSection>
      <InfoSection title="Endereço principal" icon={<MapPin size={17} />}>
        <div style={s.infoGrid}>
          <Info label="Endereço" value={[customer.address, customer.addressNumber].filter(Boolean).join(', ')} wide />
          <Info label="Complemento" value={customer.complement} />
          <Info label="Bairro" value={customer.neighborhood} />
          <Info label="Cidade / UF" value={[customer.city, customer.state].filter(Boolean).join(' / ')} />
          <Info label="CEP" value={customer.zipCode} />
        </div>
      </InfoSection>
      {customer.notes ? <InfoSection title="Observações" icon={<ClipboardList size={17} />}><p style={s.notes}>{customer.notes}</p></InfoSection> : null}
    </div>
  );
}

function QuickActions({ actions, onOpenConversation, onOpenServiceOrder, setActiveTab }) {
  const openInbox = (openOs = false) => {
    if (!actions.ticketId) return;
    if (openOs && onOpenServiceOrder) return onOpenServiceOrder();
    if (!openOs && onOpenConversation) return onOpenConversation();
    window.location.assign(`/inbox?ticketId=${encodeURIComponent(actions.ticketId)}${openOs ? '&openOs=1' : ''}`);
  };
  const printProfile = () => {
    if (setActiveTab) {
      setActiveTab('overview');
      setTimeout(() => window.print(), 50);
    } else {
      window.print();
    }
  };
  return (
    <div className="crm-quick-actions" style={s.quickActions}>
      <div style={s.quickActionsTitle}><strong>Ações rápidas</strong><span>Atalhos para o atendimento</span></div>
      <button type="button" style={s.quickActionBtn} disabled={!actions.canOpenConversation} onClick={() => openInbox(false)}><Send size={16} /> Abrir WhatsApp</button>
      <button type="button" style={s.quickActionPrimary} disabled={!actions.canOpenServiceOrder} onClick={() => openInbox(true)}><ClipboardList size={16} /> Abrir O.S.</button>
      <button type="button" style={s.quickActionBtn} disabled={!actions.address} onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(actions.address)}`, '_blank', 'noopener,noreferrer')}><MapIcon size={16} /> Ver no mapa</button>
      <button type="button" style={s.quickActionBtn} onClick={printProfile}><Printer size={16} /> Imprimir ficha</button>
    </div>
  );
}

const ALERT_CATEGORY_TO_TAB = { financial: 'financial', sla: 'os', recurrence: 'equipments', contract: 'contracts' };

function AlertsPanel({ alerts, setActiveTab }) {
  return (
    <InfoSection title={`Alertas inteligentes (${alerts.length})`} icon={<Siren size={17} />}>
      <div style={s.alertGrid}>
        {alerts.map((alert) => {
          const targetTab = ALERT_CATEGORY_TO_TAB[alert.category];
          const alertStyle = { ...s.smartAlert, ...(targetTab ? s.smartAlertClickable : {}), ...(alert.severity === 'critical' ? s.criticalAlert : alert.severity === 'warning' ? s.warningAlert : s.infoAlert) };
          const content = (
            <>
              <AlertCircle size={17} />
              <div style={s.stackedField}><strong>{alert.title}</strong><span>{alert.description}</span></div>
            </>
          );
          return targetTab ? (
            <button key={alert.id} type="button" style={alertStyle} onClick={() => setActiveTab(targetTab)} title="Ver detalhes">
              {content}
            </button>
          ) : (
            <div key={alert.id} style={alertStyle}>
              {content}
            </div>
          );
        })}
      </div>
    </InfoSection>
  );
}

function SlaPanel({ sla, setActiveTab }) {
  const recurrence = sla.mostRecurringEquipment;
  const goToOrders = setActiveTab ? () => setActiveTab('os') : undefined;
  return (
    <InfoSection title={`Atendimento e SLA — meta de ${sla.targetHours || 24}h`} icon={<ShieldCheck size={17} />}>
      <div style={s.slaGrid}>
        <Metric value={sla.orders30Days ?? 0} label="O.S. nos últimos 30 dias" onClick={goToOrders} />
        <Metric value={formatHours(sla.averageResolutionHours)} label="Tempo médio de solução" onClick={goToOrders} />
        <Metric value={sla.withinSlaPercent === null || sla.withinSlaPercent === undefined ? '—' : `${sla.withinSlaPercent}%`} label="Concluídas dentro do SLA" onClick={goToOrders} />
        <Metric value={sla.overdueOpenOrders ?? 0} label="O.S. fora do prazo" danger={Number(sla.overdueOpenOrders) > 0} onClick={goToOrders} />
      </div>
      {recurrence ? (
        goToOrders ? (
          <button type="button" style={{ ...s.recurrenceBox, ...s.recurrenceBoxClickable }} onClick={goToOrders} title="Ver detalhes">
            <Printer size={17} />
            <div style={s.stackedField}><span>Maior reincidência em 90 dias</span><strong>{recurrence.model || `Equipamento ${recurrence.equipmentExternalId || ''}`} — {recurrence.count} O.S.</strong></div>
          </button>
        ) : (
          <div style={s.recurrenceBox}>
            <Printer size={17} />
            <div style={s.stackedField}><span>Maior reincidência em 90 dias</span><strong>{recurrence.model || `Equipamento ${recurrence.equipmentExternalId || ''}`} — {recurrence.count} O.S.</strong></div>
          </div>
        )
      ) : null}
    </InfoSection>
  );
}

function Metric({ value, label, danger = false, onClick }) {
  const style = { ...s.metricCard, ...(danger ? s.metricDanger : {}), ...(onClick ? s.metricCardClickable : {}) };
  const content = <><strong>{value}</strong><span>{label}</span></>;
  if (onClick) return <button type="button" style={style} onClick={onClick} title="Ver detalhes">{content}</button>;
  return <div style={style}>{content}</div>;
}

function UnitsTab({ units }) {
  if (!units.length) return <Empty icon={<MapPinned size={28} />} title="Nenhuma unidade identificada" text="Os endereços aparecerão após a sincronização dos equipamentos." />;
  return (
    <div style={s.unitsGrid}>
      {units.map((unit, index) => (
        <article key={unit.id || index} style={s.unitCard}>
          <header style={s.unitHeader}>
            <div style={s.unitIcon}><Building2 size={19} /></div>
            <div style={{ ...s.stackedField, flex: 1 }}><span>Unidade {index + 1}</span><strong>{unit.name || 'Unidade principal'}</strong></div>
            <span style={s.unitCount}>{unit.equipmentCount || 0} equip.</span>
          </header>
          <div style={s.unitAddress}><MapPin size={15} /><span>{unitLocation(unit) || 'Endereço não informado'}</span></div>
          {arrayOf(unit.departments).length ? <div style={s.departmentList}>{unit.departments.map((department) => <span key={department}>{department}</span>)}</div> : null}
          <div style={s.unitEquipmentList}>
            {arrayOf(unit.equipments).map((equipment) => (
              <div key={equipment.id || equipment.externalId} style={s.unitEquipment}>
                <Printer size={15} />
                <div style={s.stackedField}><strong>{equipment.model || 'Equipamento sem modelo'}</strong><span>Série: {equipment.serialNumber || 'não informada'} · {equipment.installLocation || equipment.sector || 'setor não informado'}</span></div>
              </div>
            ))}
            {!arrayOf(unit.equipments).length ? <span style={s.mutedText}>Nenhum equipamento nesta unidade.</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function ContactsTab({ contacts, quickActions, onOpenConversation }) {
  if (!contacts.length) return <Empty icon={<Phone size={28} />} title="Nenhum contato identificado" text="Os responsáveis aparecerão conforme os cadastros do iLux e WhatsApp forem vinculados." />;
  return (
    <div style={s.contactsGrid}>
      {contacts.map((contact) => (
        <article key={contact.id} style={s.contactCard360}>
          <div style={s.contactAvatar}><User size={18} /></div>
          <div style={s.contactBody}>
            <span style={s.contactRole}>{contact.role}</span>
            <strong>{contact.name || 'Nome não informado'}</strong>
            <small>{contact.source}</small>
            <div style={s.contactChannels}>
              {contact.phone ? <span><Phone size={13} /> {contact.phone}</span> : null}
              {contact.email ? <span><Mail size={13} /> {contact.email}</span> : null}
            </div>
            <CrmContactActions contact={contact} quickActions={quickActions} onOpenConversation={onOpenConversation} />
          </div>
        </article>
      ))}
    </div>
  );
}

function FinancialTab({ financial, loading, customerId, ticketId, canSend = false }) {
  const [selected, setSelected] = useState(null);
  const [documentsData, setDocumentsData] = useState(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState('');
  // Keyed by document type (invoice/statement/boleto) so a slow request for one
  // document (e.g. waiting on the iLux agent) never blocks clicking the others.
  const [documentActions, setDocumentActions] = useState({});
  const [checkedDocuments, setCheckedDocuments] = useState([]);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [financeQuery, setFinanceQuery] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const selectedReceivableId = selected?.externalId;

  useEffect(() => {
    if (!selectedReceivableId) {
      setDocumentsData(null);
      setDocumentsError('');
      setCheckedDocuments([]);
      setShowSendConfirmation(false);
      return;
    }
    let active = true;
    setDocumentsLoading(true);
    setDocumentsError('');
    getCrmReceivableDocuments(customerId, selectedReceivableId, ticketId)
      .then((response) => {
        if (!active) return;
        const payload = response.data || {};
        setDocumentsData(payload);
        setCheckedDocuments(normalizeBillingDocuments(payload.documents, selected).filter((document) => document.available !== false).map((document) => document.type));
      })
      .catch((error) => {
        if (!active) return;
        setDocumentsData(null);
        setDocumentsError(error.response?.data?.error || 'Não foi possível consultar os documentos desta cobrança.');
      })
      .finally(() => { if (active) setDocumentsLoading(false); });
    return () => { active = false; };
  }, [customerId, selectedReceivableId, ticketId]);

  // Memoizados porque uma lista de títulos financeiros pode acumular anos de NFs
  // e este componente re-renderiza a cada interação local (seleção, checkboxes,
  // envio) sem que os dados financeiros em si tenham mudado.
  const items = useMemo(() => arrayOf(financial?.items), [financial?.items]);
  const statusCounts = useMemo(() => ({
    all: items.length,
    overdue: items.filter((item) => item.status === 'overdue').length,
    open: items.filter((item) => item.status !== 'overdue' && item.status !== 'paid').length,
    paid: items.filter((item) => item.status === 'paid').length,
  }), [items]);
  const visibleItems = useMemo(() => items.filter((item) => {
    const statusMatches = statusFilter === 'all' || (statusFilter === 'open'
      ? item.status !== 'overdue' && item.status !== 'paid'
      : item.status === statusFilter);
    const searchable = [item.invoiceNumber, item.externalId, item.billingType, item.paymentMethod, item.ourNumber].filter(Boolean).join(' ').toLowerCase();
    const queryMatches = !financeQuery.trim() || searchable.includes(financeQuery.trim().toLowerCase());
    const referenceDate = String(item.issuedAt || item.dueAt || '').slice(0, 10);
    const periodMatches = (!periodStart || referenceDate >= periodStart) && (!periodEnd || referenceDate <= periodEnd);
    return statusMatches && queryMatches && periodMatches;
  }), [items, statusFilter, financeQuery, periodStart, periodEnd]);

  // O financeiro é aberto direto (atalho "Financeiro" na ficha do contato), então
  // pode chegar aqui antes da visão 360 terminar de carregar em segundo plano.
  // Sem isso, o usuário via "Acesso restrito" por um instante antes dos dados reais.
  if (!financial && loading) return <div style={s.loadingInline}><RefreshCw size={16} className="spin" /> Carregando dados financeiros...</div>;
  if (!financial?.allowed) return <Empty icon={<CreditCard size={28} />} title="Acesso financeiro restrito" text={financial?.reason || 'Esta área está disponível apenas para administradores.'} />;
  if (!financial.synchronized) return <Empty icon={<RefreshCw size={28} />} title="Aguardando sincronização financeira" text="Atualize o agente Firebird para carregar os títulos recentes do iLux." />;

  const documents = normalizeBillingDocuments(documentsData?.documents, selected);
  const delivery = documentsData?.delivery || {};

  async function reloadDocuments() {
    if (!selectedReceivableId) return;
    setDocumentsLoading(true);
    setDocumentsError('');
    try {
      const response = await getCrmReceivableDocuments(customerId, selectedReceivableId, ticketId);
      setDocumentsData(response.data || {});
    } catch (error) {
      setDocumentsError(error.response?.data?.error || 'Não foi possível consultar os documentos desta cobrança.');
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function accessDocument(billingDocument, mode) {
    if (!billingDocument?.type || billingDocument.available === false || documentActions[billingDocument.type]) return;
    const preview = mode === 'open' ? window.open('about:blank', '_blank') : null;
    if (preview) {
      preview.opener = null;
      // O agente pode levar alguns segundos para localizar o PDF oficial (ou
      // gerá-lo sob demanda). Sem isso, a aba fica em branco nesse meio tempo e
      // quem não conhece o sistema acha que deu erro ou que não vai abrir nada.
      preview.document.write(documentLoadingPageHtml(billingDocument.label));
      preview.document.close();
    }
    setDocumentActions((current) => ({ ...current, [billingDocument.type]: mode }));
    try {
      let prepared = billingDocument;
      if (!billingDocument.mediaUrl || billingDocument.status !== 'ready') {
        const response = await prepareCrmReceivableDocument(customerId, selectedReceivableId, billingDocument.type);
        prepared = { ...billingDocument, ...(response.data || {}) };
        setDocumentsData((current) => ({
          ...(current || {}),
          documents: normalizeBillingDocuments(current?.documents, selected).map((item) => item.type === billingDocument.type ? prepared : item),
        }));
      }
      const mediaUrl = getMediaUrl(prepared.mediaUrl);
      if (!mediaUrl) throw new Error(prepared.status === 'pending'
        ? 'O documento está sendo preparado pelo agente iLux. Tente novamente em instantes.'
        : 'O servidor não devolveu o arquivo solicitado.');
      if (mode === 'open') {
        if (preview) preview.location.replace(mediaUrl);
        else window.open(mediaUrl, '_blank', 'noopener,noreferrer');
      } else {
        const fileResponse = await fetch(mediaUrl);
        if (!fileResponse.ok) throw new Error('O documento não pôde ser baixado.');
        const objectUrl = URL.createObjectURL(await fileResponse.blob());
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = prepared.fileName || `${billingDocument.label} NF ${selected.invoiceNumber || selected.externalId}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (error) {
      if (preview) preview.close();
      toast.error(error.response?.data?.error || error.message || 'Não foi possível recuperar o documento.');
    } finally {
      setDocumentActions((current) => {
        const next = { ...current };
        delete next[billingDocument.type];
        return next;
      });
    }
  }

  function requestSend(documentType) {
    setCheckedDocuments(documentType ? [documentType] : documents.filter((document) => document.available !== false).map((document) => document.type));
    setShowSendConfirmation(true);
  }

  function toggleDocument(documentType) {
    setCheckedDocuments((current) => current.includes(documentType)
      ? current.filter((type) => type !== documentType)
      : [...current, documentType]);
  }

  async function confirmSend() {
    if (!checkedDocuments.length || !delivery.available || sendLoading) return;
    setSendLoading(true);
    try {
      const response = await sendCrmReceivableDocuments(customerId, selectedReceivableId, {
        documentTypes: checkedDocuments,
        ...(delivery.ticketId ? { ticketId: delivery.ticketId } : {}),
      });
      const sentCount = response.data?.documents?.length || checkedDocuments.length;
      toast.success(`${sentCount} documento(s) reenviado(s) pelo WhatsApp e registrado(s) na conversa.`);
      setShowSendConfirmation(false);
      await reloadDocuments();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível reenviar os documentos pelo WhatsApp.');
    } finally {
      setSendLoading(false);
    }
  }

  return (
    <div style={s.sectionStack}>
      <div style={s.financialStats}>
        <Metric value={formatCurrency(financial.totalOpen)} label="Saldo em aberto" />
        <Metric value={formatCurrency(financial.overdueAmount)} label={`${financial.overdueCount || 0} título(s) vencido(s)`} danger={Number(financial.overdueAmount) > 0} />
        <Metric value={financial.nextReceivable ? formatShortDate(financial.nextReceivable.dueAt) : '—'} label="Próximo vencimento" />
        <Metric value={financial.lastPayment ? formatShortDate(financial.lastPayment.paidAt) : '—'} label="Último pagamento" />
      </div>
      <div style={s.financeFilterRow} role="tablist" aria-label="Filtrar títulos por situação">
        {[
          { id: 'all', label: 'Todos' },
          { id: 'overdue', label: 'Vencidos' },
          { id: 'open', label: 'Em aberto' },
          { id: 'paid', label: 'Pagos' },
        ].map((filter) => (
          <button
            key={filter.id}
            type="button"
            role="tab"
            aria-selected={statusFilter === filter.id}
            style={{ ...s.financeFilterChip, ...(statusFilter === filter.id ? s.financeFilterChipActive : {}) }}
            onClick={() => setStatusFilter(filter.id)}
          >
            {filter.label} <span style={s.financeFilterCount}>{statusCounts[filter.id]}</span>
          </button>
        ))}
      </div>
      <div style={s.financeSearchBar}>
        <label style={s.financeSearchField}><Search size={15} /><input value={financeQuery} onChange={(event) => setFinanceQuery(event.target.value)} placeholder="Buscar NF, título, contrato ou nosso número" aria-label="Buscar títulos financeiros" /></label>
        <label style={s.financePeriodField}><span>De</span><input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
        <label style={s.financePeriodField}><span>Até</span><input type="date" value={periodEnd} min={periodStart || undefined} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        {(financeQuery || periodStart || periodEnd) ? <button type="button" style={s.clearFinanceFilters} onClick={() => { setFinanceQuery(''); setPeriodStart(''); setPeriodEnd(''); }}>Limpar</button> : null}
      </div>
      <div style={s.financeList}>
        {!visibleItems.length ? (
          <div style={s.emptyState}>Nenhum título {statusFilter === 'overdue' ? 'vencido' : statusFilter === 'open' ? 'em aberto' : statusFilter === 'paid' ? 'pago' : ''} para este cliente.</div>
        ) : null}
        {visibleItems.map((item) => (
          <button key={item.externalId} type="button" style={s.financeItem} onClick={() => setSelected(item)} aria-label={`Ver detalhes da NF ${item.invoiceNumber || item.externalId}`}>
            <div style={s.financeIcon}><CreditCard size={17} /></div>
            <div style={s.financeMain}>
              <strong>{item.invoiceNumber ? `NF ${item.invoiceNumber}` : `Título #${item.externalId}`}</strong>
              <span>Emissão: {formatShortDate(item.issuedAt) || '—'} · Vencimento: {formatShortDate(item.dueAt) || '—'}</span>
              <small>{[item.billingType, item.paymentMethod].filter(Boolean).join(' · ') || 'Detalhes financeiros'}</small>
            </div>
            <div style={s.financeValue}>
              <div style={s.financeValueDetails}><strong>{formatCurrency(item.value)}</strong><span style={financeStatusStyle(item.status)}>{financeStatus(item.status)}</span></div>
              <ChevronRight size={16} />
            </div>
          </button>
        ))}
      </div>
      {selected ? (
        <div style={s.financeDetailBackdrop} onMouseDown={() => setSelected(null)}>
          <section className="crm-finance-detail" style={s.financeDetailModal} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="finance-detail-title">
            <header style={s.financeDetailHeader}>
              <div>
                <p style={s.detailKicker}>Título #{selected.externalId}</p>
                <h3 id="finance-detail-title" style={s.financeDetailTitle}>{selected.invoiceNumber ? `Nota fiscal ${selected.invoiceNumber}` : 'Detalhes do título'}</h3>
              </div>
              <button type="button" style={s.closeBtn} onClick={() => setSelected(null)} aria-label="Fechar detalhes"><X size={18} /></button>
            </header>

            <div style={s.financeDetailBody}>
              <div style={s.financeDetailSummary}>
                <div style={s.stackedField}><span>Valor</span><strong>{formatCurrency(selected.invoiceValue || selected.value)}</strong></div>
                <div style={s.stackedField}><span>Situação</span><strong style={financeStatusStyle(selected.status)}>{financeStatus(selected.status)}</strong></div>
              </div>
              <div style={s.financeDetailGrid}>
                <Info label="Emissão" value={formatShortDate(selected.issuedAt)} />
                <Info label="Vencimento" value={formatShortDate(selected.dueAt)} />
                <Info label="Tipo de faturamento" value={selected.billingType} />
                <Info label="Período faturado" value={formatBillingPeriod(selected.billingPeriod)} />
                <Info label="Forma de pagamento" value={selected.paymentMethod} />
                <Info label="Situação do boleto" value={selected.boletoStatus} />
                <Info label="Nosso número" value={selected.ourNumber} />
                <Info label="Contrato ILUX" value={selected.contractExternalId} />
              </div>
              {selected.digitableLine ? (
                <div style={s.digitableLineBox}><span>Linha digitável</span><strong>{selected.digitableLine}</strong></div>
              ) : null}
              {selected.invoiceNotes ? (
                <div style={s.invoiceNotes}><span>Observações da NF</span><p>{selected.invoiceNotes}</p></div>
              ) : null}

              <section style={s.billingDocumentsSection} aria-labelledby="billing-documents-title">
                <div style={s.billingDocumentsHeader}>
                  <div>
                    <span style={s.detailKicker}>Pacote financeiro</span>
                    <h4 id="billing-documents-title" style={s.billingDocumentsTitle}><Files size={18} /> Documentos da cobrança</h4>
                  </div>
                  <button type="button" style={s.smallSecondaryBtn} onClick={reloadDocuments} disabled={documentsLoading}>
                    <RefreshCw size={14} className={documentsLoading ? 'spin' : ''} /> Atualizar
                  </button>
                </div>

                {documentsError ? <div style={s.documentError}><AlertCircle size={16} /><span>{documentsError}</span></div> : null}
                {documentsLoading && !documentsData ? <div style={s.documentsLoading}><RefreshCw size={16} className="spin" /> Consultando NF, demonstrativo e boleto no iLux...</div> : null}

                <div style={s.documentList}>
                  {documents.map((document) => {
                    const busy = Boolean(documentActions[document.type]);
                    return (
                      <article className="crm-document-card" key={document.type} style={{ ...s.documentCard, ...(document.available === false ? s.documentUnavailable : {}) }}>
                        <label style={s.documentSelect}>
                          {canSend ? <input
                              type="checkbox"
                              checked={checkedDocuments.includes(document.type)}
                              onChange={() => toggleDocument(document.type)}
                              disabled={document.available === false}
                              aria-label={`Selecionar ${document.label}`}
                            /> : null}
                          <span style={s.documentIcon}>{billingDocumentIcon(document.type)}</span>
                          <span style={s.documentIdentity}>
                            <strong>{document.label}</strong>
                            <small style={{ ...s.documentStatusBadge, ...billingDocumentStatusStyle(document) }}>{billingDocumentStatus(document)}</small>
                            {document.fileName ? <span title={document.fileName}>{document.fileName}</span> : null}
                          </span>
                        </label>
                        <div className="crm-document-actions" style={s.documentActions}>
                          <button type="button" title={`Visualizar ${document.label}`} style={s.iconActionBtn} disabled={document.available === false || busy} onClick={() => accessDocument(document, 'open')}>
                            {documentActions[document.type] === 'open' ? <RefreshCw size={15} className="spin" /> : <Eye size={15} />}
                          </button>
                          <button type="button" title={`Baixar ${document.label}`} style={s.iconActionBtn} disabled={document.available === false || busy} onClick={() => accessDocument(document, 'download')}>
                            {documentActions[document.type] === 'download' ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}
                          </button>
                          {canSend ? <button type="button" title={`Reenviar ${document.label} pelo WhatsApp`} style={s.documentSendBtn} disabled={document.available === false || busy} onClick={() => requestSend(document.type)}><Send size={14} /> Reenviar</button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {canSend ? <button type="button" style={s.packageSendBtn} disabled={!documents.some((document) => document.available !== false)} onClick={() => requestSend()}>
                  <Send size={16} /> Reenviar pacote pelo WhatsApp
                </button> : <div style={s.permissionNotice}><ShieldCheck size={15} /> Você pode consultar e baixar documentos; o reenvio requer permissão financeira.</div>}
              </section>

              {showSendConfirmation ? (
                <section style={s.deliveryConfirmation} aria-label="Confirmar reenvio pelo WhatsApp">
                  <div style={s.deliveryTitle}><ShieldCheck size={17} /><strong>Confirme o destino antes de enviar</strong></div>
                  <div style={s.deliveryGrid}>
                    <Info label="Telefone" value={delivery.phone} />
                    <Info label="Instância" value={delivery.instanceName || delivery.instanceId} />
                    <Info label="Conversa" value={delivery.ticketId ? `#${delivery.ticketId}` : 'Nenhuma conversa ativa'} />
                    <Info label="Documentos" value={`${checkedDocuments.length} selecionado(s)`} />
                  </div>
                  {!delivery.available ? <div style={s.deliveryWarning}><AlertCircle size={15} /> {delivery.unavailableReason || 'Abra uma conversa com este cliente em uma instância conectada antes de reenviar.'}</div> : null}
                  <div style={s.deliveryActions}>
                    <button type="button" style={s.secondaryBtn} onClick={() => setShowSendConfirmation(false)} disabled={sendLoading}>Cancelar</button>
                    <button type="button" style={s.primaryBtn} onClick={confirmSend} disabled={!delivery.available || !checkedDocuments.length || sendLoading}>
                      {sendLoading ? <RefreshCw size={16} className="spin" /> : <Send size={16} />} {sendLoading ? 'Reenviando...' : `Reenviar ${checkedDocuments.length} documento(s)`}
                    </button>
                  </div>
                </section>
              ) : null}
            </div>

            <footer style={s.financeDetailFooter}>
              <button type="button" style={s.secondaryBtn} onClick={() => setSelected(null)}>Fechar</button>
              <span style={s.noBoletoLabel}>Os envios ficam registrados no histórico da conversa.</span>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function EquipmentsTab({ equipments, evolution }) {
  const [selectedId, setSelectedId] = useState(equipments[0]?.id || null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const visible = useMemo(() => filterCrmEquipments(equipments, statusFilter)
    .filter((equipment) => searchableEquipment(equipment).includes(filter.toLowerCase())), [equipments, filter, statusFilter]);
  const selected = visible.find((equipment) => equipment.id === selectedId) || visible[0] || null;

  if (!equipments.length) return <Empty icon={<Printer size={28} />} title="Nenhum equipamento" text="Este cliente não possui equipamentos vinculados no CRM." />;

  return (
    <div className="crm-equipment-layout" style={s.equipmentLayout}>
      <aside style={s.equipmentAside}>
        <div style={s.innerSearch}><Search size={16} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Modelo, série ou local" /></div>
        <CrmEquipmentFilters equipments={equipments} value={statusFilter} onChange={setStatusFilter} />
        <div style={s.equipmentList}>
          {visible.map((equipment) => (
            <button key={equipment.id || equipment.externalId} type="button" style={{ ...s.equipmentCard, ...(selected?.id === equipment.id ? s.activeEquipmentCard : {}) }} onClick={() => setSelectedId(equipment.id)}>
              <div style={s.equipmentCardTop}>
                <strong>{equipment.model || equipment.description || 'Equipamento sem modelo'}</strong>
                <span style={equipment.isActive === false ? s.inactiveDot : s.activeDot}>{equipment.isActive === false ? 'Inativo' : 'Ativo'}</span>
              </div>
              <span>Série: {equipment.serialNumber || 'não informada'}</span>
              <small><MapPin size={13} /> {equipmentLocation(equipment) || 'Local não informado'}</small>
            </button>
          ))}
          {!visible.length ? <div style={s.noFilterResult}>Nenhum equipamento corresponde à busca.</div> : null}
        </div>
      </aside>
      {selected ? <EquipmentDetail equipment={selected} evolution={evolution.find((item) => String(item.equipmentExternalId) === String(selected.externalId))} /> : null}
    </div>
  );
}

function EquipmentDetail({ equipment, evolution }) {
  return (
    <div style={s.detailPanel}>
      <div style={s.detailHeader}>
        <div style={{ minWidth: 0 }}><p style={s.detailKicker}>Equipamento ILUX #{equipment.externalId || '—'}</p><h3 style={s.detailTitle}>{equipment.model || 'Equipamento sem modelo'}</h3></div>
        <span style={equipment.isActive === false ? s.statusInactive : s.statusActive}>{equipment.isActive === false ? 'Inativo' : 'Ativo'}</span>
      </div>
      <InfoSection title="Identificação" icon={<Printer size={17} />} compact>
        <div style={s.infoGrid}>
          <Info label="Fabricante" value={equipment.manufacturer} />
          <Info label="Modelo" value={equipment.model} />
          <Info label="Número de série" value={equipment.serialNumber} />
          <Info label="Patrimônio" value={equipment.assetTag} />
          <Info label="Tipo" value={equipment.type} />
          <Info label="Contrato ILUX" value={equipment.contractExternalId} />
        </div>
      </InfoSection>
      <div style={s.locationPanel}>
        <div style={s.locationIcon}><MapPin size={20} /></div>
        <div style={s.stackedField}><span>Localização do equipamento</span><strong>{equipmentLocation(equipment) || 'Não informada'}</strong></div>
      </div>
      <InfoSection title="Detalhes do local" icon={<Building2 size={17} />} compact>
        <div style={s.infoGrid}>
          <Info label="Departamento / Setor" value={pick(equipment, 'department', 'sector')} />
          <Info label="Local de instalação" value={equipment.installLocation} />
          <Info label="Complemento" value={equipment.complement} />
          <Info label="Telefone local" value={equipment.phone} />
          <Info label="Endereço" value={equipment.address} wide />
          <Info label="Cidade / UF" value={[equipment.city, equipment.state].filter(Boolean).join(' / ')} />
        </div>
      </InfoSection>
      <EquipmentEvolution evolution={evolution} />
      <RawDetails title="Ver campos técnicos deste equipamento" raw={equipment.raw} />
    </div>
  );
}

function EquipmentEvolution({ evolution }) {
  if (!evolution) return null;
  const currentMeter = evolution.currentMeter && typeof evolution.currentMeter === 'object' && !Array.isArray(evolution.currentMeter)
    ? evolution.currentMeter
    : {};
  const usageCounters = currentMeter.usageCounters && typeof currentMeter.usageCounters === 'object' && !Array.isArray(currentMeter.usageCounters)
    ? currentMeter.usageCounters
    : {};
  const usageEntries = Object.entries(usageCounters).slice(0, 6);
  const hasCurrentMeter = currentMeter.pageCounter !== null && currentMeter.pageCounter !== undefined
    || usageEntries.length > 0;
  const formatCounterLabel = (value) => String(value || '').replace(/[_-]+/g, ' ');
  return (
    <InfoSection title="Evolução e manutenção" icon={<Gauge size={17} />} compact>
      {hasCurrentMeter ? (
        <div style={s.currentMeterPanel} aria-label="Contador atual do equipamento">
          <div style={s.currentMeterHeader}>
            <div>
              <span style={s.currentMeterLabel}>Contador atual</span>
              <strong style={s.currentMeterValue}>
                {currentMeter.pageCounter !== null && currentMeter.pageCounter !== undefined
                  ? Number(currentMeter.pageCounter).toLocaleString('pt-BR')
                  : '—'}
              </strong>
            </div>
            {currentMeter.source ? <span style={s.currentMeterSource}>{currentMeter.source}</span> : null}
          </div>
          {usageEntries.length ? (
            <div style={s.currentMeterCounters}>
              {usageEntries.map(([key, value]) => (
                <span key={key} style={s.counterChip}>
                  <b>{formatCounterLabel(key)}</b> {Number(value).toLocaleString('pt-BR')}
                </span>
              ))}
            </div>
          ) : null}
          <small style={s.mutedText}>
            Leitura: {currentMeter.readAt ? new Date(currentMeter.readAt).toLocaleString('pt-BR') : 'sem data'}
          </small>
        </div>
      ) : null}
      <div style={s.meterGrid}>
        {arrayOf(evolution.meters).map((meter) => (
          <div key={meter.externalId || meter.meterCode} style={s.meterCard}>
            <span>{meter.meterCode || 'Medidor'}</span>
            <strong>{Number(meter.currentValue || 0).toLocaleString('pt-BR')}</strong>
            <small>Anterior: {Number(meter.previousValue || 0).toLocaleString('pt-BR')} · {formatShortDate(meter.currentReadingAt) || 'sem data'}</small>
          </div>
        ))}
        {!arrayOf(evolution.meters).length ? <span style={s.mutedText}>Aguardando sincronização dos contadores.</span> : null}
      </div>
      <div style={s.maintenanceSummary}>
        <div style={s.stackedField}><span>O.S. registradas</span><strong>{evolution.serviceOrderCount || 0}</strong></div>
        <div style={s.stackedField}><span>Última manutenção</span><strong>{evolution.lastMaintenance ? formatShortDate(evolution.lastMaintenance.closedAt || evolution.lastMaintenance.attendedAt) : 'Não registrada'}</strong></div>
      </div>
      {arrayOf(evolution.technicalMentions).length ? (
        <div style={s.technicalMentions}>
          <strong><PackageSearch size={15} /> Peças e suprimentos mencionados nas O.S.</strong>
          {evolution.technicalMentions.map((mention, index) => <p key={`${mention.orderNumber}-${index}`}><b>O.S. #{mention.orderNumber}</b> — {mention.description}</p>)}
        </div>
      ) : null}
    </InfoSection>
  );
}

function ContractsTab({ contracts }) {
  if (!contracts.length) return <Empty icon={<FileText size={28} />} title="Nenhum contrato" text="Não há contratos sincronizados para este cliente." />;
  return (
    <div style={s.listStack}>
      {contracts.map((contract, index) => {
        const active = isContractActive(contract);
        const equipmentCount = Number(pick(contract, 'equipmentCount', 'equipmentsCount') || contract.equipments?.length || 0);
        const pageFranchise = Number(pick(contract, 'pageFranchise') || 0);
        const overageMin = Number(pick(contract, 'overageRateMin') || 0);
        const overageMax = Number(pick(contract, 'overageRateMax') || 0);
        const overageLabel = overageMax <= 0
          ? '—'
          : overageMin === overageMax
            ? `${formatCurrency(overageMax)} / página`
            : `${formatCurrency(overageMin)} a ${formatCurrency(overageMax)} / página`;
        const billingModeLabel = { fixo: 'Fixo', contador: 'Por contador', misto: 'Misto' }[pick(contract, 'billingMode')] || '—';
        return (
          <article key={contract.id || contract.externalId || index} style={s.contractCard}>
            <div style={s.contractHeader}>
              <div style={s.contractIcon}><FileText size={19} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={s.detailKicker}>Contrato ILUX #{pick(contract, 'contractNumber', 'number', 'externalId', 'seqContrato') || '—'}</p>
                <h3 style={s.contractTitle}>{pick(contract, 'name', 'typeName', 'contractType', 'type', 'description') || 'Contrato de equipamentos'}</h3>
              </div>
              <span style={active ? s.statusActive : s.statusInactive}>{active ? 'Ativo' : 'Inativo'}</span>
            </div>
            <div style={s.contractGrid}>
              <Info label="Vigência" value={formatPeriod(pick(contract, 'startDate', 'startsAt'), pick(contract, 'endDate', 'endsAt'))} />
              <Info label="Valor mensal" value={formatCurrency(pick(contract, 'monthlyValue', 'value', 'amount'))} />
              <Info label="Valor fixo" value={formatCurrency(pick(contract, 'fixedValue'))} />
              <Info label="Franquia" value={formatCurrency(pick(contract, 'franchiseValue'))} />
              <Info label="Franquia de páginas" value={pageFranchise > 0 ? `${pageFranchise.toLocaleString('pt-BR')} páginas` : 'Sem franquia'} />
              <Info label="Valor do excedente" value={overageLabel} />
              <Info label="Faturamento" value={billingModeLabel} />
              <Info label="Equipamentos" value={equipmentCount > 0 ? `${equipmentCount} vinculado${equipmentCount === 1 ? '' : 's'}` : 'Vínculo não identificado'} />
              <Info label="Tipo" value={pick(contract, 'typeName', 'contractType', 'type')} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function OsTab({ customerId, serviceOrders, initialPage, onRefresh }) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState(serviceOrders || []);
  const [page, setPage] = useState(initialPage || {});
  const [loadingMore, setLoadingMore] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  // Memoizado: o histórico de O.S. pode acumular anos de chamados e o filtro não
  // deve ser refeito a cada envio ao gestor (que só altera sendingId).
  useEffect(() => {
    setOrders(serviceOrders || []);
    setPage(initialPage || {});
  }, [serviceOrders, initialPage]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orders.filter((order) => {
      const statusMatches = status === 'all' || (status === 'closed' ? isOrderClosed(order) : !isOrderClosed(order));
      const searchable = [order.number, order.externalId, order.typeName, order.serviceType, order.type, order.osType, order.defect, order.description, order.problem, order.reportedIssue, order.chamado, order.equipmentModel, order.equipment, order.model, order.technicianName, order.technician, order.assignedTo].filter(Boolean).join(' ').toLowerCase();
      return statusMatches && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [orders, query, status]);

  async function loadMore() {
    if (!customerId || loadingMore || !page.hasMore) return;
    setLoadingMore(true);
    try {
      const response = await getCrmCustomerServiceOrders(customerId, { limit: page.limit || 25, offset: page.nextOffset ?? orders.length });
      const next = response.data || {};
      const seen = new Set();
      const merged = [...orders, ...arrayOf(next.items)].filter((order) => {
        const key = String(order.id || order.externalId || order.number || JSON.stringify(order));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setOrders(merged);
      setPage(next);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível carregar mais O.S.');
    } finally {
      setLoadingMore(false);
    }
  }

  function openPdf(order) {
    const identifier = order.id || order.externalId || order.number;
    if (!identifier) return;
    const token = encodeURIComponent(localStorage.getItem('token') || '');
    window.open(`${BACKEND_URL}/api/os/${encodeURIComponent(identifier)}/pdf?token=${token}`, '_blank', 'noopener,noreferrer');
  }

  async function sendToManager(order) {
    const identifier = order.id || order.externalId || order.number;
    if (!identifier || sendingId) return;
    setSendingId(identifier);
    try {
      const { data } = await sendOSManagerCopy(identifier);
      toast.success(`O.S. ${data.externalId} enviada ao gestor como ${data.filename}.`);
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível enviar a O.S. ao gestor.');
    } finally {
      setSendingId(null);
    }
  }

  if (!orders.length) return <Empty icon={<ClipboardList size={28} />} title="Nenhuma O.S. sincronizada" text="O histórico aparecerá aqui assim que a sincronização incremental importar os chamados do ILUX." />;
  return (
    <div style={s.sectionStack}>
      <div style={s.osToolbar}>
        <div style={s.toolbarTitle}><strong>Histórico de ordens de serviço</strong><span>{page.total ?? orders.length} registros sincronizados{page.hasMore ? ` · exibindo ${orders.length}` : ''}</span></div>
        <label style={s.osSearchField}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar número, equipamento, defeito ou técnico" aria-label="Buscar ordens de serviço" /></label>
        <div style={s.filterGroup}>
          {[['all', 'Todas'], ['open', 'Abertas'], ['closed', 'Fechadas']].map(([value, label]) => <button key={value} type="button" style={{ ...s.filterBtn, ...(status === value ? s.activeFilterBtn : {}) }} onClick={() => setStatus(value)}>{label}</button>)}
        </div>
      </div>
      <div style={s.osList}>
        {filtered.map((order, index) => {
          const closed = isOrderClosed(order);
          const identifier = order.id || order.externalId || order.number;
          const printable = /^\d+$/.test(String(order.externalId || order.number || ''))
            && order.status !== 'ERRO_INTEGRACAO';
          const sending = sendingId === identifier;
          return (
            <article key={order.id || order.externalId || index} style={s.osCard}>
              <div style={s.osStatusRail} />
              <div style={s.osNumber}><span>O.S.</span><strong>#{pick(order, 'number', 'externalId', 'seqos', 'sequence') || '—'}</strong><small>{formatShortDate(pick(order, 'openedAt', 'createdAt', 'date', 'dtAbertura'))}</small></div>
              <div style={s.osContent}>
                <div style={s.osTitleRow}><strong>{pick(order, 'typeName', 'serviceType', 'type', 'osType') || 'Atendimento técnico'}</strong><span style={closed ? s.statusClosed : s.statusOpen}>{closed ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}{closed ? 'Fechada' : 'Em aberto'}</span></div>
                <p>{pick(order, 'defect', 'description', 'problem', 'reportedIssue', 'chamado') || 'Defeito não informado'}</p>
                <div style={s.osMeta}>
                  <span><Printer size={13} /> {pick(order, 'equipmentModel', 'equipment', 'model') || `Equip. ${pick(order, 'equipmentExternalId', 'equipmentId', 'cdequipamento') || '—'}`}</span>
                  <span><Wrench size={13} /> {pick(order, 'technicianName', 'technician', 'assignedTo') || 'Técnico não informado'}</span>
                  {pick(order, 'closedAt', 'finishedAt') ? <span><CalendarDays size={13} /> Fechada em {formatDate(pick(order, 'closedAt', 'finishedAt'))}</span> : null}
                </div>
                {closed && pick(order, 'resolution', 'closingNotes', 'solution', 'fechamento', 'closing') ? <div style={s.resolution}><strong>Fechamento:</strong> {pick(order, 'resolution', 'closingNotes', 'solution', 'fechamento', 'closing')}</div> : null}
                <div style={s.osActions}>
                  <button type="button" style={s.osActionBtn} disabled={!printable} title={printable ? '' : 'Aguardando confirmacao do iLux'} onClick={() => openPdf(order)}><FileText size={14} /> Abrir O.S. / Reimprimir</button>
                  <button type="button" style={s.osActionPrimary} disabled={!printable || Boolean(sendingId)} onClick={() => sendToManager(order)}>
                    {sending ? <RefreshCw size={14} /> : <Send size={14} />} {sending ? 'Enviando...' : 'Enviar ao gestor'}
                  </button>
                  {order.managerCopySentAt ? <span style={s.copySent}>Enviado ao gestor</span> : null}
                  {!order.managerCopySentAt && order.managerCopyLastError ? <span style={s.copyError} title={order.managerCopyLastError}>Falha no último envio</span> : null}
                </div>
              </div>
            </article>
          );
        })}
        {!filtered.length ? <div style={s.noFilterResult}>Nenhuma O.S. neste filtro.</div> : null}
      </div>
      {page.hasMore ? <button type="button" style={s.loadMoreBtn} onClick={loadMore} disabled={loadingMore}>{loadingMore ? <RefreshCw size={14} className="spin" /> : <ChevronDown size={14} />} {loadingMore ? 'Carregando...' : 'Carregar mais O.S.'}</button> : null}
    </div>
  );
}

function RawDetails({ title, raw }) {
  const entries = raw && typeof raw === 'object' ? Object.entries(raw) : [];
  if (!entries.length) return null;
  return <details style={s.rawDetails}><summary style={s.rawSummary}><Database size={15} /> {title}<ChevronDown size={15} /></summary><RawTable entries={entries} /></details>;
}

function RawTable({ entries }) {
  return <div style={s.rawTable}>{entries.map(([key, value]) => <div key={key} style={s.rawRow}><span>{key}</span><strong>{formatRawValue(value)}</strong></div>)}</div>;
}

function InfoSection({ title, icon, children, compact = false }) {
  return <section style={{ ...s.infoSection, ...(compact ? s.compactSection : {}) }}><h3 style={s.sectionTitle}>{icon}{title}</h3>{children}</section>;
}

function Info({ label, value, wide = false }) {
  return <div style={{ ...s.infoItem, ...(wide ? s.wideInfo : {}) }}><span style={s.infoLabel}>{label}</span><strong style={s.infoValue}>{hasValue(value) ? String(value) : 'Não informado'}</strong></div>;
}

function Empty({ icon, title, text }) {
  return <div style={s.emptyContent}>{icon}<h3 style={s.emptyTitle}>{title}</h3><p style={s.emptyText}>{text}</p></div>;
}

function TabSkeleton({ tab }) {
  const labels = { os: 'Carregando histórico de O.S.', financial: 'Carregando títulos financeiros', contracts: 'Carregando contratos', units: 'Carregando unidades', contacts: 'Carregando contatos' };
  return <div style={s.tabSkeleton} role="status" aria-live="polite"><span style={s.skeletonLineWide} /><span style={s.skeletonLine} /><span style={s.skeletonLineWide} /><small>{labels[tab] || 'Carregando informações atualizadas do ILUX'}…</small></div>;
}

function ResourceError({ onRetry }) {
  return <div style={s.resourceError}><AlertCircle size={24} /><strong>Não foi possível carregar esta aba.</strong><span>Os dados anteriores não foram considerados vazios.</span><button type="button" style={s.retryBtn} onClick={onRetry}>Tentar novamente</button></div>;
}

function Tab({ active, icon, label, onClick, disabled = false }) {
  return <button type="button" role="tab" aria-selected={active} aria-disabled={disabled} disabled={disabled} style={{ ...s.tab, ...(active ? s.activeTab : {}) }} onClick={onClick}>{icon}{label}</button>;
}

function Stat({ icon, label, value, formatted = false, tone }) {
  return <div style={s.statCard}><div style={{ ...s.statIcon, ...(tone === 'warning' ? s.warningIcon : {}) }}>{icon}</div><div><div style={s.statLabel}>{label}</div><div style={s.statValue}>{formatted ? value : Number(value || 0).toLocaleString('pt-BR')}</div></div></div>;
}

function MiniStat({ icon, value, label, warning }) {
  return <div style={s.miniStat}><div style={{ ...s.miniIcon, ...(warning ? s.warningIcon : {}) }}>{icon}</div><div style={s.miniText}><strong>{value}</strong><span>{label}</span></div></div>;
}

function Meta({ icon, text, wide = false }) {
  return <span style={{ ...s.meta, ...(wide ? s.metaWide : {}) }}>{icon}<span>{text}</span></span>;
}

function pick(object, ...keys) {
  if (!object) return undefined;
  for (const key of keys) if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  return undefined;
}

function arrayOf(...values) {
  return values.find(Array.isArray) || [];
}

function countOf(customer, relation) {
  if (Array.isArray(customer[relation])) return customer[relation].length;
  return Number(customer._count?.[relation] || customer[`${relation}Count`] || 0);
}

function getCustomerListMetrics(customer) {
  const equipments = countOf(customer, 'equipments');
  const equipmentItems = arrayOf(customer.equipments);
  const contracted = Number(pick(customer, 'contractedEquipmentsCount', 'contractedEquipmentCount')) || filterCrmEquipments(equipmentItems, 'contracted').length;
  const contracts = Number(pick(customer, 'contractsCount', 'contractCount')) || (Array.isArray(customer.contracts) ? customer.contracts.length : 0);
  const activeContracts = Number(pick(customer, 'activeContractsCount', 'activeContractCount')) || (Array.isArray(customer.contracts) ? customer.contracts.filter(isContractActive).length : 0);
  const openOrders = Number(pick(customer, 'openServiceOrdersCount', 'openOrdersCount', 'serviceOrdersOpen')) || 0;
  const overdue = Number(pick(customer, 'overdueReceivablesCount', 'overdueCount', 'overdueTitles')) || 0;
  const monthlyValue = Number(pick(customer, 'monthlyValue', 'monthlyContractValue', 'activeMonthlyValue')) || 0;
  return { equipments, contracted, contracts, activeContracts, openOrders, overdue, monthlyValue };
}

function matchesCrmView(customer, view) {
  if (view === 'all') return true;
  const metrics = getCustomerListMetrics(customer);
  if (view === 'contracted') return metrics.contracted > 0 || metrics.activeContracts > 0;
  if (view === 'open') return metrics.openOrders > 0;
  if (view === 'attention') return metrics.openOrders > 0 || metrics.overdue > 0 || !customer.phone || metrics.contracted === 0;
  if (view === 'without-contract') return metrics.contracted === 0 && metrics.activeContracts === 0;
  return true;
}

function compareCrmCustomers(firstCustomer, secondCustomer, sortBy) {
  const firstMetrics = getCustomerListMetrics(firstCustomer);
  const secondMetrics = getCustomerListMetrics(secondCustomer);
  if (sortBy === 'attention') {
    const firstScore = firstMetrics.overdue * 4 + firstMetrics.openOrders * 2 + (firstMetrics.contracted === 0 ? 1 : 0);
    const secondScore = secondMetrics.overdue * 4 + secondMetrics.openOrders * 2 + (secondMetrics.contracted === 0 ? 1 : 0);
    if (firstScore !== secondScore) return secondScore - firstScore;
  }
  if (sortBy === 'open' && firstMetrics.openOrders !== secondMetrics.openOrders) return secondMetrics.openOrders - firstMetrics.openOrders;
  if (sortBy === 'contracted' && firstMetrics.contracted !== secondMetrics.contracted) return secondMetrics.contracted - firstMetrics.contracted;
  if (sortBy === 'updated') {
    const firstDate = new Date(firstCustomer.updatedAt || firstCustomer.externalUpdatedAt || 0).getTime() || 0;
    const secondDate = new Date(secondCustomer.updatedAt || secondCustomer.externalUpdatedAt || 0).getTime() || 0;
    if (firstDate !== secondDate) return secondDate - firstDate;
  }
  return String(firstCustomer.fantasyName || firstCustomer.name || '').localeCompare(String(secondCustomer.fantasyName || secondCustomer.name || ''), 'pt-BR', { sensitivity: 'base' });
}

function sortLabel(sortBy) {
  return { name: 'Ordenados por nome', attention: 'Atenção primeiro', open: 'O.S. abertas primeiro', contracted: 'Equipamentos em contrato', updated: 'Atualizados recentemente' }[sortBy] || 'Ordenados por nome';
}

function hasValue(value) { return value !== null && value !== undefined && value !== ''; }
function joinLocation(item) { return [item.address, item.complement, item.neighborhood, [item.city, item.state].filter(Boolean).join(' / ')].filter(Boolean).join(' • '); }
function equipmentLocation(item) { return [item.address, item.complement, pick(item, 'department', 'sector'), item.installLocation, [item.city, item.state].filter(Boolean).join(' / ')].filter(Boolean).join(' • '); }
function searchableEquipment(item) { return [item.model, item.manufacturer, item.serialNumber, item.assetTag, equipmentLocation(item), item.externalId].filter(Boolean).join(' ').toLowerCase(); }
function unitLocation(item) { return [item.address, item.neighborhood, [item.city, item.state].filter(Boolean).join(' / ')].filter(Boolean).join(' • '); }

function financeStatus(value) {
  if (value === 'paid') return 'Pago';
  if (value === 'overdue') return 'Vencido';
  return 'Em aberto';
}

function financeStatusStyle(value) {
  const color = value === 'paid' ? '#22c55e' : value === 'overdue' ? '#ef4444' : '#f59e0b';
  return { color, fontSize: '0.75rem', fontWeight: 700 };
}

function isContractActive(contract) {
  if (typeof contract.isActive === 'boolean') return contract.isActive;
  const status = String(pick(contract, 'status', 'situation', 'active') || '').toLowerCase();
  if (['inactive', 'inativo', 'cancelado', 'cancelled', 'encerrado'].some((term) => status.includes(term))) return false;
  if (pick(contract, 'endDate', 'endsAt') && new Date(pick(contract, 'endDate', 'endsAt')) < new Date()) return false;
  return true;
}

function isOrderClosed(order) {
  if (typeof order.isClosed === 'boolean') return order.isClosed;
  if (pick(order, 'closedAt', 'finishedAt')) return true;
  const status = String(pick(order, 'status', 'situation', 'statusCode') || '').trim().toLowerCase();
  return ['o', 'f', 'c', 'fechada', 'fechado', 'finalizada', 'finalizado', 'closed', 'concluida', 'concluído', 'cancelada', 'cancelado', 'cancelled', 'canceled'].includes(status);
}

function sumMonthlyValue(contracts) { return contracts.filter(isContractActive).reduce((sum, contract) => sum + Number(pick(contract, 'monthlyValue', 'value', 'amount') || 0), 0); }
function formatCurrency(value) { const number = Number(value || 0); return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatHours(value) {
  if (value === null || value === undefined) return '—';
  const hours = Number(value);
  if (hours < 24) return `${hours.toLocaleString('pt-BR')}h`;
  return `${(hours / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d`;
}
function formatPeriod(start, end) { const a = formatShortDate(start); const b = formatShortDate(end); return a || b ? `${a || 'Início não informado'} até ${b || 'vigente'}` : 'Não informada'; }
function formatDate(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR'); }
function formatShortDate(value) {
  if (!value) return '';
  const calendarDate = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (calendarDate) return `${calendarDate[3]}/${calendarDate[2]}/${calendarDate[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR');
}
function formatBillingPeriod(value) {
  if (!value) return '';
  const period = String(value).match(/^(\d{4})[/-](\d{2})$/);
  return period ? `${period[2]}/${period[1]}` : String(value);
}
function formatRawValue(value) { if (!hasValue(value)) return 'Não informado'; return typeof value === 'object' ? JSON.stringify(value) : String(value); }

const BILLING_DOCUMENTS = [
  { type: 'invoice', label: 'Nota Fiscal' },
  { type: 'statement', label: 'Demonstrativo' },
  { type: 'boleto', label: 'Boleto' },
];

function documentTypeLabel(type) {
  return BILLING_DOCUMENTS.find((item) => item.type === type)?.label || 'Documento';
}

function normalizeBillingDocuments(documents, receivable) {
  const received = new Map(arrayOf(documents).map((item) => [item.type, item]));
  const fallbackAvailability = {
    invoice: Boolean(receivable?.invoiceNumber),
    statement: Boolean(pick(receivable || {}, 'statementExternalId', 'demonstrativeExternalId', 'demonstrativoExternalId', 'billingPeriod')),
    boleto: Boolean(receivable?.hasBoleto),
  };
  return BILLING_DOCUMENTS.map((definition) => {
    const item = received.get(definition.type);
    return {
      ...definition,
      ...(item || {}),
      available: item?.available ?? fallbackAvailability[definition.type],
      status: item?.status || (fallbackAvailability[definition.type] ? 'available' : 'unavailable'),
    };
  });
}

function documentLoadingPageHtml(label) {
  const safeLabel = String(label || 'documento').replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Abrindo ${safeLabel}...</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #0B0D12; color: #F4F6FA;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  .card { text-align: center; padding: 2.5rem; max-width: 340px; }
  .spinner {
    width: 42px; height: 42px; margin: 0 auto 1.3rem;
    border-radius: 50%;
    border: 3px solid rgba(232, 201, 106, 0.25);
    border-top-color: #E8C96A;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1.05rem; margin: 0 0 0.45rem; font-weight: 700; }
  p { font-size: 0.85rem; color: #AAB4C5; margin: 0; line-height: 1.4; }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Abrindo ${safeLabel}...</h1>
    <p>Isso pode levar alguns segundos. O documento aparece aqui automaticamente assim que estiver pronto.</p>
  </div>
</body>
</html>`;
}

function billingDocumentStatus(document) {
  if (document.error) return document.error;
  if (document.available === false || document.status === 'unavailable') return 'Não vinculado a esta cobrança';
  if (document.status === 'pending') return 'Aguardando o agente iLux';
  if (document.status === 'failed') return 'Falha ao gerar — tente novamente';
  if (document.status === 'ready') return 'Pronto para visualizar e enviar';
  return 'Disponível para gerar';
}

function billingDocumentStatusStyle(document) {
  if (document.error || document.available === false || document.status === 'unavailable' || document.status === 'failed') {
    return { color: 'var(--danger-text)', background: 'var(--danger-light)' };
  }
  if (document.status === 'pending') return { color: 'var(--warning-text)', background: 'var(--warning-light)' };
  if (document.status === 'ready') return { color: 'var(--success-text)', background: 'var(--success-light)' };
  return { color: 'var(--text-muted)', background: 'var(--bg-panel)' };
}

function billingDocumentIcon(type) {
  if (type === 'boleto') return <CreditCard size={17} />;
  if (type === 'statement') return <ClipboardList size={17} />;
  return <FileText size={17} />;
}

const crmResponsiveCss = `
  .crm-customer-card { transition: border-color .16s ease, transform .16s ease, background .16s ease; }
  .crm-customer-card:hover { border-color: var(--accent-border) !important; transform: translateY(-1px); }
  .crm-profile-tabs { scrollbar-width: thin; }
  .crm-profile-tabs button:focus-visible,
  .crm-page button:focus-visible,
  .crm-page input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .crm-profile-modal input:not([type='checkbox']) { min-width: 0; width: 100%; background: transparent; border: 0; outline: 0; color: var(--text-main); font: inherit; }
  .crm-profile-modal input[type='date'] { width: auto; min-width: 132px; padding: .35rem .45rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-base); color: var(--text-main); }
  .crm-list-toolbar select { max-width: 100%; }
  @media (max-width: 900px) {
    .crm-page { padding: 1.25rem !important; }
    .crm-page-header { align-items: stretch !important; }
    .crm-header-actions { align-items: stretch !important; }
    .crm-profile-modal { width: 100% !important; height: 100% !important; max-height: none !important; border-radius: 0 !important; }
    .crm-profile-header { padding: 1rem !important; }
    .crm-profile-tabs { padding: 0 .6rem !important; }
    .crm-profile-body { padding: 1rem !important; }
    .crm-equipment-layout { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 640px) {
    .crm-page { padding: .9rem !important; }
    .crm-page-header, .crm-header-actions { flex-direction: column !important; }
    .crm-header-actions > * { width: 100%; box-sizing: border-box; justify-content: center; }
    .crm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .crm-search { flex-wrap: wrap; }
    .crm-search input { flex-basis: calc(100% - 3rem) !important; }
    .crm-search button[type='submit'] { width: 100%; }
    .crm-customer-grid { grid-template-columns: 1fr !important; }
    .crm-list-toolbar, .crm-list-toolbar > * { width: 100%; }
    .crm-list-toolbar .list-controls { justify-content: flex-start; }
    .crm-list-toolbar .sort-field { flex: 1 1 auto; }
    .crm-list-toolbar .sort-select { flex: 1 1 auto; }
    .crm-result-header { align-items: flex-start !important; flex-direction: column !important; gap: .25rem; }
    .crm-profile-header > div { min-width: 0; }
    .crm-profile-header h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .crm-finance-detail { width: calc(100vw - 1.5rem) !important; max-height: calc(100vh - 1.5rem) !important; }
    .crm-document-card { align-items: stretch !important; flex-direction: column !important; }
    .crm-document-actions { justify-content: flex-end !important; }
  }
  @media print {
    body * { visibility: hidden; }
    .crm-profile-modal, .crm-profile-modal * { visibility: visible; }
    .crm-profile-header > button,
    .crm-profile-tabs,
    .crm-quick-actions,
    .crm-profile-modal footer { display: none !important; }
    /* O backdrop e position:fixed + inset:0 (uma caixa do tamanho da tela).
       Chrome trata elementos fixed de forma inconsistente na impressao --
       geralmente repete em toda pagina ou corta o que passa de 1 tela.
       Sem isso, uma ficha com muitos alertas/O.S. ficaria cortada em 1 pagina. */
    .crm-profile-backdrop {
      position: static !important;
      display: block !important;
      background: none !important;
      padding: 0 !important;
      height: auto !important;
      overflow: visible !important;
    }
    .crm-profile-modal {
      position: static !important;
      width: 100% !important;
      height: auto !important;
      max-height: none !important;
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
      background: #fff !important;
      color: #000 !important;
    }
    .crm-profile-header {
      background: #fff !important;
      border-bottom: 1px solid #ccc !important;
    }
    .crm-profile-body {
      overflow: visible !important;
      max-height: none !important;
      height: auto !important;
    }
    .crm-profile-modal *,
    .crm-profile-modal *::before,
    .crm-profile-modal *::after {
      color: #000 !important;
      background: none !important;
      border-color: #ccc !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    .crm-profile-modal { break-inside: avoid; }
    .crm-profile-modal section, .crm-profile-modal article, .crm-profile-modal > div > div { break-inside: avoid; }
  }
`;

const s = {
  container: { flex: 1, overflowY: 'auto', padding: '2rem', background: 'var(--bg-base)', color: 'var(--text-main)' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '1.25rem', alignItems: 'center', marginBottom: '1.25rem' },
  headerActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.65rem', flexWrap: 'wrap' },
  kicker: { margin: 0, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontWeight: 500, fontSize: 'var(--text-xs)', letterSpacing: 0 },
  title: { margin: '0.3rem 0', fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em', fontFamily: 'var(--font-display)' },
  subtitle: { margin: 0, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  refreshBtn: { display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.75rem 1rem', cursor: 'pointer', fontWeight: 600 },
  syncNotice: { display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.62rem 0.8rem', borderRadius: '12px', border: '1px solid var(--accent-border)', background: 'var(--accent-light)', color: 'var(--accent)', fontSize: '0.72rem' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.85rem', marginBottom: '1.2rem' },
  statCard: { display: 'flex', alignItems: 'center', gap: '0.8rem', minHeight: '74px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '15px', padding: '0.9rem' },
  statIcon: { width: 40, height: 40, flex: '0 0 auto', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-light)', color: 'var(--accent)' },
  warningIcon: { color: 'var(--warning)', background: 'var(--warning-light)' },
  statLabel: { fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 500, letterSpacing: 0 },
  statValue: { color: 'var(--text-main)', fontSize: '1.2rem', fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' },
  flaggedPanel: { border: '1px solid var(--warning-border)', background: 'var(--warning-light)', borderRadius: 14, marginBottom: '1.1rem', overflow: 'hidden' },
  flaggedHeader: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.7rem', padding: '0.85rem 1rem', background: 'none', border: 'none', color: 'var(--warning-text)', cursor: 'pointer', fontFamily: 'inherit' },
  flaggedHeaderMain: { display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem' },
  flaggedList: { display: 'grid', gap: '0.5rem', padding: '0 1rem 1rem' },
  flaggedItem: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.7rem', padding: '0.7rem 0.85rem', borderRadius: 11, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' },
  flaggedItemDisabled: { cursor: 'default', opacity: 0.75 },
  flaggedItemMain: { display: 'grid', gap: 2, minWidth: 0 },
  flaggedItemHint: { color: 'var(--text-dim)', fontSize: '0.72rem', flexShrink: 0 },
  searchBar: { display: 'flex', alignItems: 'center', gap: '0.7rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '0.7rem', marginBottom: '0.6rem' },
  searchInput: { flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)', fontSize: '0.93rem' },
  clearSearch: { display: 'grid', placeItems: 'center', color: 'var(--text-muted)', background: 'transparent', border: 0, cursor: 'pointer' },
  searchBtn: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 0, borderRadius: 10, padding: '0.7rem 1.1rem', fontWeight: 900, cursor: 'pointer' },
  listToolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', margin: '0.25rem 0 0.2rem' },
  viewChips: { display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' },
  viewChip: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', minHeight: 32, padding: '0.35rem 0.65rem', border: '1px solid var(--border-color)', borderRadius: 999, background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 750 },
  viewChipActive: { background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent-border)' },
  viewChipCount: { opacity: 0.8, fontVariantNumeric: 'tabular-nums' },
  listControls: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  viewSelect: { maxWidth: 155, minHeight: 32, padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700 },
  saveViewBtn: { minHeight: 32, padding: '0.35rem 0.65rem', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 800 },
  advancedFilters: { display: 'flex', alignItems: 'flex-end', gap: '0.65rem', flexWrap: 'wrap', margin: '0.15rem 0 0.7rem', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-panel)' },
  advancedFilterField: { display: 'grid', gap: '0.3rem', minWidth: 140, flex: '1 1 150px', color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 800 },
  advancedFilterInput: { minHeight: 32, padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.75rem' },
  advancedFilterActions: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' },
  sortField: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 700 },
  sortSelect: { minHeight: 32, padding: '0.35rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700 },
  resultHeader: { display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', padding: '0.25rem 0.15rem 0.8rem' },
  customerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '0.9rem' },
  customerCard: { minHeight: 180, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '0.9rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '1rem', cursor: 'pointer' },
  customerTop: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start' },
  avatar: { width: 40, height: 40, flex: '0 0 auto', borderRadius: 12, display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-light)' },
  customerName: { margin: 0, fontSize: '1rem', color: 'var(--text-main)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  legalName: { margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
  cardStatusRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' },
  statusPill: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minHeight: 23, padding: '0.2rem 0.45rem', border: '1px solid var(--border-color)', borderRadius: 999, color: 'var(--text-dim)', background: 'var(--bg-base)', fontSize: '0.67rem', fontWeight: 800 },
  statusPillWarning: { borderColor: 'var(--warning-border)', color: 'var(--warning-text)', background: 'var(--warning-light)' },
  statusPillDanger: { borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-light)' },
  statusPillSuccess: { borderColor: 'var(--success-border)', color: 'var(--success-text)', background: 'var(--success-light)' },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '0.5rem' },
  meta: { display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', minWidth: 0 },
  metaWide: { gridColumn: '1 / -1' },
  cardMetrics: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.45rem 0.8rem', color: 'var(--text-dim)', fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums' },
  cardActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem', flexWrap: 'wrap', marginLeft: 'auto' },
  iconCardAction: { width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--success-border)', borderRadius: 8, background: 'var(--success-light)', color: 'var(--success-text)', cursor: 'pointer' },
  cardAction: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minHeight: 30, padding: '0.35rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-main)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 800 },
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' },
  counts: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap' },
  badge: { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)', borderRadius: 999, padding: '0.25rem 0.5rem', fontSize: 'var(--text-xs)', fontWeight: 700 },
  badgeMuted: { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '0.25rem 0.5rem', fontSize: 'var(--text-xs)', fontWeight: 600 },
  openHint: { display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 900, whiteSpace: 'nowrap' },
  emptyState: { gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 14 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.78rem' },
  paginationBtn: { minHeight: 34, padding: '0.4rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800 },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(0,0,0,.76)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' },
  modal: { width: 'min(1180px, 97vw)', height: 'min(860px, 94vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)' },
  modalHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '1.1rem 1.35rem', borderBottom: '1px solid var(--border-color)' },
  modalIdentity: { display: 'flex', alignItems: 'center', gap: '0.8rem', minWidth: 0 },
  modalAvatar: { width: 44, height: 44, flex: '0 0 auto', borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-light)', color: 'var(--accent)' },
  modalKicker: { margin: 0, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 500, letterSpacing: 0 },
  modalTitle: { margin: '0.15rem 0', fontSize: '1.2rem', fontWeight: 600, letterSpacing: '-0.02em' },
  headerMeta: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.9rem', color: 'var(--text-muted)', fontSize: '0.76rem', fontVariantNumeric: 'tabular-nums' },
  closeBtn: { width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  tabs: { display: 'flex', alignItems: 'stretch', gap: '0.1rem', padding: '0 1.35rem', borderBottom: '1px solid var(--border-color)', overflowX: 'auto', background: 'var(--bg-surface)', zIndex: 2 },
  tabGroup: { display: 'flex', gap: '0.1rem', paddingRight: '0.55rem', borderRight: '1px solid var(--border-color)' },
  tabGroupSecondary: { display: 'flex', gap: '0.1rem', paddingLeft: '0.55rem' },
  tabGroupLabel: { display: 'none', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.64rem', fontWeight: 500, letterSpacing: 0, alignSelf: 'center', padding: '0 .35rem' },
  tab: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.85rem 0.7rem', border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  activeTab: { color: 'var(--text-main)', borderBottom: '2px solid var(--accent)' },
  modalBody: { flex: 1, minHeight: 0, padding: '1.25rem 1.4rem', overflowY: 'auto' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.8rem 1.4rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' },
  secondaryBtn: { minWidth: 120, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.62rem 1rem', fontWeight: 600, cursor: 'pointer' },
  primaryBtn: { minWidth: 140, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', background: 'var(--accent)', color: 'var(--text-inverse)', border: 0, borderRadius: 'var(--radius-sm)', padding: '0.65rem 1rem', fontWeight: 600, cursor: 'pointer' },
  loadingBox: { display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '1rem', borderRadius: 12, color: 'var(--text-muted)', border: '1px solid var(--border-color)' },
  loadingInline: { display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.85rem', padding: '0.7rem 0.85rem', borderRadius: 10, color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border-color)', fontSize: '0.78rem' },
  errorBox: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem', padding: '0.75rem 0.85rem', borderRadius: 10, color: 'var(--danger-text)', background: 'var(--danger-light)', border: '1px solid var(--danger-border)', fontSize: '0.78rem' },
  retryBtn: { flex: '0 0 auto', border: '1px solid var(--danger-border)', borderRadius: 8, padding: '0.4rem 0.65rem', background: 'transparent', color: 'var(--danger-text)', fontWeight: 850, cursor: 'pointer' },
  tabSkeleton: { display: 'grid', gap: '0.7rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-panel)' },
  skeletonLineWide: { height: 52, borderRadius: 10, background: 'var(--bg-base)', border: '1px solid var(--border-color)' },
  skeletonLine: { height: 30, width: '65%', borderRadius: 10, background: 'var(--bg-base)', border: '1px solid var(--border-color)' },
  resourceError: { display: 'grid', gap: '0.55rem', justifyItems: 'start', padding: '1.2rem', border: '1px solid var(--danger-border)', borderRadius: 12, background: 'var(--danger-light)', color: 'var(--danger-text)' },
  sectionStack: { display: 'grid', gap: '1rem' },
  profileStats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '0.6rem' },
  healthyBox: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.8rem 1rem', borderRadius: 'var(--radius-sm)', color: 'var(--success-text)', background: 'var(--success-light)', border: '1px solid var(--success-border)', fontSize: '0.8rem', fontWeight: 600 },
  quickActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', padding: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-panel)' },
  quickActionsTitle: { display: 'grid', minWidth: 150, marginRight: 'auto', color: 'var(--text-main)' },
  quickActionBtn: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.58rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' },
  quickActionPrimary: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.58rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--text-inverse)', fontWeight: 600, cursor: 'pointer' },
  alertGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '0.55rem' },
  smartAlert: { display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.77rem' },
  smartAlertClickable: { background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit' },
  criticalAlert: { color: 'var(--critical)', background: 'var(--critical-light)', border: '1px solid var(--critical-border)' },
  warningAlert: { color: 'var(--warning-text)', background: 'var(--warning-light)', border: '1px solid var(--warning-border)' },
  infoAlert: { color: 'var(--info-text)', background: 'var(--info-light)', border: '1px solid var(--info-border)' },
  slaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: '0.55rem' },
  metricCard: { display: 'grid', gap: 3, padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-panel)', fontVariantNumeric: 'tabular-nums' },
  metricCardClickable: { textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit' },
  metricDanger: { borderColor: 'var(--critical-border)', background: 'var(--critical-light)', color: 'var(--critical)' },
  stackedField: { display: 'grid', gap: 2, minWidth: 0, fontVariantNumeric: 'tabular-nums' },
  recurrenceBox: { display: 'flex', alignItems: 'center', gap: '0.65rem', marginTop: '0.7rem', padding: '0.7rem', color: 'var(--warning-text)', borderRadius: 'var(--radius-sm)', background: 'var(--warning-light)' },
  recurrenceBoxClickable: { border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit' },
  miniStat: { display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-panel)' },
  miniIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-xs)', background: 'var(--accent-light)', color: 'var(--accent)' },
  miniText: { display: 'grid', gap: 2, color: 'var(--text-muted)', fontSize: '0.72rem', fontVariantNumeric: 'tabular-nums' },
  infoSection: { padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-panel)' },
  compactSection: { borderRadius: 'var(--radius-sm)', background: 'transparent' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: '0.45rem', margin: '0 0 0.85rem', color: 'var(--text-main)', fontSize: '0.87rem', fontWeight: 600 },
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '0.7rem 1.1rem' },
  infoItem: { display: 'grid', gap: '0.22rem', minWidth: 0 },
  infoLabel: { fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 500, letterSpacing: 0 },
  infoValue: { color: 'var(--text-main)', fontSize: '0.84rem', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' },
  wideInfo: { gridColumn: '1 / -1' },
  notes: { margin: 0, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.55 },
  equipmentLayout: { display: 'grid', gridTemplateColumns: 'minmax(290px,.42fr) minmax(400px,1fr)', gap: '1rem', alignItems: 'start' },
  unitsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: '0.85rem' },
  unitCard: { display: 'grid', gap: '0.8rem', alignContent: 'start', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 15, background: 'var(--bg-panel)' },
  unitHeader: { display: 'flex', alignItems: 'center', gap: '0.7rem' },
  unitIcon: { width: 38, height: 38, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-light)', borderRadius: 11 },
  unitCount: { padding: '0.3rem 0.55rem', borderRadius: 999, color: 'var(--accent)', background: 'var(--accent-light)', fontSize: '0.75rem', fontWeight: 700 },
  unitAddress: { display: 'flex', alignItems: 'flex-start', gap: '0.45rem', color: 'var(--text-muted)', fontSize: '0.78rem' },
  departmentList: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  unitEquipmentList: { display: 'grid', gap: '0.45rem' },
  unitEquipment: { display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.65rem', borderRadius: 10, color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border-color)' },
  mutedText: { color: 'var(--text-dim)', fontSize: '0.75rem' },
  contactsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: '0.75rem' },
  contactCard360: { display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.9rem', border: '1px solid var(--border-color)', borderRadius: 14, background: 'var(--bg-panel)' },
  contactAvatar: { width: 38, height: 38, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 11, color: 'var(--accent)', background: 'var(--accent-light)' },
  contactBody: { display: 'grid', gap: '0.25rem', minWidth: 0 },
  contactRole: { color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 500, fontFamily: 'var(--font-mono)', letterSpacing: 0 },
  contactChannels: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.8rem', color: 'var(--text-muted)', fontSize: '0.74rem' },
  financialStats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '0.65rem' },
  financeFilterRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  financeSearchBar: { display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-panel)' },
  financeSearchField: { display: 'flex', alignItems: 'center', gap: '0.45rem', flex: '1 1 260px', minWidth: 200, color: 'var(--text-muted)' },
  financePeriodField: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 700 },
  clearFinanceFilters: { border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', borderRadius: 9, padding: '0.45rem 0.6rem', cursor: 'pointer', fontWeight: 800, fontSize: '0.72rem' },
  financeFilterChip: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', borderRadius: 999, border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  financeFilterChipActive: { color: 'var(--text-inverse)', background: 'var(--accent)', borderColor: 'var(--accent)' },
  financeFilterCount: { opacity: 0.75, fontSize: '0.72rem' },
  financeList: { display: 'grid', gap: '0.55rem' },
  financeItem: { width: '100%', display: 'grid', gridTemplateColumns: '38px minmax(0,1fr) auto', alignItems: 'center', gap: '0.7rem', padding: '0.8rem', border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-panel)', color: 'var(--text-main)', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' },
  financeIcon: { width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, color: 'var(--accent)', background: 'var(--accent-light)' },
  financeMain: { display: 'grid', gap: 2, minWidth: 0 },
  financeValue: { display: 'flex', alignItems: 'center', gap: '0.55rem', textAlign: 'right' },
  financeValueDetails: { display: 'grid', gap: 3, fontVariantNumeric: 'tabular-nums' },
  financeDetailBackdrop: { position: 'fixed', inset: 0, zIndex: 3700, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(3px)' },
  financeDetailModal: { width: 'min(720px, 94vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 20, boxShadow: '0 28px 80px rgba(0,0,0,.55)' },
  financeDetailHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '1.15rem 1.25rem', borderBottom: '1px solid var(--border-color)' },
  financeDetailTitle: { margin: '0.25rem 0 0', fontSize: '1.2rem' },
  financeDetailBody: { display: 'grid', gap: '1rem', padding: '1.2rem 1.25rem', overflowY: 'auto' },
  financeDetailSummary: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '0.7rem' },
  financeDetailGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '0.9rem 1.2rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 14, background: 'var(--bg-base)' },
  digitableLineBox: { display: 'grid', gap: '0.35rem', padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--accent-light)', border: '1px solid var(--accent-border)', overflowWrap: 'anywhere' },
  invoiceNotes: { display: 'grid', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.8rem' },
  billingDocumentsSection: { display: 'grid', gap: '0.8rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 15, background: 'var(--bg-panel)' },
  billingDocumentsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' },
  billingDocumentsTitle: { display: 'flex', alignItems: 'center', gap: '0.45rem', margin: '0.2rem 0 0', color: 'var(--text-main)', fontSize: '0.95rem' },
  smallSecondaryBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.48rem 0.65rem', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 800 },
  documentsLoading: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 10, fontSize: '0.78rem' },
  documentError: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.8rem', color: 'var(--danger-text)', border: '1px solid var(--danger-border)', borderRadius: 10, background: 'var(--danger-light)', fontSize: '0.76rem' },
  documentList: { display: 'grid', gap: '0.55rem' },
  documentCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-base)' },
  documentUnavailable: { opacity: 0.58 },
  documentSelect: { display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, cursor: 'pointer' },
  documentIcon: { width: 34, height: 34, flex: '0 0 auto', display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-light)', borderRadius: 9 },
  documentIdentity: { display: 'grid', gap: 2, minWidth: 0 },
  documentActions: { display: 'flex', alignItems: 'center', gap: '0.4rem', flex: '0 0 auto' },
  iconActionBtn: { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border-color)', borderRadius: 9, background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer' },
  documentSendBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.55rem 0.65rem', border: '1px solid var(--accent-border)', borderRadius: 9, background: 'var(--accent-light)', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 900 },
  packageSendBtn: { width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', padding: '0.72rem 1rem', border: 0, borderRadius: 10, background: 'var(--accent)', color: 'var(--text-inverse)', cursor: 'pointer', fontWeight: 900 },
  deliveryConfirmation: { display: 'grid', gap: '0.8rem', padding: '1rem', border: '1px solid var(--accent-border)', borderRadius: 14, background: 'var(--accent-light)' },
  deliveryTitle: { display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent)' },
  deliveryGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '0.75rem 1rem' },
  deliveryWarning: { display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem', borderRadius: 9, color: 'var(--warning-text)', background: 'var(--warning-light)', fontSize: '0.76rem' },
  deliveryActions: { display: 'flex', justifyContent: 'flex-end', gap: '0.55rem', flexWrap: 'wrap' },
  financeDetailFooter: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', padding: '0.9rem 1.25rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-base)' },
  noBoletoLabel: { color: 'var(--text-dim)', fontSize: '0.8rem', fontWeight: 700 },
  documentStatusBadge: { display: 'inline-flex', width: 'fit-content', padding: '0.16rem 0.4rem', borderRadius: 999, fontSize: '0.68rem', fontWeight: 800 },
  permissionNotice: { display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem', borderRadius: 9, color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px dashed var(--border-color)', fontSize: '0.76rem' },
  meterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: '0.55rem' },
  meterCard: { display: 'grid', gap: 2, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-base)', fontVariantNumeric: 'tabular-nums' },
  currentMeterPanel: { display: 'grid', gap: '0.6rem', marginBottom: '0.7rem', padding: '0.8rem', border: '1px solid var(--accent-border)', borderRadius: 12, background: 'var(--accent-light)' },
  currentMeterHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.7rem' },
  currentMeterLabel: { display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 500, fontFamily: 'var(--font-mono)', letterSpacing: 0 },
  currentMeterValue: { display: 'block', marginTop: 2, color: 'var(--text-main)', fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums' },
  currentMeterSource: { color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 500, fontFamily: 'var(--font-mono)', letterSpacing: 0 },
  currentMeterCounters: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  counterChip: { display: 'inline-flex', gap: '0.3rem', padding: '0.3rem 0.5rem', borderRadius: 999, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums' },
  maintenanceSummary: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '0.55rem', marginTop: '0.65rem' },
  technicalMentions: { display: 'grid', gap: '0.4rem', marginTop: '0.7rem', padding: '0.7rem', borderRadius: 10, color: 'var(--text-muted)', background: 'var(--warning-light)', border: '1px solid var(--warning-border)' },
  equipmentAside: { display: 'grid', gap: '0.7rem', minWidth: 0 },
  innerSearch: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 11, color: 'var(--text-muted)' },
  equipmentList: { display: 'grid', gap: '0.55rem', maxHeight: '61vh', overflowY: 'auto', paddingRight: 3 },
  equipmentCard: { display: 'grid', gap: '0.32rem', textAlign: 'left', background: 'var(--bg-base)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 13, padding: '0.8rem', cursor: 'pointer' },
  activeEquipmentCard: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent-border) inset', background: 'var(--accent-light)' },
  equipmentCardTop: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' },
  activeDot: { color: 'var(--success)', fontSize: '0.75rem', fontWeight: 700 },
  inactiveDot: { color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 700 },
  noFilterResult: { color: 'var(--text-muted)', textAlign: 'center', padding: '1.25rem', border: '1px dashed var(--border-color)', borderRadius: 12 },
  detailPanel: { display: 'grid', gap: '0.85rem', minWidth: 0 },
  detailHeader: { display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' },
  detailKicker: { margin: 0, color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 500, fontFamily: 'var(--font-mono)', letterSpacing: 0 },
  detailTitle: { margin: '0.2rem 0 0', fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-main)' },
  statusActive: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.3rem 0.6rem', borderRadius: 999, color: 'var(--success-text)', background: 'var(--success-light)', fontSize: '0.75rem', fontWeight: 700 },
  statusInactive: { display: 'inline-flex', alignItems: 'center', padding: '0.3rem 0.6rem', borderRadius: 999, color: 'var(--text-muted)', background: 'var(--bg-panel)', fontSize: '0.75rem', fontWeight: 700 },
  locationPanel: { display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.9rem', border: '1px solid var(--accent-border)', borderRadius: 13, background: 'var(--accent-light)' },
  locationIcon: { width: 38, height: 38, flex: '0 0 auto', borderRadius: 11, display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-light)' },
  listStack: { display: 'grid', gap: '0.75rem' },
  contractCard: { padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 15, background: 'var(--bg-panel)' },
  contractHeader: { display: 'flex', alignItems: 'center', gap: '0.7rem', paddingBottom: '0.8rem', borderBottom: '1px solid var(--border-color)' },
  contractIcon: { width: 38, height: 38, display: 'grid', placeItems: 'center', color: 'var(--accent)', background: 'var(--accent-light)', borderRadius: 10 },
  contractTitle: { margin: '0.15rem 0 0', fontSize: 'var(--text-md)' },
  contractGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '0.8rem', paddingTop: '0.8rem' },
  osToolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' },
  osSearchField: { display: 'flex', alignItems: 'center', gap: '0.45rem', flex: '1 1 260px', minWidth: 220, padding: '0.6rem 0.7rem', border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-base)', color: 'var(--text-muted)' },
  loadMoreBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', width: '100%', padding: '0.65rem', border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-panel)', color: 'var(--text-main)', cursor: 'pointer', fontWeight: 800 },
  toolbarTitle: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem 0.65rem' },
  filterGroup: { display: 'flex', padding: 3, background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 10 },
  filterBtn: { border: 0, color: 'var(--text-muted)', background: 'transparent', borderRadius: 8, padding: '0.45rem 0.7rem', cursor: 'pointer', fontWeight: 800 },
  activeFilterBtn: { color: 'var(--text-main)', background: 'var(--bg-surface)' },
  osList: { display: 'grid', gap: '0.65rem' },
  osCard: { position: 'relative', display: 'grid', gridTemplateColumns: '105px 1fr', overflow: 'hidden', border: '1px solid var(--border-color)', borderRadius: 14, background: 'var(--bg-panel)' },
  osStatusRail: { position: 'absolute', inset: '0 auto 0 0', width: 3, background: 'var(--accent)' },
  osNumber: { display: 'grid', alignContent: 'center', gap: 2, padding: '0.9rem', borderRight: '1px solid var(--border-color)', textAlign: 'center' },
  osContent: { display: 'grid', gap: '0.55rem', padding: '0.9rem' },
  osTitleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  statusClosed: { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--success-text)', fontSize: '0.75rem', fontWeight: 700 },
  statusOpen: { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--warning-text)', fontSize: '0.75rem', fontWeight: 700 },
  osMeta: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', color: 'var(--text-dim)', fontSize: '0.72rem' },
  osActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.55rem', paddingTop: '0.2rem' },
  osActionBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.7rem', borderRadius: 9, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 800 },
  osActionPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.7rem', borderRadius: 9, border: '1px solid var(--accent-border)', background: 'var(--accent)', color: '#111827', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 900 },
  copySent: { color: 'var(--success-text)', fontSize: '0.75rem', fontWeight: 700 },
  copyError: { color: 'var(--danger-text)', fontSize: '0.75rem', fontWeight: 700 },
  resolution: { padding: '0.55rem 0.7rem', borderRadius: 9, background: 'var(--success-light)', color: 'var(--text-muted)', fontSize: '0.76rem' },
  rawPanel: { display: 'grid', gap: '0.9rem' },
  technicalNotice: { display: 'flex', gap: '0.65rem', padding: '0.85rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 12, background: 'var(--bg-base)' },
  rawDetails: { marginTop: 2, borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' },
  rawSummary: { display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 800 },
  rawTable: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '0.55rem', marginTop: '0.75rem' },
  rawRow: { display: 'grid', gap: 3, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-base)', minWidth: 0 },
  emptyContent: { minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 15, padding: '2rem' },
  emptyTitle: { margin: '0.9rem 0 0.35rem', fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-main)' },
  emptyText: { margin: 0, maxWidth: 360, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', lineHeight: 'var(--leading-relaxed)' },
};
