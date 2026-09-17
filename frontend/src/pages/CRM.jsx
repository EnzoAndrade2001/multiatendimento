import React, { useEffect, useState } from 'react';
import {
  Building2,
  ChevronRight,
  ClipboardList,
  Database,
  DollarSign,
  Download,
  FileText,
  Hash,
  MapPin,
  Phone,
  Printer,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';
import { getCrmCustomer, getCrmCustomers, getCrmSummary } from '../services/api';

export default function CRM() {
  const [summary, setSummary] = useState({ customers: 0, equipments: 0, linkedEquipments: 0 });
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [activeTab, setActiveTab] = useState('data');

  useEffect(() => {
    load();
  }, []);

  async function load(search = q) {
    setLoading(true);
    try {
      const [summaryResponse, customersResponse] = await Promise.all([
        getCrmSummary(),
        getCrmCustomers({ q: search, limit: 120 }),
      ]);
      setSummary(summaryResponse.data || {});
      setCustomers(Array.isArray(customersResponse.data) ? customersResponse.data : []);
    } finally {
      setLoading(false);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    load(q);
  }

  async function openCustomer(customer, tab = 'data', equipmentId = null) {
    setSelectedCustomer(customer);
    setSelectedEquipment(null);
    setActiveTab(tab);
    setModalLoading(true);
    try {
      const response = await getCrmCustomer(customer.id);
      const fullCustomer = response.data;
      setSelectedCustomer(fullCustomer);
      if (equipmentId) {
        setSelectedEquipment((fullCustomer.equipments || []).find((equipment) => equipment.id === equipmentId) || null);
      }
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setSelectedCustomer(null);
    setSelectedEquipment(null);
    setActiveTab('data');
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <p style={s.kicker}>Base ILUX</p>
          <h1 style={s.title}>CRM</h1>
          <p style={s.subtitle}>Clientes e equipamentos importados do Firebird, separados dos contatos do WhatsApp.</p>
        </div>
        <button type="button" style={s.refreshBtn} onClick={() => load()} disabled={loading}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>

      <div style={s.syncNotice}>
        <Database size={18} />
        <div>
          <strong>Sincronizacao ILUX {'->'} CRM</strong>
          <span>
            Esta tela e a base oficial importada do ILUX. Por enquanto ela e somente leitura: mudancas feitas aqui ainda
            nao gravam no Firebird.
          </span>
        </div>
      </div>

      <div style={s.statsGrid}>
        <Stat icon={<Building2 size={18} />} label="Clientes CRM" value={summary.customers || 0} />
        <Stat icon={<Printer size={18} />} label="Equipamentos" value={summary.equipments || 0} />
        <Stat icon={<Hash size={18} />} label="Equip. vinculados" value={summary.linkedEquipments || 0} />
      </div>

      <form style={s.searchBar} onSubmit={submitSearch}>
        <Search size={18} color="var(--text-dim)" />
        <input
          style={s.searchInput}
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Buscar por nome, fantasia, CNPJ, telefone ou cidade"
        />
        <button type="submit" style={s.searchBtn} disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      <div style={s.customerGrid}>
        {customers.map((customer) => (
          <article key={customer.id} style={s.customerCard} onClick={() => openCustomer(customer)}>
            <div style={s.customerMain}>
              <div style={s.customerTitleRow}>
                <h2 style={s.customerName}>{customer.fantasyName || customer.name}</h2>
              </div>
              {customer.fantasyName && customer.name !== customer.fantasyName ? (
                <p style={s.legalName}>{customer.name}</p>
              ) : null}
              <div style={s.metaRow}>
                {customer.cpfCnpj ? <Meta icon={<Hash size={14} />} text={customer.cpfCnpj} /> : null}
                {customer.phone ? <Meta icon={<Phone size={14} />} text={customer.phone} /> : null}
                {[customer.city, customer.state].filter(Boolean).length ? (
                  <Meta icon={<MapPin size={14} />} text={[customer.city, customer.state].filter(Boolean).join(' / ')} />
                ) : null}
              </div>
            </div>
            <div style={s.cardFooter}>
              <span style={s.badge}>{customer._count?.equipments || 0} equipamentos</span>
              <span style={s.openHint}>
                Ver perfil
                <ChevronRight size={15} />
              </span>
            </div>
          </article>
        ))}

        {!loading && customers.length === 0 ? (
          <div style={s.emptyState}>Nenhum cliente CRM encontrado.</div>
        ) : null}
      </div>

      {selectedCustomer ? (
        <CustomerModal
          customer={selectedCustomer}
          selectedEquipment={selectedEquipment}
          setSelectedEquipment={setSelectedEquipment}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          loading={modalLoading}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}

function CustomerModal({
  customer,
  selectedEquipment,
  setSelectedEquipment,
  activeTab,
  setActiveTab,
  loading,
  onClose,
}) {
  const equipments = customer.equipments || [];
  const currentEquipment = selectedEquipment || equipments[0] || null;

  function selectEquipment(equipment) {
    setSelectedEquipment(equipment);
  }

  return (
    <div style={s.modalBackdrop} onMouseDown={onClose}>
      <section style={s.modal} onMouseDown={(event) => event.stopPropagation()}>
        <header style={s.modalHeader}>
          <div>
            <p style={s.modalKicker}>Perfil do cliente ILUX</p>
            <h2 style={s.modalTitle}>{customer.fantasyName || customer.name}</h2>
            <span style={s.readOnlyPill}>Somente leitura</span>
          </div>
          <button type="button" style={s.closeBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <nav style={s.tabs}>
          <Tab active={activeTab === 'data'} icon={<User size={15} />} label="Dados" onClick={() => setActiveTab('data')} />
          <Tab
            active={activeTab === 'equipments'}
            icon={<Printer size={15} />}
            label={`Equipamentos (${equipments.length})`}
            onClick={() => setActiveTab('equipments')}
          />
          <Tab active={activeTab === 'raw'} icon={<Database size={15} />} label="Campos ILUX" onClick={() => setActiveTab('raw')} />
          <Tab active={activeTab === 'os'} icon={<ClipboardList size={15} />} label={`Histórico O.S. (${customer.os?.length || 0})`} onClick={() => setActiveTab('os')} />
          <Tab active={activeTab === 'contracts'} icon={<FileText size={15} />} label={`Contratos (${customer.contratos?.length || 0})`} onClick={() => setActiveTab('contracts')} />
          <Tab active={activeTab === 'finance'} icon={<DollarSign size={15} />} label={`Financeiro (${customer.boletos?.length || 0})`} onClick={() => setActiveTab('finance')} />
        </nav>

        <div style={s.modalBody}>
          {loading ? <div style={s.loadingBox}>Carregando dados completos do LCDDIGITALWEB...</div> : null}

          {activeTab === 'data' ? <CustomerDataTab customer={customer} /> : null}
          {activeTab === 'equipments' ? (
            <EquipmentsTab
              equipments={equipments}
              currentEquipment={currentEquipment}
              onSelectEquipment={selectEquipment}
            />
          ) : null}
          {activeTab === 'raw' ? <RawFieldsTab title="Campos originais do cliente no ILUX" raw={customer.raw} /> : null}
          {activeTab === 'os' ? <OsTab osList={customer.os || []} /> : null}
          {activeTab === 'contracts' ? <ContractsTab contracts={customer.contratos || []} /> : null}
          {activeTab === 'finance' ? <FinanceTab boletos={customer.boletos || []} /> : null}
        </div>

        <footer style={s.modalFooter}>
          <button type="button" style={s.secondaryBtn} onClick={onClose}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}

function CustomerDataTab({ customer }) {
  return (
    <div style={s.formGrid}>
      <ReadOnlyField label="Codigo ILUX" value={customer.externalId} />
      <ReadOnlyField label="Origem" value={customer.externalSource} />
      <ReadOnlyField label="Nome / Razao social" value={customer.name} wide />
      <ReadOnlyField label="Nome fantasia / Departamento" value={customer.fantasyName} wide />
      <ReadOnlyField label="Telefone" value={customer.phone} />
      <ReadOnlyField label="E-mail" value={customer.email} />
      <ReadOnlyField label="CNPJ / CPF" value={customer.cpfCnpj} wide />
      <ReadOnlyField label="Contato" value={customer.contactName} />
      <ReadOnlyField label="CEP" value={customer.zipCode} />
      <ReadOnlyField label="Endereco" value={customer.address} wide />
      <ReadOnlyField label="Bairro" value={customer.neighborhood} />
      <ReadOnlyField label="Cidade" value={customer.city} />
      <ReadOnlyField label="Estado (UF)" value={customer.state} />
      <ReadOnlyField label="Observacoes" value={customer.notes} wide />
      <ReadOnlyField label="Ultima atualizacao no CRM" value={formatDate(customer.updatedAt)} />
    </div>
  );
}

function EquipmentsTab({ equipments, currentEquipment, onSelectEquipment }) {
  if (!equipments.length) {
    return <div style={s.emptyState}>Este cliente nao possui equipamentos vinculados no CRM.</div>;
  }

  return (
    <div style={s.equipmentTabGrid}>
      <div style={s.equipmentColumn}>
        {equipments.map((equipment) => (
          <button
            key={equipment.id}
            type="button"
            style={{
              ...s.equipmentCard,
              ...(currentEquipment?.id === equipment.id ? s.activeEquipmentCard : {}),
            }}
            onClick={() => onSelectEquipment(equipment)}
          >
            <strong>{equipment.model || 'Equipamento sem modelo'}</strong>
            <span>{[equipment.manufacturer, equipment.type].filter(Boolean).join(' | ') || 'Sem fabricante/tipo'}</span>
            <small>
              Serie: {equipment.serialNumber || 'Nao informado'} | Setor: {equipment.sector || 'Nao informado'}
            </small>
          </button>
        ))}
      </div>

      <div style={s.equipmentDetail}>
        <h3>Detalhes do equipamento</h3>
        <div style={s.formGrid}>
          <ReadOnlyField label="Codigo ILUX" value={currentEquipment.externalId} />
          <ReadOnlyField label="Status" value={currentEquipment.isActive === false ? 'Inativo' : 'Ativo'} />
          <ReadOnlyField label="Marca / Fabricante" value={currentEquipment.manufacturer} />
          <ReadOnlyField label="Modelo" value={currentEquipment.model} />
          <ReadOnlyField label="Numero de serie" value={currentEquipment.serialNumber} />
          <ReadOnlyField label="Setor" value={currentEquipment.sector} />
          <ReadOnlyField label="Tipo" value={currentEquipment.type} />
          <ReadOnlyField label="Patrimonio" value={currentEquipment.assetTag} />
          <ReadOnlyField label="Contrato ILUX" value={currentEquipment.contractExternalId} />
          <ReadOnlyField label="Local especifico" value={currentEquipment.installLocation} />
          <ReadOnlyField label="Endereco" value={currentEquipment.address} wide />
          <ReadOnlyField label="Cidade" value={currentEquipment.city} />
          <ReadOnlyField label="Estado" value={currentEquipment.state} />
          <ReadOnlyField label="Telefone local" value={currentEquipment.phone} />
          <ReadOnlyField label="Ultima atualizacao no CRM" value={formatDate(currentEquipment.updatedAt)} />
        </div>
        <RawFieldsTab title="Campos originais deste equipamento no ILUX" raw={currentEquipment.raw} compact />
      </div>
    </div>
  );
}

function RawFieldsTab({ title, raw, compact = false }) {
  const entries = raw && typeof raw === 'object' ? Object.entries(raw) : [];

  return (
    <section style={compact ? s.rawCompact : s.rawPanel}>
      <h3>{title}</h3>
      {!entries.length ? (
        <div style={s.emptyEquipments}>Nenhum campo bruto foi armazenado para este registro.</div>
      ) : (
        <div style={s.rawTable}>
          {entries.map(([key, value]) => (
            <div key={key} style={s.rawRow}>
              <span>{key}</span>
              <strong>{formatRawValue(value)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OsTab({ osList }) {
  if (!osList || osList.length === 0) {
    return (
      <div style={s.osEmpty}>
        <ClipboardList size={28} />
        <h3>Nenhuma O.S. encontrada</h3>
        <p>Não há histórico de ordens de serviço para este cliente.</p>
      </div>
    );
  }

  return (
    <div style={s.listGrid}>
      {osList.map(os => (
        <div key={os.id} style={s.tabCard}>
          <div style={s.tabCardHeader}>
            <strong>O.S. #{os.numero}</strong>
            <span style={{ ...s.statusChip, ...(os.status === 'CONCLUIDA' ? s.statusGreen : s.statusYellow) }}>
              {os.status}
            </span>
          </div>
          <p><strong>Abertura:</strong> {formatDate(os.dataAbertura)}</p>
          {os.dataFechamento && <p><strong>Fechamento:</strong> {formatDate(os.dataFechamento)}</p>}
          <div style={s.tabCardBody}>
            <p><strong>Defeito:</strong> {os.defeito || 'Não informado'}</p>
            <p><strong>Solução:</strong> {os.solucao || 'Não informado'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ContractsTab({ contracts }) {
  if (!contracts || contracts.length === 0) {
    return (
      <div style={s.osEmpty}>
        <FileText size={28} />
        <h3>Nenhum contrato</h3>
        <p>Este cliente não possui contratos registrados.</p>
      </div>
    );
  }

  return (
    <div style={s.listGrid}>
      {contracts.map(contract => (
        <div key={contract.id} style={s.tabCard}>
          <div style={s.tabCardHeader}>
            <strong>Contrato #{contract.numero}</strong>
            <span style={{ ...s.statusChip, ...(contract.status === 'ATIVO' ? s.statusGreen : s.statusRed) }}>
              {contract.status}
            </span>
          </div>
          <p><strong>Início:</strong> {formatDate(contract.dataInicial)}</p>
          <p><strong>Fim:</strong> {formatDate(contract.dataFinal)}</p>
          <p><strong>Valor Mensal:</strong> {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(contract.valorFixoMensal || 0)}</p>
        </div>
      ))}
    </div>
  );
}

function FinanceTab({ boletos }) {
  if (!boletos || boletos.length === 0) {
    return (
      <div style={s.osEmpty}>
        <DollarSign size={28} />
        <h3>Nenhum histórico financeiro</h3>
        <p>Não há contas a receber ou boletos recentes para este cliente.</p>
      </div>
    );
  }

  return (
    <div style={s.listGrid}>
      {boletos.map(boleto => {
        const isPaid = boleto.status === 'PAGA' || boleto.status === 'PAGO';
        const isLate = boleto.status === 'ATRASADA' || boleto.status === 'ATRASADO';
        const statusStyle = isPaid ? s.statusGreen : (isLate ? s.statusRed : s.statusYellow);

        return (
          <div key={boleto.id} style={s.tabCard}>
            <div style={s.tabCardHeader}>
              <strong>Doc: {boleto.nossoNumero || 'N/A'}</strong>
              <span style={{ ...s.statusChip, ...statusStyle }}>
                {boleto.status}
              </span>
            </div>
            <p><strong>Vencimento:</strong> {formatDate(boleto.dataVencimento)}</p>
            <p style={s.cardValue}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(boleto.valor || 0)}
            </p>
            {boleto.urlPdf && (
              <a href={boleto.urlPdf} target="_blank" rel="noreferrer" style={s.downloadBtn}>
                <Download size={14} /> Visualizar PDF
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReadOnlyField({ label, value, wide = false }) {
  return (
    <label style={{ ...s.field, ...(wide ? s.wideField : {}) }}>
      <span style={s.fieldLabel}>{label}</span>
      <input style={s.fieldInput} value={value || ''} readOnly placeholder="Nao informado" />
    </label>
  );
}

function Tab({ active, icon, label, onClick }) {
  return (
    <button type="button" style={{ ...s.tab, ...(active ? s.activeTab : {}) }} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div style={s.statCard}>
      <div style={s.statIcon}>{icon}</div>
      <div>
        <div style={s.statLabel}>{label}</div>
        <div style={s.statValue}>{Number(value || 0).toLocaleString('pt-BR')}</div>
      </div>
    </div>
  );
}

function Meta({ icon, text }) {
  return (
    <span style={s.meta}>
      {icon}
      {text}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR');
}

function formatRawValue(value) {
  if (value === null || value === undefined || value === '') return 'Nao informado';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const s = {
  container: { flex: 1, overflowY: 'auto', padding: '2rem', background: 'var(--bg-base)', color: 'var(--text-main)' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '1rem' },
  kicker: { margin: 0, color: 'var(--accent)', fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' },
  title: { margin: '0.25rem 0', fontSize: '1.8rem', fontWeight: 900, fontFamily: 'var(--font-display)' },
  subtitle: { margin: 0, color: 'var(--text-muted)', fontSize: '0.92rem' },
  refreshBtn: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.75rem 1rem', cursor: 'pointer', fontWeight: 800 },
  syncNotice: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '1.25rem', padding: '0.9rem 1rem', borderRadius: '14px', border: '1px solid rgba(220, 180, 48, 0.35)', background: 'linear-gradient(135deg, rgba(220, 180, 48, 0.14), rgba(17, 24, 39, 0.4))', color: 'var(--text-muted)' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' },
  statCard: { display: 'flex', alignItems: 'center', gap: '0.8rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1rem' },
  statIcon: { width: '38px', height: '38px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-light)', color: 'var(--accent)' },
  statLabel: { color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' },
  statValue: { color: 'var(--text-main)', fontSize: '1.25rem', fontWeight: 900, marginTop: '0.1rem' },
  searchBar: { display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '0.75rem', marginBottom: '1rem' },
  searchInput: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)', fontSize: '0.95rem' },
  searchBtn: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', borderRadius: '10px', padding: '0.7rem 1rem', fontWeight: 900, cursor: 'pointer' },
  customerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '0.9rem' },
  customerCard: { minHeight: '170px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1rem', cursor: 'pointer', transition: 'transform 0.16s ease, border-color 0.16s ease, background 0.16s ease' },
  customerMain: { minWidth: 0 },
  customerTitleRow: { display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' },
  customerName: { margin: 0, fontSize: '1rem', color: 'var(--text-main)', fontWeight: 900 },
  legalName: { margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.84rem' },
  badge: { background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)', borderRadius: '999px', padding: '0.25rem 0.55rem', fontSize: '0.72rem', fontWeight: 900 },
  metaRow: { display: 'flex', gap: '0.65rem', flexWrap: 'wrap', marginTop: '0.75rem' },
  meta: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.8rem' },
  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border-color)' },
  openHint: { display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 900 },
  equipmentPreview: { display: 'grid', gap: '0.5rem' },
  equipmentItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', gap: '0.75rem', background: 'var(--bg-base)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.7rem', cursor: 'pointer' },
  emptyEquipments: { color: 'var(--text-dim)', fontSize: '0.84rem', padding: '0.8rem', border: '1px dashed var(--border-color)', borderRadius: '10px' },
  emptyState: { textAlign: 'center', color: 'var(--text-muted)', padding: '2rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '14px' },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0, 0, 0, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' },
  modal: { width: 'min(980px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '22px', boxShadow: '0 28px 90px rgba(0, 0, 0, 0.5)' },
  modalHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '1.35rem 1.5rem', borderBottom: '1px solid var(--border-color)' },
  modalKicker: { margin: 0, color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' },
  modalTitle: { margin: '0.35rem 0 0.55rem', fontSize: '1.25rem', fontWeight: 950 },
  readOnlyPill: { display: 'inline-flex', width: 'fit-content', padding: '0.25rem 0.6rem', borderRadius: '999px', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.74rem', fontWeight: 800 },
  closeBtn: { width: '36px', height: '36px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-main)', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '0.25rem', padding: '0 1.5rem', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' },
  tab: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '1rem 0.8rem', border: 'none', borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--text-muted)', fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' },
  activeTab: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  modalBody: { padding: '1.5rem', overflowY: 'auto' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', background: 'rgba(8, 12, 22, 0.45)' },
  secondaryBtn: { minWidth: '180px', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.85rem 1rem', fontWeight: 900, cursor: 'pointer' },
  loadingBox: { marginBottom: '1rem', padding: '0.8rem', borderRadius: '12px', color: 'var(--text-muted)', border: '1px solid var(--border-color)' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.9rem' },
  field: { display: 'grid', gap: '0.35rem', minWidth: 0 },
  fieldLabel: { color: 'var(--accent)', fontSize: '0.76rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.03em' },
  fieldInput: { width: '100%', minWidth: 0, boxSizing: 'border-box', background: 'var(--bg-base)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.9rem 0.95rem', fontWeight: 800, outline: 'none' },
  wideField: { gridColumn: '1 / -1' },
  equipmentTabGrid: { display: 'grid', gridTemplateColumns: 'minmax(250px, 0.45fr) minmax(360px, 1fr)', gap: '1rem', alignItems: 'start' },
  equipmentColumn: { display: 'grid', gap: '0.65rem', maxHeight: '62vh', overflowY: 'auto', paddingRight: '0.25rem' },
  equipmentCard: { display: 'grid', gap: '0.25rem', textAlign: 'left', background: 'var(--bg-base)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '0.9rem', cursor: 'pointer' },
  activeEquipmentCard: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px rgba(220, 180, 48, 0.2) inset' },
  equipmentDetail: { background: 'rgba(8, 12, 22, 0.38)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1rem' },
  listGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginTop: '0.5rem' },
  tabCard: { display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.25rem', transition: 'transform 0.16s ease, border-color 0.16s ease' },
  tabCardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' },
  tabCardBody: { background: 'var(--bg-surface)', padding: '0.75rem', borderRadius: '10px', marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' },
  statusChip: { display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' },
  statusGreen: { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' },
  statusYellow: { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' },
  statusRed: { background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' },
  cardValue: { fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', margin: '0.5rem 0' },
  downloadBtn: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', alignSelf: 'flex-start', padding: '0.5rem 0.8rem', background: 'var(--accent)', color: 'var(--text-inverse)', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 800, textDecoration: 'none', marginTop: '0.5rem' },
  rawPanel: { display: 'grid', gap: '0.9rem' },
  rawCompact: { marginTop: '1rem', display: 'grid', gap: '0.75rem' },
  rawTable: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.65rem' },
  rawRow: { display: 'grid', gap: '0.25rem', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-base)', minWidth: 0 },
  osEmpty: { minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '16px', padding: '2rem' },
};
