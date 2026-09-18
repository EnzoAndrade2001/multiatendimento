import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api';
import { Plus, Search, FileText, Settings, User, Calendar, X, Archive, History, MapPin, Hash, Clock, LoaderCircle } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { toast } from '../utils/toast';

const BACKEND_URL = import.meta.env.VITE_API_URL || '';

export default function ServiceOrders() {
  const isMobile = useIsMobile();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  
  const [showModal, setShowModal] = useState(false);
  const [selectedOs, setSelectedOs] = useState(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [meters, setMeters] = useState({ mono: '', color: '', scan: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Debounça a busca por texto para não disparar uma requisição a cada tecla digitada
    const timer = setTimeout(() => {
      loadOrders();
    }, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [startDate, endDate, search]);

  async function loadOrders() {
    setLoading(true);
    try {
      const params = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (search) params.search = search;

      const res = await api.get('/os', { params });
      setOrders(res.data);
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível carregar as ordens de serviço. Verifique sua conexão e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  const columns = [
    { id: 'PENDENTE', title: 'Pendentes', color: 'var(--danger)' },
    { id: 'EM_ATENDIMENTO', title: 'Em Atendimento', color: 'var(--warning)' },
    { id: 'AGUARDANDO_RETORNO', title: 'Aguardando Peça/Retorno', color: 'var(--info)' },
    { id: 'FINALIZADA', title: 'Finalizadas', color: 'var(--success)' },
    { id: 'CANCELADA', title: 'Canceladas', color: 'var(--text-muted)' }
  ];

  const [dragOverCol, setDragOverCol] = useState(null);

  // Adiciona coluna de arquivadas se estiver em busca/histórico
  const activeColumns = [...columns];
  if (isSearchMode || (search && search.trim() !== '')) {
    activeColumns.push({ id: 'ARQUIVADA', title: 'Arquivadas', color: 'var(--text-muted)' });
  }

  // Drag and Drop Logic
  function onDragStart(e, osId) {
    e.dataTransfer.setData('osId', osId);
  }

  async function onDrop(e, newStatus) {
    e.preventDefault();
    setDragOverCol(null);
    const osId = e.dataTransfer.getData('osId');
    const os = orders.find(o => o.id === osId);
    
    // Se for arquivar/finalizar por drag, exige que já tenha nota
    if ((newStatus === 'FINALIZADA' || newStatus === 'ARQUIVADA') && (!os.technicalNotes || os.technicalNotes.length < 5)) {
      toast.error('Esta O.S. não pode ser fechada sem um Relatório Técnico. Abra a O.S. para preencher.');
      return;
    }

    try {
      await api.patch(`/os/${osId}`, { status: newStatus, technicalNotes: os.technicalNotes });
      loadOrders();
      toast.success('O.S. movida com sucesso!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao mover a O.S. Tente novamente.');
    }
  }

  function allowDrop(e) {
    e.preventDefault();
  }

  function openOsModal(os) {
    setSelectedOs(os);
    setStatus(os.status);
    setNotes(os.technicalNotes || '');
    const m = os.meters ? JSON.parse(os.meters) : { mono: '', color: '', scan: '' };
    setMeters(m);
    setShowModal(true);
  }

  async function handleUpdate(newStatus = null) {
    if (saving) return;
    const finalStatus = newStatus || status;

    if ((finalStatus === 'FINALIZADA' || finalStatus === 'ARQUIVADA') && (!notes || notes.trim().length < 5)) {
      toast.error('Relatório Técnico é obrigatório para finalizar ou arquivar a O.S.');
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/os/${selectedOs.id}`, {
        status: finalStatus,
        technicalNotes: notes,
        meters
      });
      setShowModal(false);
      loadOrders();
      toast.success('O.S. atualizada com sucesso!');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao atualizar a O.S. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  const filteredOrders = useMemo(() => orders.filter(o => {
    if (isSearchMode || (search && search.trim() !== '')) return true;
    return o.status !== 'ARQUIVADA';
  }), [orders, isSearchMode, search]);

  // Agrupa as O.S. por status uma única vez (evita repetir o filtro para cada coluna do quadro)
  const ordersByStatus = useMemo(() => {
    const map = {};
    filteredOrders.forEach(o => {
      if (!map[o.status]) map[o.status] = [];
      map[o.status].push(o);
    });
    return map;
  }, [filteredOrders]);

  // Calcula há quantos dias a OS foi criada
  function daysSince(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  const s = {
    container: { padding: 'var(--space-6)', color: 'var(--text-main)', height: '100%', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-4)' },
    title: { fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontFamily: 'var(--font-display)' },
    filterBar: { display: 'flex', gap: 'var(--space-3)', alignItems: 'center', background: 'var(--bg-panel)', padding: 'var(--space-3) var(--space-5)', borderRadius: '16px', border: '1px solid var(--border-color)' },
    input: { background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: 'var(--space-2) var(--space-3)', color: 'var(--text-main)', outline: 'none', fontSize: 'var(--text-sm)' },
    dateInput: { background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 10px', color: 'var(--text-main)', outline: 'none', fontSize: 'var(--text-sm)', colorScheme: 'dark' },

    kanban: { display: 'flex', gap: 'var(--space-4)', flex: 1, overflowX: 'auto', minHeight: '500px', paddingBottom: 'var(--space-5)' },
    column: { flex: '0 0 320px', background: 'var(--bg-surface)', borderRadius: '16px', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', transition: 'border-color 0.2s, box-shadow 0.2s' },
    columnDragOver: { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-border)', background: 'var(--accent-light)' },
    colHeader: (color) => ({ fontSize: 'var(--text-md)', fontWeight: 800, color: color, marginBottom: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', textTransform: 'uppercase', letterSpacing: '0.05em' }),
    card: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: 'var(--space-4)', marginBottom: 'var(--space-3)', cursor: 'grab', transition: 'all 0.2s', boxShadow: 'var(--shadow-sm)' },
    cardTitle: { fontWeight: 800, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)', color: 'var(--accent)', display: 'flex', justifyContent: 'space-between', fontVariantNumeric: 'tabular-nums' },
    cardText: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' },
    cardDefect: { fontSize: 'var(--text-sm)', color: 'var(--text-main)', marginTop: '10px', background: 'var(--bg-base)', padding: 'var(--space-2)', borderRadius: '8px', borderLeft: '3px solid var(--accent)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' },
    emptyCol: { textAlign: 'center', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', padding: 'var(--space-6) var(--space-2)', border: '1px dashed var(--border-color)', borderRadius: '12px' },

    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' },
    modal: { background: 'var(--bg-surface)', width: '95%', maxWidth: '1150px', borderRadius: '24px', padding: '0', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', overflow: 'hidden' },
    modalHeader: { padding: 'var(--space-5) var(--space-8)', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    modalContent: { padding: 'var(--space-6) var(--space-8)', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '240px 1fr', gap: 'var(--space-8)', overflowY: 'auto', maxHeight: '80vh' },

    sidebar: { background: 'var(--bg-base)', padding: 'var(--space-6)', borderRadius: '16px', border: '1px solid var(--border-color)', height: 'fit-content', minWidth: 0 },
    btnGroup: { display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-3)', padding: '0 var(--space-8) var(--space-8)' },
    saveBtn: { flex: 2, background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', padding: 'var(--space-4)', borderRadius: '12px', fontWeight: 800, cursor: 'pointer' },
    pdfBtn: { flex: 1, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', padding: 'var(--space-4)', borderRadius: '12px', fontWeight: 800, cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }
  };

  const getClientName = (os) => {
    const company = os.equipment?.contact;
    if (company) return company.fantasyName || company.name;
    return os.contact?.fantasyName || os.contact?.name;
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={s.title}><FileText size={32} color="var(--accent)" /> Gestão de O.S.</div>
        <div style={s.filterBar}>
          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-2)'}}>
            <Calendar size={16} color="var(--text-muted)" />
            <input type="date" style={s.dateInput} value={startDate} onChange={e=>setStartDate(e.target.value)} />
            <span style={{color: 'var(--text-muted)'}}>até</span>
            <input type="date" style={s.dateInput} value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
          <div style={{width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 var(--space-2)'}} />
          <div style={{position: 'relative', display: 'flex', alignItems: 'center'}}>
            <Search size={16} color="var(--text-muted)" style={{position: 'absolute', left: '10px'}} />
            <input
              style={{...s.input, paddingLeft: 'var(--space-8)', width: isMobile ? '150px' : '220px'}}
              placeholder="Nº O.S. ou Cliente..."
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => { setIsSearchMode(!isSearchMode); loadOrders(); }}
            style={{
              background: isSearchMode ? 'var(--accent)' : 'transparent',
              color: isSearchMode ? 'var(--text-inverse)' : 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isSearchMode ? <X size={14}/> : <History size={14}/>}
            {isSearchMode ? 'Sair da Busca' : 'Histórico'}
          </button>
        </div>
      </div>

      <div style={{display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', flexWrap: 'wrap'}}>
        <button
          onClick={() => setSearch('')}
          style={{
            background: search === '' ? 'var(--accent)' : 'var(--bg-panel)',
            color: search === '' ? 'var(--text-inverse)' : 'var(--text-muted)',
            border: '1px solid var(--border-color)',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-pill)',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          Todos
        </button>
        {columns.map(c => (
          <button
            key={c.id}
            onClick={() => setSearch(c.title)}
            style={{
              background: search === c.title ? c.color : 'var(--bg-panel)',
              color: search === c.title ? 'var(--text-inverse)' : 'var(--text-muted)',
              border: `1px solid ${search === c.title ? c.color : 'var(--border-color)'}`,
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--text-xs)',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {c.title}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>
          <LoaderCircle size={12} style={{ animation: 'ui-spin 0.8s linear infinite' }} /> Atualizando ordens de serviço...
        </div>
      )}

      <div style={s.kanban}>
        {activeColumns.map(col => (
          <div 
            key={col.id} 
            style={{
              ...s.column,
              opacity: col.id === 'ARQUIVADA' ? 0.7 : 1,
              ...(dragOverCol === col.id ? s.columnDragOver : {})
            }}
            onDragOver={allowDrop}
            onDragEnter={() => setDragOverCol(col.id)}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null); }}
            onDrop={(e) => onDrop(e, col.id)}
          >
            <div style={s.colHeader(col.color)}>
              {col.title}
              <span style={{background: 'var(--bg-base)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontVariantNumeric: 'tabular-nums'}}>
                {(ordersByStatus[col.id] || []).length}
              </span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {!loading && (ordersByStatus[col.id] || []).length === 0 ? (
                <div style={s.emptyCol}>Nenhuma O.S. nesta coluna.</div>
              ) : (ordersByStatus[col.id] || []).map(os => {
                const days = daysSince(os.createdAt);
                const clientName = getClientName(os);
                const equipmentLabel = `${os.equipment?.manufacturer || ''} ${os.equipment?.model || ''}`.trim();
                const printable = /^\d+$/.test(String(os.externalId || '')) && os.status !== 'ERRO_INTEGRACAO';
                return (
                <div
                  key={os.id}
                  style={s.card}
                  draggable={os.status !== 'ARQUIVADA'}
                  onDragStart={(e) => onDragStart(e, os.id)}
                  onClick={() => openOsModal(os)}
                >
                  <div style={s.cardTitle}>
                    <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0}}>
                      <span>{printable ? `#${os.externalId}` : 'Aguardando ILUX WEB'}</span>
                      {printable ? <a
                        href={`${BACKEND_URL}/api/os/${os.id}/pdf?token=${localStorage.getItem('token')}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{color: 'var(--accent)', opacity: 0.7, display: 'flex', alignItems: 'center', padding: '4px', margin: '-4px'}}
                        title="Abrir e imprimir O.S."
                      >
                        <FileText size={12} />
                      </a> : null}
                    </div>
                    {os.status === 'FINALIZADA' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedOs(os); handleUpdate('ARQUIVADA'); }}
                        disabled={saving}
                        title="Arquivar O.S."
                        style={{background: 'none', border: 'none', color: 'var(--text-muted)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1}}
                      >
                        <Archive size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{...s.cardText, color: 'var(--text-main)', fontWeight: 800, fontSize: 'var(--text-md)', minWidth: 0}}>
                    <User size={14} color="var(--accent)" style={{flexShrink: 0}}/>
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={clientName}>{clientName}</span>
                  </div>
                  <div style={{...s.cardText, fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)'}}>Sol: {os.contact?.name}</div>
                  <div style={{...s.cardText, minWidth: 0}}>
                    <Settings size={14} color="var(--accent)" style={{flexShrink: 0}}/>
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} title={equipmentLabel}>{equipmentLabel}</span>
                  </div>
                  <div style={{...s.cardText, fontSize: 'var(--text-xs)', color: 'var(--text-muted)'}}>
                    <Hash size={12} color="var(--accent)"/> {os.equipment?.serialNumber || 'S/N não inf.'}
                  </div>
                  <div style={s.cardDefect}>{os.defect}</div>

                  {os.status === 'ARQUIVADA' ? (
                    <div style={{fontSize: 'var(--text-xs)', color: 'var(--accent)', marginTop: 'var(--space-3)', background: 'var(--bg-base)', padding: 'var(--space-2)', borderRadius: '4px', border: '1px solid var(--border-color)'}}>
                      <div>Fechada em: {new Date(os.closedAt || os.updatedAt).toLocaleString('pt-BR')}</div>
                      <div>Por: {os.closedBy?.name || 'Sistema'}</div>
                    </div>
                  ) : (
                    <div style={{fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <span>{os.user?.name || 'Atendente'}</span>
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        color: days >= 3 ? 'var(--danger)' : days >= 1 ? 'var(--warning)' : 'var(--text-dim)',
                        fontWeight: days >= 3 ? 800 : 500
                      }}>
                        <Clock size={11} />
                        {days === 0 ? 'hoje' : `${days}d`}
                      </span>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {showModal && selectedOs && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0}}>
                <FileText color="var(--accent)" size={24} style={{flexShrink: 0}} />
                <h2 style={{color: 'var(--text-main)', margin: 0, fontSize: 'var(--text-xl)', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>O.S. #{selectedOs.id.substring(selectedOs.id.length - 6).toUpperCase()}</h2>
              </div>
              <button onClick={() => setShowModal(false)} aria-label="Fechar" style={{background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-sm)', flexShrink: 0}}>✕</button>
            </div>

            <div style={s.modalContent}>
              <div style={s.sidebar}>
                <h4 style={{color: 'var(--accent)', marginTop: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.1em'}}>DADOS DO CLIENTE</h4>
                <div style={{marginBottom: 'var(--space-5)'}}>
                  <div style={{color: 'var(--text-main)', fontWeight: 800, fontSize: 'var(--text-lg)', marginBottom: '4px', wordBreak: 'break-word'}}>{getClientName(selectedOs)}</div>
                  <div style={{color: 'var(--text-muted)', fontSize: 'var(--text-sm)'}}>Solicitante: {selectedOs.contact?.name}</div>
                  <div style={{color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)'}}><Hash size={12} style={{display: 'inline', marginRight: '4px'}}/> {selectedOs.equipment?.contact?.cpfCnpj || selectedOs.contact?.cpfCnpj || 'CNPJ não informado'}</div>
                </div>

                <h4 style={{color: 'var(--accent)', marginBottom: 'var(--space-3)', fontSize: 'var(--text-xs)', textTransform: 'uppercase'}}>EQUIPAMENTO</h4>
                <div style={{color: 'var(--text-main)', fontSize: 'var(--text-sm)', marginBottom: '4px', wordBreak: 'break-word'}}>{selectedOs.equipment?.model}</div>
                <div style={{color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)'}}>Série: {selectedOs.equipment?.serialNumber}</div>
                <div style={{color: 'var(--text-muted)', fontSize: 'var(--text-sm)', display: 'flex', gap: '4px'}}>
                  <MapPin size={14} color="var(--accent)" style={{flexShrink: 0}} />
                  <span style={{wordBreak: 'break-word'}}>{selectedOs.equipment?.address || selectedOs.contact?.address}</span>
                </div>
              </div>

              <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0}}>
                <div>
                  <label style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, marginBottom: 'var(--space-2)', display: 'block'}}>Status da Ordem</label>
                  <select style={{...s.input, width: '100%', height: '45px'}} value={status} onChange={e=>setStatus(e.target.value)}>
                    {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    <option value="ARQUIVADA">Arquivada</option>
                  </select>
                </div>

                <div>
                  <label style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, marginBottom: 'var(--space-2)', display: 'block'}}>Leitura de Contadores</label>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)'}}>
                     <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                       <span style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)'}}>P&B</span>
                       <input style={{...s.input, padding: '12px'}} placeholder="000" value={meters.mono} onChange={e=>setMeters({...meters, mono: e.target.value})} />
                     </div>
                     <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                       <span style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)'}}>COLOR</span>
                       <input style={{...s.input, padding: '12px'}} placeholder="000" value={meters.color} onChange={e=>setMeters({...meters, color: e.target.value})} />
                     </div>
                     <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                       <span style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)'}}>SCANNER</span>
                       <input style={{...s.input, padding: '12px'}} placeholder="000" value={meters.scan} onChange={e=>setMeters({...meters, scan: e.target.value})} />
                     </div>
                  </div>
                </div>

                <div>
                  <label style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, marginBottom: 'var(--space-2)', display: 'block'}}>Defeito / Solicitação do Cliente</label>
                  <div style={{background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', color: 'var(--text-main)', fontWeight: 700, fontSize: 'var(--text-md)', borderLeft: '4px solid var(--accent)', wordBreak: 'break-word', overflowWrap: 'break-word'}}>
                    {selectedOs.defect}
                  </div>
                </div>

                <div>
                  <label style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, marginBottom: 'var(--space-2)', display: 'block'}}>Relatório Técnico / Peças Substituídas</label>
                  <textarea
                    style={{...s.input, minHeight: '180px', resize: 'vertical', padding: 'var(--space-4)', lineHeight: 'var(--leading-normal)', width: '100%'}}
                    placeholder="Descreva detalhadamente o serviço executado..."
                    value={notes}
                    onChange={e=>setNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div style={s.btnGroup}>
              {/^\d+$/.test(String(selectedOs.externalId || '')) && selectedOs.status !== 'ERRO_INTEGRACAO'
                ? <a href={`${BACKEND_URL}/api/os/${selectedOs.id}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noreferrer" style={s.pdfBtn}>Abrir / Imprimir O.S.</a>
                : <span style={{ ...s.pdfBtn, opacity: 0.55, cursor: 'not-allowed' }}>Aguardando confirmação do ILUX WEB</span>}
              <button style={{...s.saveBtn, opacity: saving ? 0.7 : 1, cursor: saving ? 'default' : 'pointer'}} onClick={() => handleUpdate()} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar Atualizações'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
