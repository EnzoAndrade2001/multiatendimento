import React, { useState, useEffect, useRef } from 'react';
import api, { BACKEND_URL, getEquipments, getOpenOrdersForEquipment } from '../services/api';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, FileText, LoaderCircle, MapPin, Minus, Package, Plus, Printer, Search, Trash2, Wand2 } from 'lucide-react';
import EquipmentPickerModal, { equipmentAddress, equipmentOperationalLocation } from './EquipmentPickerModal';
import ProductPickerModal from './ProductPickerModal';
import { toast } from '../utils/toast';

export default function CreateOsModal({ ticket, onClose, onCreated }) {
  const modalContext = useRef({ ticketId: ticket.id, contactId: ticket.contact?.id });
  const [equipments, setEquipments] = useState([]);
  const [osTypes, setOsTypes] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [defectTypes, setDefectTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingOrderId, setPendingOrderId] = useState('');
  const [createdOrder, setCreatedOrder] = useState(null);
  const [equipmentPickerOpen, setEquipmentPickerOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [requestKey] = useState(() => (
    globalThis.crypto?.randomUUID?.() || `os-${Date.now()}-${Math.random().toString(16).slice(2)}`
  ));
  const [formData, setFormData] = useState({ equipmentId: '', defect: '', cdOstp: '', cdDefeito: '', nmsuportet: '' });
  const [openOrders, setOpenOrders] = useState([]);
  const [checkingOpen, setCheckingOpen] = useState(false);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [produtoSearch, setProdutoSearch] = useState('');
  const [produtoQtd, setProdutoQtd] = useState(1);
  const [showProdDropdown, setShowProdDropdown] = useState(false);
  const formEditedRef = useRef(false);

  function updateFormData(updater) {
    formEditedRef.current = true;
    setFormData(updater);
  }

  function addProdutoItem(prodItem = null, explicitQtd = null) {
    const nome = (prodItem?.nome || produtoSearch).trim();
    if (!nome) return;
    const qtd = explicitQtd ? Math.max(1, explicitQtd) : Math.max(1, parseInt(produtoQtd, 10) || 1);
    const existingIndex = produtos.findIndex(
      (p) => (prodItem?.id && p.produtoId === prodItem.id) || p.nome.toLowerCase() === nome.toLowerCase()
    );
    if (existingIndex >= 0) {
      const next = [...produtos];
      next[existingIndex].quantidade += qtd;
      setProdutos(next);
    } else {
      setProdutos([
        ...produtos,
        {
          produtoId: prodItem?.id || nome,
          nome: prodItem?.nome || nome.toUpperCase(),
          codigo: prodItem?.codigo || null,
          tipo: prodItem?.tipo || 'SUPRIMENTO',
          quantidade: qtd,
        },
      ]);
    }
    setProdutoSearch('');
    setProdutoQtd(1);
    setShowProdDropdown(false);
  }

  function removeProdutoItem(idx) {
    setProdutos((prev) => prev.filter((_, i) => i !== idx));
  }

  function removeProdutoItemById(prodId) {
    setProdutos((prev) => prev.filter((p) => p.produtoId !== prodId && p.nome !== prodId));
  }

  function updateProdutoQtd(idx, delta) {
    setProdutos((prev) => {
      const next = [...prev];
      const n = Math.max(1, (next[idx].quantidade || 1) + delta);
      next[idx] = { ...next[idx], quantidade: n };
      return next;
    });
  }

  function updateProdutoQtdById(prodId, delta) {
    setProdutos((prev) => {
      const idx = prev.findIndex((p) => p.produtoId === prodId || p.nome === prodId);
      if (idx < 0) return prev;
      const next = [...prev];
      const n = (next[idx].quantidade || 1) + delta;
      if (n <= 0) {
        return next.filter((_, i) => i !== idx);
      }
      next[idx] = { ...next[idx], quantidade: n };
      return next;
    });
  }

  const selectedEquipment = equipments.find((equipment) => equipment.id === formData.equipmentId);

  // Ao escolher o equipamento, avisa se ele já tem O.S. em aberto (mesma
  // checagem do cockpit Saúde do Parque). Não bloqueia — informa.
  useEffect(() => {
    if (!formData.equipmentId) { setOpenOrders([]); return; }
    let active = true;
    setCheckingOpen(true);
    getOpenOrdersForEquipment(formData.equipmentId)
      .then(({ data }) => { if (active) setOpenOrders(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setOpenOrders([]); })
      .finally(() => { if (active) setCheckingOpen(false); });
    return () => { active = false; };
  }, [formData.equipmentId]);

  function getPdfUrl(order) {
    const token = encodeURIComponent(localStorage.getItem('token') || '');
    return `${BACKEND_URL}/api/os/${order.id}/pdf?token=${token}`;
  }

  function completeOrder(order) {
    const expected = {
      ticketId: modalContext.current.ticketId,
      contactId: modalContext.current.contactId,
      equipmentId: formData.equipmentId,
    };
    const externalId = String(order?.externalId || '').trim();
    const matchesContext = /^\d+$/.test(externalId)
      && order?.ticketId === expected.ticketId
      && order?.contactId === expected.contactId
      && order?.equipmentId === expected.equipmentId;

    if (!matchesContext) {
      console.error('[CreateOsModal] confirmação de O.S. rejeitada por contexto divergente', {
        orderId: order?.id,
        expected,
        received: {
          ticketId: order?.ticketId,
          contactId: order?.contactId,
          equipmentId: order?.equipmentId,
          hasExternalId: Boolean(externalId),
        },
      });
      setError('A O.S. foi localizada, mas os dados não correspondem a esta conversa. Nenhuma confirmação foi enviada. Atualize e tente novamente.');
      return false;
    }
    setCreatedOrder(order);
    Promise.resolve(onCreated?.(order, expected)).catch((callbackError) => {
      console.error('[CreateOsModal] erro após confirmar O.S.:', callbackError);
    });
    return true;
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      formEditedRef.current = false;
      const contactId = ticket.contact?.id;
      if (!contactId) {
        toast.error('Contato não vinculado ao ticket.');
        onClose();
        return;
      }
      
      const [resEquips, resTypes, resTechs, resDefectTypes, resProducts] = await Promise.all([
        getEquipments(contactId),
        api.get('/os/types'),
        api.get('/os/technicians'),
        api.get('/os/defect-types'),
        api.get('/os/products').catch(() => ({ data: { items: [] } })),
      ]);

      setEquipments(resEquips.data);
      setOsTypes(resTypes.data);
      setTechnicians(resTechs.data);
      setDefectTypes(resDefectTypes.data);
      setAvailableProducts(
        Array.isArray(resProducts.data?.items)
          ? resProducts.data.items
          : (Array.isArray(resProducts.data) ? resProducts.data : [])
      );
      
      const foundType = resTypes.data.find(t => t.code === '01')
        || resTypes.data.find(t => t.name.toUpperCase().includes('CONTRAT'))
        || resTypes.data.find(t => t.code === '02')
        || resTypes.data[0];

      const foundTech = resTechs.data.find(t => t.name.toUpperCase().includes('ROBSON'))
        || null;

      const defaultFormData = {
        defect: '',
        equipmentId: resEquips.data.length === 1 ? resEquips.data[0].id : '',
        cdOstp: foundType ? foundType.code : '',
        cdDefeito: '',
        nmsuportet: foundTech ? foundTech.name : ''
      };
      setFormData(defaultFormData);

      // O rascunho Ã© auxiliar: o formulÃ¡rio fica disponÃ­vel assim que os
      // dados bÃ¡sicos chegam, sem obrigar o atendente a esperar a IA.
      setLoading(false);
      setDrafting(true);
      try {
        const resDraft = await api.post('/os/draft', { contactId, ticketId: ticket.id }, { timeout: 25_000 });
        const { defect, equipmentId } = resDraft.data || {};
        if (!formEditedRef.current) {
          setFormData((current) => ({
            ...current,
            defect: defect || current.defect,
            equipmentId: equipmentId || current.equipmentId,
          }));
        }
      } catch (draftError) {
        console.warn('[CreateOsModal] rascunho da IA indisponÃ­vel:', draftError?.message || draftError);
        setError('A IA demorou para responder. O formulÃ¡rio estÃ¡ liberado para preenchimento manual.');
      } finally {
        setDrafting(false);
      }
    } catch (e) {
      console.error(e);
      setError('Não foi possível carregar os dados para abrir a O.S. Feche e tente novamente.');
    } finally {
      setLoading(false);
      setDrafting(false);
    }
  }

  async function handleSave() {
    if (!formData.equipmentId) return toast.error('Selecione um equipamento.');
    if (!formData.cdOstp) return toast.error('Selecione o tipo de O.S.');
    if (!formData.cdDefeito) return toast.error('Selecione o tipo de defeito.');
    if (!formData.defect) return toast.error('Informe o defeito reportado.');
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/os', {
        contactId: ticket.contact?.id,
        equipmentId: formData.equipmentId,
        ticketId: ticket.id,
        requestKey,
        defect: formData.defect,
        cdOstp: formData.cdOstp,
        cdDefeito: formData.cdDefeito,
        nmsuportet: formData.nmsuportet,
        produtos: produtos.map((p) => ({
          produtoId: p.produtoId,
          nome: p.nome,
          codigo: p.codigo,
          tipo: p.tipo,
          quantidade: p.quantidade,
        })),
      });
      completeOrder(res.data);
    } catch (e) {
      setPendingOrderId(e.response?.data?.serviceOrderId || '');
      setError(e.response?.data?.error || 'Não foi possível confirmar a abertura no ILUX WEB. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function checkStatus() {
    if (!pendingOrderId) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await api.get(`/os/${pendingOrderId}/status`);
      if (!data.externalId) {
        setError('A abertura ainda não foi confirmada pelo ILUX WEB. Aguarde alguns segundos e tente novamente.');
        return;
      }
      completeOrder(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Não foi possível consultar a abertura. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  const s = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { background: 'var(--bg-panel)', width: '740px', maxWidth: '95vw', maxHeight: '92vh', overflowY: 'auto', borderRadius: '16px', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column' },
    title: { fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text-main)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
    input: { width: '100%', padding: 'var(--space-3)', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-main)', outline: 'none', marginBottom: 'var(--space-4)' },
    equipmentTrigger: { width: '100%', minHeight: '54px', padding: '10px 12px', marginBottom: 'var(--space-4)', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-main)', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '10px', textAlign: 'left' },
    label: { fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 700, marginBottom: '6px', display: 'block' },
    btnGroup: { display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' },
    saveBtn: { flex: 1, background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', padding: 'var(--space-3)', borderRadius: '8px', fontWeight: 800, cursor: 'pointer' },
    cancelBtn: { flex: 1, background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: 'var(--space-3)', borderRadius: '8px', fontWeight: 800, cursor: 'pointer' },
    openWarn: { padding: '10px 12px', marginBottom: 'var(--space-4)', borderRadius: '10px', background: 'var(--warning-light, rgba(245,158,11,0.08))', border: '1px solid var(--warning-border, rgba(245,158,11,0.3))', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
    draftNotice: { display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 10px', marginBottom: 'var(--space-4)', borderRadius: '8px', background: 'var(--accent-light)', border: '1px solid var(--accent-border)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
    openWarnRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '5px 0', fontSize: 'var(--text-xs)', borderTop: '1px solid var(--border-color)' },
    openWarnLink: { display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 700, flexShrink: 0 }
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <h2 style={s.title}><FileText size={20}/> Nova Ordem de Serviço</h2>
        
        {createdOrder ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-2) var(--space-2)' }}>
            <CheckCircle2 size={48} color="var(--success)" style={{ marginBottom: 'var(--space-3)' }} />
            <h3 style={{ margin: '0 0 8px', color: 'var(--text-main)' }}>O.S. criada no ILUX WEB</h3>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 900, color: 'var(--accent)', marginBottom: 'var(--space-2)', fontVariantNumeric: 'tabular-nums' }}>
              Nº {createdOrder.externalId}
            </div>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-5)' }}>
              O número acima foi confirmado diretamente pelo banco do ILUX WEB.
            </p>
            <div style={s.btnGroup}>
              <a
                href={getPdfUrl(createdOrder)}
                target="_blank"
                rel="noreferrer"
                style={{ ...s.saveBtn, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <Printer size={16} /> Imprimir O.S.
              </a>
              <button style={s.cancelBtn} onClick={onClose}>Concluir</button>
            </div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)' }}>
            <Wand2 size={32} style={{ animation: 'ui-spin 2s linear infinite', marginBottom: 'var(--space-4)' }} />
            <div>Carregando dados para abrir a O.S...</div>
          </div>
        ) : (
          <div>
            {drafting ? (
              <div style={s.draftNotice} role="status">
                <Wand2 size={14} style={{ animation: 'ui-spin 1.5s linear infinite', flexShrink: 0 }} />
                A IA está preparando um rascunho. Você já pode revisar e preencher o formulário.
              </div>
            ) : null}
            <label style={s.label}>EQUIPAMENTO</label>
            <button type="button" style={s.equipmentTrigger} onClick={() => setEquipmentPickerOpen(true)}>
              <MapPin size={18} color={selectedEquipment ? 'var(--accent)' : 'var(--text-muted)'} />
              <span style={{ minWidth: 0, overflow: 'hidden' }}>
                {selectedEquipment ? (
                  <>
                    <strong style={{ display: 'block', fontSize: 'var(--text-sm)', marginBottom: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${selectedEquipment.model} · Série ${selectedEquipment.serialNumber || 'S/N'}`}>
                      {selectedEquipment.model} · Série {selectedEquipment.serialNumber || 'S/N'}
                    </strong>
                    <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={equipmentAddress(selectedEquipment) || equipmentOperationalLocation(selectedEquipment) || 'Localização não informada'}>
                      {equipmentAddress(selectedEquipment) || equipmentOperationalLocation(selectedEquipment) || 'Localização não informada'}
                    </span>
                  </>
                ) : <span style={{ color: 'var(--text-muted)' }}>Selecionar equipamento...</span>}
              </span>
              <ChevronDown size={17} color="var(--text-muted)" />
            </button>

            <EquipmentPickerModal
              open={equipmentPickerOpen}
              equipments={equipments}
              selectedId={formData.equipmentId}
              onClose={() => setEquipmentPickerOpen(false)}
              onSelect={(equipment) => updateFormData((current) => ({ ...current, equipmentId: equipment.id }))}
            />

            <ProductPickerModal
              open={productPickerOpen}
              products={availableProducts}
              selectedProducts={produtos}
              onSelectProduct={(prod, qtd) => addProdutoItem(prod, qtd)}
              onUpdateQuantidade={(prodId, delta) => updateProdutoQtdById(prodId, delta)}
              onRemoveProduct={(prodId) => removeProdutoItemById(prodId)}
              onClose={() => setProductPickerOpen(false)}
            />

            {openOrders.length > 0 ? (
              <div style={s.openWarn}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, marginBottom: '6px' }}>
                  <AlertTriangle size={16} /> Este equipamento já tem {openOrders.length} O.S. em aberto
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '8px' }}>
                  Revise antes de abrir outra para não duplicar o atendimento.
                </div>
                {openOrders.map((o) => (
                  <div key={o.id} style={s.openWarnRow}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong>O.S. {o.externalId || o.id}</strong> — {[o.status, o.defect].filter(Boolean).join(' · ') || 'sem descrição'}
                    </span>
                    <a href={`${BACKEND_URL}/api/os/${encodeURIComponent(o.externalId || o.id)}/pdf?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                      target="_blank" rel="noreferrer" style={s.openWarnLink}>
                      <ExternalLink size={12} /> ver
                    </a>
                  </div>
                ))}
              </div>
            ) : null}

            <label style={s.label}>TIPO DE O.S. / SERVIÇO</label>
            <select 
              style={s.input} 
              value={formData.cdOstp} 
              onChange={e => updateFormData({...formData, cdOstp: e.target.value})}
            >
              <option value="">Selecione o tipo...</option>
              {osTypes.map(t => (
                <option key={t.id} value={t.code} disabled={t.inactive}>
                  {t.name} ({t.code}) — O.S. CRM{t.inactive ? ' — inativo' : ''}
                </option>
              ))}
            </select>

            <label style={s.label}>TIPO DE DEFEITO</label>
            <select
              style={s.input}
              value={formData.cdDefeito}
              onChange={e => updateFormData({...formData, cdDefeito: e.target.value})}
            >
              <option value="">Selecione o tipo de defeito...</option>
              {defectTypes.map(type => (
                <option key={type.id} value={type.code}>
                  {type.code} — {type.name}
                </option>
              ))}
            </select>

            <label style={s.label}>TÉCNICO DESIGNADO (OPCIONAL)</label>
            <select 
              style={s.input} 
              value={formData.nmsuportet} 
              onChange={e => updateFormData({...formData, nmsuportet: e.target.value})}
            >
              <option value="">Nenhum / Aberto</option>
              {technicians.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>

            <div style={{ marginBottom: 'var(--space-4)', padding: '14px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <label style={{ ...s.label, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Package size={14} /> PEÇAS / TONERS UTILIZADOS (OPCIONAL)
                </label>
                {produtos.length > 0 && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 800 }}>
                    {produtos.reduce((acc, p) => acc + (p.quantidade || 1), 0)} un selecionada(s)
                  </span>
                )}
              </div>

              {/* Botão de destaque para abrir o catálogo amplo com pesquisa e filtros */}
              <button
                type="button"
                onClick={() => setProductPickerOpen(true)}
                style={{
                  width: '100%',
                  padding: '11px 16px',
                  marginBottom: '10px',
                  background: 'rgba(234, 88, 12, 0.08)',
                  border: '1.5px dashed var(--accent)',
                  borderRadius: '9px',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: 700,
                  fontSize: 'var(--text-sm)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Search size={16} /> Localizar Peça / Toner no Catálogo Completo...
              </button>

              {/* Input de busca/digitação e quantidade */}
              <div style={{ position: 'relative', display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="text"
                    style={{ ...s.input, marginBottom: 0, paddingRight: '28px' }}
                    placeholder="Ou digite o nome do toner / peça para busca rápida..."
                    value={produtoSearch}
                    onChange={(e) => {
                      setProdutoSearch(e.target.value);
                      setShowProdDropdown(true);
                    }}
                    onFocus={() => setShowProdDropdown(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addProdutoItem();
                      }
                    }}
                  />
                  {showProdDropdown && availableProducts.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                        maxHeight: '260px',
                        overflowY: 'auto',
                        zIndex: 50,
                        marginTop: '4px',
                      }}
                    >
                      {availableProducts
                        .filter((p) => !produtoSearch || p.nome?.toLowerCase().includes(produtoSearch.toLowerCase()) || p.codigo?.toLowerCase().includes(produtoSearch.toLowerCase()))
                        .slice(0, 20)
                        .map((prod) => (
                          <div
                            key={prod.id}
                            style={{
                              padding: '9px 12px',
                              cursor: 'pointer',
                              borderBottom: '1px solid var(--border-color)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 'var(--text-xs)',
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addProdutoItem(prod);
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1, marginRight: '10px' }}>
                              <strong style={{ display: 'block', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {prod.nome}
                              </strong>
                              {prod.codigo && <span style={{ color: 'var(--text-muted)' }}>Cód: {prod.codigo} · {prod.tipo}</span>}
                            </div>
                            <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>+ Selecionar</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', width: '90px' }}>
                  <input
                    type="number"
                    min="1"
                    style={{ ...s.input, marginBottom: 0, textAlign: 'center', padding: 'var(--space-2)' }}
                    value={produtoQtd}
                    onChange={(e) => setProdutoQtd(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    title="Quantidade"
                  />
                </div>

                <button
                  type="button"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--text-inverse)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: 700,
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => addProdutoItem()}
                >
                  <Plus size={14} /> Adicionar
                </button>
              </div>

              {/* Lista de itens adicionados */}
              {produtos.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  {produtos.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, marginRight: '8px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-main)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {item.nome}
                        </span>
                        {item.codigo && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Cód: {item.codigo}</span>}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => updateProdutoQtd(idx, -1)}
                          style={{
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-base)',
                            color: 'var(--text-main)',
                            borderRadius: '4px',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <Minus size={12} />
                        </button>
                        <span style={{ fontWeight: 800, minWidth: '24px', textAlign: 'center', color: 'var(--text-main)' }}>
                          {item.quantidade}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateProdutoQtd(idx, 1)}
                          style={{
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-base)',
                            color: 'var(--text-main)',
                            borderRadius: '4px',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <Plus size={12} />
                        </button>

                        <button
                          type="button"
                          onClick={() => removeProdutoItem(idx)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--danger)',
                            padding: '4px',
                            marginLeft: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Remover produto"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: '6px 0' }}>
                  Nenhum toner ou peça adicionado a esta O.S.
                </div>
              )}
            </div>

            <label style={s.label}>RELATO DO CLIENTE (Extraído pela IA)</label>
            <textarea
              style={{...s.input, minHeight: '100px', resize: 'vertical'}}
              placeholder="Descreva o problema relatado pelo cliente..."
              value={formData.defect}
              onChange={e => updateFormData({...formData, defect: e.target.value})}
            />

            {error ? (
              <div style={{ padding: '10px 12px', marginBottom: 'var(--space-3)', borderRadius: '8px', background: 'var(--danger-light)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)', fontSize: 'var(--text-sm)' }}>
                {error}
              </div>
            ) : null}

            <div style={s.btnGroup}>
              <button style={s.cancelBtn} onClick={onClose} disabled={saving}>Cancelar</button>
              {pendingOrderId ? (
                <>
                  <button style={{ ...s.saveBtn, opacity: saving ? 0.65 : 1 }} onClick={checkStatus} disabled={saving}>
                    {saving ? 'Consultando...' : 'Verificar no ILUX WEB'}
                  </button>
                  <button style={{ ...s.saveBtn, opacity: saving ? 0.65 : 1 }} onClick={handleSave} disabled={saving}>
                    Tentar novamente
                  </button>
                </>
              ) : (
                <button style={{ ...s.saveBtn, opacity: saving ? 0.65 : 1 }} onClick={handleSave} disabled={saving}>
                  {saving ? <><LoaderCircle size={16} style={{ verticalAlign: 'middle', marginRight: '8px' }} />Abrindo no ILUX WEB...</> : (openOrders.length > 0 ? 'Abrir outra mesmo assim' : 'Abrir O.S. no ILUX WEB')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
