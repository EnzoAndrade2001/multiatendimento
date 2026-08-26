import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { getContacts, createContact, createTicket, importContacts, linkContactToCrm } from '../services/api';
import { Edit2, Link2, MessageSquare, Plus, Search, BookUser, Upload } from 'lucide-react';
import ContactProfileModal from '../components/ContactProfileModal';
import LinkContactModal from '../components/LinkContactModal';
import { toast } from '../utils/toast';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import SurfaceCard from '../components/ui/SurfaceCard';
import EmptyState from '../components/ui/EmptyState';
import ModalShell from '../components/ui/ModalShell';
import InstanceSelectionModal from '../components/InstanceSelectionModal';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', phone: '' });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [linkingContact, setLinkingContact] = useState(null);
  const [pendingChatContact, setPendingChatContact] = useState(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { instances } = useOutletContext() || { instances: [] };

  useEffect(() => {
    if (!search) {
      loadContacts();
      return;
    }
    const timer = setTimeout(() => {
      loadContacts();
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  async function loadContacts() {
    try {
      const response = await getContacts(search, { withoutCrm: true });
      setContacts(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error('Erro ao carregar contatos:', err);
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newContact.name || !newContact.phone) return toast.error('Preencha o nome e o telefone do contato');
    if (creating) return;
    setCreating(true);
    try {
      await createContact({ name: newContact.name.trim(), phone: newContact.phone.trim() });
      setShowAddModal(false);
      setNewContact({ name: '', phone: '' });
      loadContacts();
      toast.success('Contato cadastrado com sucesso');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao cadastrar contato');
    } finally {
      setCreating(false);
    }
  }

  function openProfileModal(contact) {
    setSelectedContact(contact);
    setShowProfileModal(true);
  }

  async function handleLinkCrm(crmCustomerId) {
    if (!linkingContact || !crmCustomerId) return;
    try {
      await linkContactToCrm(linkingContact.id, crmCustomerId);
      setLinkingContact(null);
      await loadContacts();
      toast.success('Contato vinculado ao CRM com sucesso');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao vincular contato ao CRM');
    }
  }

  async function handleImportExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setLoading(true);
    try {
      const res = await importContacts(formData);
      toast.success(res.data.message);
      loadContacts();
    } catch (err) {
      toast.error('Erro na importação da planilha: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
      e.target.value = null;
    }
  }

  async function startChat(contact) {
    if (!contact) return;
    if (contact.tickets && contact.tickets.length > 0 && contact.tickets[0].status !== 'resolved') {
      navigate(`/inbox?ticketId=${contact.tickets[0].id}`);
    } else {
      setPendingChatContact(contact);
    }
  }

  async function confirmStartChat(instanceId) {
    if (!pendingChatContact || !instanceId) return;
    setOpeningChat(true);
    try {
      const { data: ticket } = await createTicket(pendingChatContact.id, instanceId);
      setPendingChatContact(null);
      navigate(`/inbox?ticketId=${ticket.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao iniciar conversa');
    } finally {
      setOpeningChat(false);
    }
  }

  function parseTags(tagsStr) {
    try {
      if (!tagsStr) return [];
      const parsed = JSON.parse(tagsStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const contactCards = useMemo(
    () =>
      contacts.map((contact) => {
        const contactName = contact.name || contact.fantasyName || '';
        const initials = (contactName || '?')
          .split(' ')
          .map((word) => word[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        const hue = contactName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
        const hasActiveTicket = contact.tickets?.some((ticket) => ticket.status === 'open');
        const hasPendingTicket = contact.tickets?.some((ticket) => ticket.status === 'pending');
        const statusColor = hasActiveTicket ? '#48bb78' : hasPendingTicket ? '#D4AF37' : 'var(--text-dim)';
        const statusLabel = hasActiveTicket ? 'Em atendimento' : hasPendingTicket ? 'Aguardando' : '';

        return (
          <SurfaceCard key={contact.id} style={s.card}>
            <div style={s.cardHeader}>
              <div style={{ ...s.avatar, background: `hsl(${hue}, 45%, 35%)` }}>{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.cardName}>{contact.name || contact.fantasyName || 'Sem nome'}</div>
                <div style={s.cardPhone}>{contact.phone || contact.whatsapp || 'Sem número'}</div>
              </div>
              <button onClick={() => openProfileModal(contact)} style={s.editBtn} title="Editar contato" aria-label="Editar contato">
                <Edit2 size={16} />
              </button>
            </div>

            <div style={s.cardMeta}>
              {statusLabel ? (
                <span style={{ ...s.statusPill, color: statusColor, borderColor: statusColor }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                  {statusLabel}
                </span>
              ) : null}
              <span style={{ ...s.statusPill, color: contact.crmCustomerId ? '#48bb78' : 'var(--text-dim)', borderColor: contact.crmCustomerId ? '#48bb78' : 'var(--border-color)' }}>
                {contact.crmCustomerId ? 'Vinculado ao CRM' : 'Não vinculado ao CRM'}
              </span>
            </div>

            <div style={s.cardTags}>
              {parseTags(contact.tags).map((tag, index) => (
                <span key={index} style={s.tag}>
                  {tag}
                </span>
              ))}
            </div>

            <button style={s.chatBtn} onClick={() => startChat(contact)}>
              <MessageSquare size={16} /> Abrir conversa
            </button>
            {!contact.crmCustomerId ? (
              <button style={s.linkBtn} onClick={() => setLinkingContact(contact)}>
                <Link2 size={16} /> Vincular ao CRM
              </button>
            ) : null}
          </SurfaceCard>
        );
      }),
    [contacts]
  );

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Relacionamento"
        title="Contatos WhatsApp"
        subtitle={
          contacts.length > 0
            ? `Cadastre e gerencie nomes e números do WhatsApp (${contacts.length} contatos). A vinculação ao CRM é feita depois.`
            : 'Cadastre e gerencie nomes e números do WhatsApp. A vinculação ao CRM é feita depois.'
        }
        actions={
          <div style={s.actionsRow}>
            <div style={s.searchWrap}>
              <Search size={18} style={s.searchIcon} />
              <input style={s.search} placeholder="Pesquisar contatos..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <ActionButton variant="secondary" style={s.importBtn} disabled={loading} onClick={() => document.getElementById('importExcel').click()}>
              <Upload size={18} /> Importar
            </ActionButton>
            <input type="file" id="importExcel" hidden accept=".xlsx, .xls" onChange={handleImportExcel} />

            <ActionButton onClick={() => setShowAddModal(true)}>
              <Plus size={20} /> Novo contato
            </ActionButton>
          </div>
        }
      />

      {loading ? (
        <div style={s.loading}>Carregando contatos...</div>
      ) : (
        <div style={s.grid}>
          {Array.isArray(contacts) && contacts.length > 0 ? (
            contactCards
          ) : (
            <EmptyState
              icon={<BookUser size={22} />}
              title={search ? `Nenhum contato encontrado para "${search}"` : 'Nenhum contato encontrado'}
              description={
                search
                  ? 'Tente pesquisar por outro nome ou telefone, ou cadastre este contato agora.'
                  : 'Cadastre um novo contato ou importe uma planilha para começar.'
              }
              action={
                <ActionButton onClick={() => setShowAddModal(true)}>
                  <Plus size={18} /> Novo contato
                </ActionButton>
              }
              style={{ gridColumn: '1 / -1' }}
            />
          )}
        </div>
      )}

      {showAddModal ? (
        <ModalShell kicker="Novo contato" title="Cadastrar contato WhatsApp" onClose={() => setShowAddModal(false)} maxWidth="32rem">
          <div style={s.modalBody}>
            <div style={s.modalScrollArea}>
              <div style={s.formGrid}>
                <div style={s.field}>
                  <label style={s.label}>Nome</label>
                  <input autoFocus style={s.input} value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} placeholder="Ex.: João da Silva" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Número do WhatsApp</label>
                  <input type="tel" inputMode="tel" style={s.input} value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} placeholder="Ex.: (51) 99999-9999" />
                </div>
              </div>
              <p style={s.modalHint}>Depois de cadastrar, você poderá abrir a conversa e vincular este contato ao cliente correspondente no CRM.</p>
            </div>

            <div style={s.modalFooter}>
              <ActionButton variant="secondary" style={s.modalFooterBtn} onClick={() => setShowAddModal(false)}>
                Fechar
              </ActionButton>
              <ActionButton style={s.modalFooterBtn} loading={creating} onClick={handleCreate}>
                Cadastrar contato
              </ActionButton>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {showProfileModal && selectedContact ? (
        <ContactProfileModal contact={selectedContact} onClose={() => setShowProfileModal(false)} onUpdated={loadContacts} />
      ) : null}

      {linkingContact ? <LinkContactModal onClose={() => setLinkingContact(null)} onLink={handleLinkCrm} /> : null}

      {pendingChatContact ? (
        <InstanceSelectionModal
          instances={instances}
          title="Abrir nova conversa"
          description={`Escolha por qual instância a conversa com ${pendingChatContact.name || pendingChatContact.phone || 'este contato'} será aberta.`}
          loading={openingChat}
          onClose={() => setPendingChatContact(null)}
          onConfirm={confirmStartChat}
        />
      ) : null}
    </div>
  );
}

const s = {
  container: { padding: 'var(--space-10)', background: 'var(--bg-base)', height: '100%', overflowY: 'auto', flex: 1, color: 'var(--text-main)' },
  actionsRow: { display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' },
  loading: { textAlign: 'center', padding: 'var(--space-12)', color: 'var(--text-muted)' },
  searchWrap: { position: 'relative' },
  search: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    padding: 'var(--space-3) var(--space-4) var(--space-3) var(--space-10)',
    borderRadius: '12px',
    color: 'var(--text-main)',
    width: '280px',
    outline: 'none',
    fontSize: 'var(--text-sm)',
  },
  searchIcon: { position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' },
  importBtn: { whiteSpace: 'nowrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-5)' },
  card: {
    padding: 'var(--space-5)',
    borderLeft: '3px solid var(--border-color)',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 900,
    fontSize: 'var(--text-xs)',
    letterSpacing: '0.03em',
    flexShrink: 0,
  },
  cardName: { fontSize: 'var(--text-md)', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardPhone: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: '2px', fontVariantNumeric: 'tabular-nums' },
  editBtn: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 'var(--space-1)', flexShrink: 0 },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' },
  statusPill: {
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: '20px',
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    background: 'transparent',
    flexShrink: 0,
  },
  cardTags: { display: 'flex', flexWrap: 'wrap', gap: '5px', minHeight: '20px' },
  tag: { fontSize: 'var(--text-xs)', background: 'var(--accent-light)', color: 'var(--accent)', padding: '2px 7px', borderRadius: '5px', fontWeight: 800, border: '1px solid var(--accent-border)' },
  chatBtn: {
    width: '100%',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-main)',
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    fontSize: 'var(--text-sm)',
  },
  linkBtn: {
    width: '100%',
    background: 'var(--accent-light)',
    border: '1px solid var(--accent-border)',
    color: 'var(--accent)',
    padding: 'var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    fontSize: 'var(--text-sm)',
  },
  modalBody: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
  modalScrollArea: { padding: '0 var(--space-8)', overflowY: 'auto', flex: 1, minHeight: 0 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  label: { fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: 'var(--space-3) var(--space-4)', color: 'var(--text-main)', outline: 'none', fontSize: 'var(--text-md)' },
  modalHint: { margin: '0 0 var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.5 },
  modalFooter: {
    display: 'flex',
    gap: 'var(--space-3)',
    padding: 'var(--space-4) var(--space-8) var(--space-8)',
    borderTop: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  modalFooterBtn: { flex: '1 1 240px' },
};
