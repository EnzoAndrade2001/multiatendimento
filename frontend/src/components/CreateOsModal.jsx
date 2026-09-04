import React, { useState, useEffect, useRef } from 'react';
import api, { BACKEND_URL, getEquipments, getOpenOrdersForEquipment } from '../services/api';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, FileText, LoaderCircle, MapPin, Printer, Wand2 } from 'lucide-react';
import EquipmentPickerModal, { equipmentAddress, equipmentOperationalLocation } from './EquipmentPickerModal';
import { toast } from '../utils/toast';

export default function CreateOsModal({ ticket, onClose, onCreated }) {
  const modalContext = useRef({ ticketId: ticket.id, contactId: ticket.contact?.id });
  const [equipments, setEquipments] = useState([]);
  const [osTypes, setOsTypes] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingOrderId, setPendingOrderId] = useState('');
  const [createdOrder, setCreatedOrder] = useState(null);
  const [equipmentPickerOpen, setEquipmentPickerOpen] = useState(false);
  const [requestKey] = useState(() => (
    globalThis.crypto?.randomUUID?.() || `os-${Date.now()}-${Math.random().toString(16).slice(2)}`
  ));
  const [formData, setFormData] = useState({ equipmentId: '', defect: '', cdOstp: '', nmsuportet: '' });
  const [openOrders, setOpenOrders] = useState([]);
  const [checkingOpen, setCheckingOpen] = useState(false);
  const formEditedRef = useRef(false);

  function updateFormData(updater) {
    formEditedRef.current = true;
    setFormData(updater);
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
      
      const [resEquips, resTypes, resTechs] = await Promise.all([
        getEquipments(contactId),
        api.get('/os/types'),
        api.get('/os/technicians')
      ]);

      setEquipments(resEquips.data);
      setOsTypes(resTypes.data);
      setTechnicians(resTechs.data);
      
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
        nmsuportet: formData.nmsuportet
      });
      completeOrder(res.data);
    } catch (e) {
      setPendingOrderId(e.response?.data?.serviceOrderId || '');
      setError(e.response?.data?.error || 'Não foi possível confirmar a abertura no iLux. Tente novamente.');
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
        setError('A abertura ainda não foi confirmada pelo agente do iLux. Aguarde alguns segundos e tente novamente.');
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
    modal: { background: 'var(--bg-panel)', width: '500px', maxWidth: '95%', borderRadius: '16px', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column' },
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
            <h3 style={{ margin: '0 0 8px', color: 'var(--text-main)' }}>O.S. criada no iLux</h3>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 900, color: 'var(--accent)', marginBottom: 'var(--space-2)', fontVariantNumeric: 'tabular-nums' }}>
              Nº {createdOrder.externalId}
            </div>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 var(--space-5)' }}>
              O número acima foi confirmado diretamente pelo banco do iLux.
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
                  {t.name} ({t.code}){t.formulario ? ` — ${t.formulario}` : ''}{t.inactive ? ' — inativo' : ''}
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

            <label style={s.label}>DEFEITO REPORTADO (Extraído pela IA)</label>
            <textarea
              style={{...s.input, minHeight: '100px', resize: 'vertical'}}
              placeholder="Descreva o defeito relatado pelo cliente..."
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
                    {saving ? 'Consultando...' : 'Verificar no iLux'}
                  </button>
                  <button style={{ ...s.saveBtn, opacity: saving ? 0.65 : 1 }} onClick={handleSave} disabled={saving}>
                    Tentar novamente
                  </button>
                </>
              ) : (
                <button style={{ ...s.saveBtn, opacity: saving ? 0.65 : 1 }} onClick={handleSave} disabled={saving}>
                  {saving ? <><LoaderCircle size={16} style={{ verticalAlign: 'middle', marginRight: '8px' }} />Abrindo no iLux...</> : (openOrders.length > 0 ? 'Abrir outra mesmo assim' : 'Abrir O.S. no iLux')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
