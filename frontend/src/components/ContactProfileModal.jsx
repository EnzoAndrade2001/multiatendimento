import React, { useState, useEffect } from 'react';
import api, { updateContact, deleteContact, getEquipments, updateEquipment, deleteEquipment } from '../services/api';
import { toast } from '../utils/toast';
import { Printer, FileText, User, Trash2, Edit3 } from 'lucide-react';
import ActionButton from './ui/ActionButton';
import ModalShell from './ui/ModalShell';

const BACKEND_URL = import.meta.env.VITE_API_URL || '';
const EMPTY_EQUIPMENT = { manufacturer: '', model: '', serialNumber: '', sector: '', address: '', type: '' };

function mapEquipmentToForm(equipment) {
  return {
    manufacturer: equipment?.manufacturer || '',
    model: equipment?.model || '',
    serialNumber: equipment?.serialNumber || '',
    sector: equipment?.sector || '',
    address: equipment?.address || '',
    type: equipment?.type || '',
  };
}

export default function ContactProfileModal({ contact, onClose, onUpdated, initialTab = 'dados', initialEquipment = null }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [formData, setFormData] = useState({
    name: contact.name || '',
    fantasyName: contact.fantasyName || '',
    phone: contact.phone || '',
    whatsapp: contact.whatsapp || '',
    cpfCnpj: contact.cpfCnpj || '',
    email: contact.email || '',
    address: contact.address || '',
    city: contact.city || '',
    state: contact.state || '',
    zipCode: contact.zipCode || '',
  });
  const [equipments, setEquipments] = useState([]);
  const [osHistory, setOsHistory] = useState([]);
  const [newEquip, setNewEquip] = useState(initialEquipment ? mapEquipmentToForm(initialEquipment) : { ...EMPTY_EQUIPMENT });
  const [editingEquipId, setEditingEquipId] = useState(null);
  const [savingData, setSavingData] = useState(false);
  const [savingEquip, setSavingEquip] = useState(false);

  useEffect(() => {
    if (activeTab === 'equipamentos') loadEquipments();
    if (activeTab === 'os') loadOsHistory();
  }, [activeTab, contact.id]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [contact.id, initialTab]);

  useEffect(() => {
    if (activeTab !== 'equipamentos') return;

    if (initialEquipment?.id) {
      setEditingEquipId(initialEquipment.id);
      setNewEquip(mapEquipmentToForm(initialEquipment));
      return;
    }

    setEditingEquipId(null);
    setNewEquip({ ...EMPTY_EQUIPMENT });
  }, [activeTab, contact.id, initialEquipment]);

  async function loadEquipments() {
    try {
      const res = await getEquipments(contact.id);
      setEquipments(res.data);
    } catch (e) {
      // noop
    }
  }

  async function loadOsHistory() {
    try {
      const res = await api.get('/os');
      setOsHistory(
        res.data.filter((os) => os.contactId === contact.id || os.equipment?.contactId === contact.id)
      );
    } catch (e) {
      // noop
    }
  }

  async function handleUpdateData() {
    if (savingData) return;
    setSavingData(true);
    try {
      await updateContact(contact.id, formData);
      onUpdated();
      toast.success('Dados salvos');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar dados do cliente');
    } finally {
      setSavingData(false);
    }
  }

  async function handleDeleteContact() {
    const contactLabel = contact.fantasyName || contact.name || 'este cliente';
    toast.confirm(`Excluir "${contactLabel}"? Isso apaga permanentemente o cadastro e todo o histórico de conversas, equipamentos e O.S. Essa ação não pode ser desfeita.`, async () => {
      try {
        await deleteContact(contact.id);
        onUpdated();
        onClose();
        toast.success('Cliente excluído');
      } catch (e) {
        toast.error(e.response?.data?.error || 'Erro ao excluir cliente');
      }
    });
  }

  async function handleAddOrUpdateEquip() {
    if (!newEquip.model) return toast.error('Informe o modelo do equipamento');
    if (savingEquip) return;
    setSavingEquip(true);
    try {
      if (editingEquipId) {
        await updateEquipment(editingEquipId, newEquip);
        setEditingEquipId(null);
        toast.success('Equipamento atualizado');
      } else {
        await api.post(`/os/contacts/${contact.id}/equipments`, newEquip);
        toast.success('Equipamento adicionado');
      }
      setNewEquip({ ...EMPTY_EQUIPMENT });
      loadEquipments();
      onUpdated?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Erro ao salvar equipamento');
    } finally {
      setSavingEquip(false);
    }
  }

  function startEditEquip(equipment) {
    setEditingEquipId(equipment.id);
    setNewEquip(mapEquipmentToForm(equipment));
  }

  async function handleDeleteEquip(id) {
    const equipLabel = equipments.find((equipment) => equipment.id === id)?.model || 'este equipamento';
    toast.confirm(`Excluir o equipamento "${equipLabel}"? Essa ação não pode ser desfeita.`, async () => {
      try {
        await deleteEquipment(id);
        loadEquipments();
        onUpdated?.();
        toast.success('Equipamento excluído');
      } catch (e) {
        toast.error(e.response?.data?.error || 'Erro ao excluir equipamento');
      }
    });
  }

  function renderFooterActions() {
    if (activeTab === 'dados') {
      return (
        <>
          <ActionButton variant="danger" style={s.footerBtn} onClick={handleDeleteContact}>
            <Trash2 size={16} /> Excluir perfil
          </ActionButton>
          <ActionButton variant="secondary" style={s.footerBtn} onClick={onClose}>
            Fechar
          </ActionButton>
          <ActionButton style={s.footerBtn} loading={savingData} onClick={handleUpdateData}>
            Salvar dados
          </ActionButton>
        </>
      );
    }

    if (activeTab === 'equipamentos') {
      return (
        <>
          <ActionButton variant="secondary" style={s.footerBtn} onClick={onClose}>
            Fechar
          </ActionButton>
          <ActionButton style={s.footerBtn} loading={savingEquip} onClick={handleAddOrUpdateEquip}>
            {editingEquipId ? 'Salvar alterações' : 'Adicionar equipamento'}
          </ActionButton>
        </>
      );
    }

    return (
      <ActionButton variant="secondary" style={s.footerBtn} onClick={onClose}>
        Fechar
      </ActionButton>
    );
  }

  function statusBadge(status) {
    const colors = {
      PENDENTE: '#ff4d4f',
      EM_ATENDIMENTO: '#faad14',
      AGUARDANDO_RETORNO: '#ff9c6e',
      FINALIZADA: '#52c41a',
    };

    return {
      background: colors[status] || 'var(--text-dim)',
      color: '#fff',
      padding: '4px 8px',
      borderRadius: '999px',
      fontSize: '0.7rem',
      fontWeight: 800,
    };
  }

  return (
    <ModalShell kicker="Perfil do cliente" title={contact.name || 'Cliente'} onClose={onClose} maxWidth="52rem">
      <div className="contact-profile" style={s.panelBody}>
        <style>{contactProfileCss}</style>
        <div style={s.profileSummary}>
          <div style={s.profileIdentity}>
            <div style={s.profileAvatar}><User size={18} /></div>
            <div style={{ minWidth: 0 }}>
              <strong style={s.profileName}>{contact.fantasyName || contact.name || 'Cliente'}</strong>
              <span style={s.profileMeta}>{contact.cpfCnpj || 'Documento não informado'} · {contact.phone || contact.whatsapp || 'Telefone não informado'}</span>
            </div>
          </div>
          <span style={s.profileCode}>ID {String(contact.externalId || contact.id || '—').slice(-8)}</span>
        </div>
        <div className="contact-profile-tabs" style={s.tabs} role="tablist" aria-label="Seções do perfil">
          <button type="button" role="tab" aria-selected={activeTab === 'dados'} style={{ ...s.tab, ...(activeTab === 'dados' ? s.tabActive : {}) }} onClick={() => setActiveTab('dados')}>
            <User size={16} /> Dados
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'equipamentos'} style={{ ...s.tab, ...(activeTab === 'equipamentos' ? s.tabActive : {}) }} onClick={() => setActiveTab('equipamentos')}>
            <Printer size={16} /> Equipamentos {equipments.length ? `(${equipments.length})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'os'} style={{ ...s.tab, ...(activeTab === 'os' ? s.tabActive : {}) }} onClick={() => setActiveTab('os')}>
            <FileText size={16} /> Histórico O.S. {osHistory.length ? `(${osHistory.length})` : ''}
          </button>
        </div>

        <div className="contact-profile-content" style={s.content}>
          {activeTab === 'dados' ? (
            <div style={s.sectionStack}>
            <section style={s.fieldCard}>
            <h3 style={s.fieldCardTitle}>Identificação</h3>
            <div style={s.inputGroup}>
              <div>
                <label style={s.label}>Nome</label>
                <input style={s.input} value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Nome fantasia / departamento</label>
                <input style={s.input} value={formData.fantasyName} onChange={(e) => setFormData({ ...formData, fantasyName: e.target.value })} />
              </div>
            </div>
            <div style={s.inputGroup}>
              <div>
                <label style={s.label}>CPF / CNPJ</label>
                <input style={s.input} value={formData.cpfCnpj} onChange={(e) => setFormData({ ...formData, cpfCnpj: e.target.value })} />
              </div>
            </div>
            </section>
            <section style={s.fieldCard}>
            <h3 style={s.fieldCardTitle}>Canais de contato</h3>
            <div style={s.inputGroup}>
              <div>
                <label style={s.label}>Telefone do cadastro</label>
                <input style={s.input} value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>WhatsApp para envios</label>
                <input style={s.input} value={formData.whatsapp} onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })} placeholder="Ex.: 5551999999999" />
              </div>
            </div>
            <div><label style={s.label}>E-mail</label><input style={s.input} value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} /></div>
            </section>
            <section style={s.fieldCard}>
            <h3 style={s.fieldCardTitle}>Endereço principal</h3>
            <div>
              <label style={s.label}>Endereço (rua, número, bairro)</label>
              <input style={s.input} value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
            </div>
            <div style={{ ...s.inputGroup, marginTop: 16 }}>
              <div>
                <label style={s.label}>Cidade</label>
                <input style={s.input} value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Estado (UF)</label>
                <input style={s.input} value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} />
              </div>
            </div>
            </section>
            </div>
          ) : null}

          {activeTab === 'equipamentos' ? (
            <div>
            <div style={{ ...s.equipFormCard, borderColor: editingEquipId ? 'var(--accent-border)' : 'var(--border-color)' }}>
              <div style={s.equipFormTitle}>{editingEquipId ? 'Editando equipamento' : 'Novo equipamento'}</div>
              <div style={s.inputGroup}>
                <input style={s.input} placeholder="Marca (ex: Xerox)" value={newEquip.manufacturer} onChange={(e) => setNewEquip({ ...newEquip, manufacturer: e.target.value })} />
                <input style={s.input} placeholder="Modelo (ex: 7845)" value={newEquip.model} onChange={(e) => setNewEquip({ ...newEquip, model: e.target.value })} />
              </div>
              <div style={s.inputGroup}>
                <input style={s.input} placeholder="Número de série" value={newEquip.serialNumber} onChange={(e) => setNewEquip({ ...newEquip, serialNumber: e.target.value })} />
                <input style={s.input} placeholder="Setor (ex: Recepção)" value={newEquip.sector} onChange={(e) => setNewEquip({ ...newEquip, sector: e.target.value })} />
              </div>
              <div style={s.inputGroup}>
                <input style={s.input} placeholder="Tipo (ex: Multifuncional)" value={newEquip.type} onChange={(e) => setNewEquip({ ...newEquip, type: e.target.value })} />
                <input style={s.input} placeholder="Endereço específico (opcional)" value={newEquip.address} onChange={(e) => setNewEquip({ ...newEquip, address: e.target.value })} />
              </div>
              {editingEquipId ? (
                <div style={s.actionsRow}>
                  <ActionButton
                    variant="secondary"
                    onClick={() => {
                      setEditingEquipId(null);
                      setNewEquip({ ...EMPTY_EQUIPMENT });
                    }}
                  >
                    Cancelar edição
                  </ActionButton>
                </div>
              ) : null}
            </div>

            {equipments.length === 0 ? <div style={s.emptyText}>Nenhum equipamento cadastrado para este cliente ainda.</div> : null}
            {equipments.map((equipment) => (
              <div key={equipment.id} style={s.equipCard}>
                <div style={s.equipActions}>
                  <button style={s.actionBtn('var(--accent)')} onClick={() => startEditEquip(equipment)} title="Editar">
                    <Edit3 size={16} />
                  </button>
                  <button style={s.actionBtn('#ff4d4f')} onClick={() => handleDeleteEquip(equipment.id)} title="Excluir">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div style={s.equipTitle}>
                  {equipment.model.toLowerCase().startsWith(equipment.manufacturer?.toLowerCase())
                    ? equipment.model
                    : equipment.manufacturer
                      ? `${equipment.manufacturer} ${equipment.model}`
                      : equipment.model}
                </div>
                <div style={s.equipType}>{equipment.type}</div>
                <div style={s.equipText}>Série: {equipment.serialNumber || 'N/A'} | Setor: {equipment.sector || 'Geral'}</div>
                {equipment.address ? <div style={s.equipText}>Local: {equipment.address}</div> : null}
              </div>
            ))}
            </div>
          ) : null}

          {activeTab === 'os' ? (
            <div>
            {osHistory.length === 0 ? <div style={s.emptyText}>Nenhuma O.S. registrada para este cliente ainda.</div> : null}
            {osHistory.map((os) => {
              const printable = /^\d+$/.test(String(os.externalId || '')) && os.status !== 'ERRO_INTEGRACAO';
              return (
              <div key={os.id} style={s.osCard}>
                <div>
                  <div style={s.osTitle}>{printable ? `O.S. #${os.externalId}` : 'O.S. aguardando confirmacao do iLux'}</div>
                  <div style={s.osMeta}>Data: {new Date(os.createdAt).toLocaleDateString()}</div>
                  <div style={s.osDefect}>Defeito: {os.defect}</div>
                </div>
                <div style={s.osRight}>
                  <span style={statusBadge(os.status)}>{os.status}</span>
                  {printable ? <a
                    href={`${BACKEND_URL}/api/os/${os.id}/pdf?token=${localStorage.getItem('token')}`}
                    target="_blank"
                    rel="noreferrer"
                    style={s.osLink}
                  >
                    Ver O.S.
                  </a> : null}
                </div>
              </div>
              );
            })}
            </div>
          ) : null}
        </div>

        <div style={s.footer}>
          {renderFooterActions()}
        </div>
      </div>
    </ModalShell>
  );
}

const contactProfileCss = `
  .contact-profile button:focus-visible,
  .contact-profile input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 640px) {
    .contact-profile-content { padding: 1rem !important; }
    .contact-profile-tabs { padding: 0 .75rem !important; }
    .contact-profile-tabs button { padding: .8rem .65rem !important; font-size: .76rem; }
  }
`;

const s = {
  panelBody: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  profileSummary: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-8)', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-base)' },
  profileIdentity: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 },
  profileAvatar: { width: 36, height: 36, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', background: 'var(--accent-light)' },
  profileName: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  profileMeta: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: 2 },
  profileCode: { flex: '0 0 auto', padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-pill)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', fontWeight: 800 },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border-color)',
    padding: '0 var(--space-8)',
    gap: 'var(--space-2)',
    flexShrink: 0,
    overflowX: 'auto',
  },
  tab: {
    padding: 'var(--space-3)',
    cursor: 'pointer',
    fontWeight: 700,
    color: 'var(--text-muted)',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
  },
  tabActive: {
    color: 'var(--accent)',
    borderBottomColor: 'var(--accent)',
  },
  content: { padding: 'var(--space-5) var(--space-8)', overflowY: 'auto', flex: 1, minHeight: 0 },
  sectionStack: { display: 'grid', gap: 'var(--space-3)' },
  fieldCard: { padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)' },
  fieldCardTitle: { margin: '0 0 var(--space-4)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  inputGroup: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' },
  label: {
    fontSize: 'var(--text-xs)',
    color: 'var(--accent)',
    fontWeight: 800,
    marginBottom: '6px',
    display: 'block',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    padding: 'var(--space-3)',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-main)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  actionsRow: { display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-4)' },
  equipFormCard: {
    background: 'var(--bg-panel)',
    padding: 'var(--space-4)',
    borderRadius: '16px',
    border: '1px dashed var(--border-color)',
    marginBottom: '18px',
  },
  equipFormTitle: { color: 'var(--accent)', fontWeight: 800, marginBottom: 'var(--space-3)' },
  equipCard: {
    background: 'var(--bg-base)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    marginBottom: 'var(--space-3)',
    position: 'relative',
  },
  equipTitle: { fontWeight: 800, color: 'var(--text-main)', fontSize: 'var(--text-md)', paddingRight: '60px', overflowWrap: 'anywhere' },
  equipType: { color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 'var(--space-1)', marginTop: 'var(--space-1)' },
  equipText: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)', overflowWrap: 'anywhere' },
  equipActions: { position: 'absolute', top: 'var(--space-4)', right: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' },
  actionBtn: (color) => ({
    background: 'transparent',
    border: 'none',
    color,
    cursor: 'pointer',
    padding: 'var(--space-1)',
  }),
  osCard: {
    background: 'var(--bg-base)',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    marginBottom: 'var(--space-3)',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
  },
  osTitle: { fontWeight: 800, color: 'var(--text-main)' },
  osMeta: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' },
  osDefect: { marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-main)', overflowWrap: 'anywhere' },
  osRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' },
  osLink: { fontSize: 'var(--text-xs)', color: 'var(--accent)', textDecoration: 'none', fontWeight: 700 },
  emptyText: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  footer: {
    display: 'flex',
    gap: 'var(--space-3)',
    padding: 'var(--space-4) var(--space-8) var(--space-8)',
    borderTop: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  footerBtn: { flex: '1 1 220px' },
};
