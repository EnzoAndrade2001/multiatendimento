import React from 'react';
import { Check, Copy, Mail, MessageCircle, Phone } from 'lucide-react';
import { toast } from '../utils/toast';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function copyValue(value, label) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(String(value));
    toast.success(`${label} copiado`);
  } catch {
    toast.error(`Não foi possível copiar ${label.toLowerCase()}`);
  }
}

export function contactHasActiveTicket(contact, quickActions) {
  if (!quickActions?.ticketId) return false;
  if (contact?.contactId && String(contact.contactId) === String(quickActions.contactId)) return true;
  const contactPhone = digits(contact?.phone);
  const ticketPhone = digits(quickActions.phone);
  return Boolean(contactPhone && ticketPhone && contactPhone === ticketPhone);
}

export function CrmContactActions({ contact, quickActions, onOpenConversation }) {
  const canOpenWhatsApp = contactHasActiveTicket(contact, quickActions);
  const openConversation = () => {
    if (!canOpenWhatsApp) return;
    if (onOpenConversation) onOpenConversation();
    else window.location.assign(`/inbox?ticketId=${encodeURIComponent(quickActions.ticketId)}`);
  };

  return (
    <div style={styles.contactActions} aria-label={`Ações de ${contact?.name || 'contato'}`}>
      {contact?.phone ? (
        <button type="button" style={styles.actionButton} onClick={() => copyValue(contact.phone, 'Telefone')} title="Copiar telefone">
          <Phone size={14} /><Copy size={12} /> Telefone
        </button>
      ) : null}
      {contact?.email ? (
        <button type="button" style={styles.actionButton} onClick={() => copyValue(contact.email, 'E-mail')} title="Copiar e-mail">
          <Mail size={14} /><Copy size={12} /> E-mail
        </button>
      ) : null}
      {canOpenWhatsApp ? (
        <button type="button" style={styles.whatsAppButton} onClick={openConversation} title="Abrir conversa vinculada no Atendimento">
          <MessageCircle size={14} /> Abrir WhatsApp
        </button>
      ) : null}
    </div>
  );
}

export function isContractedEquipment(equipment) {
  // Só o vínculo já resolvido no backend (contractExternalId). Os campos crus
  // (raw.seqcontrato / raw.seqixlcontratos) não são limpos no iLux quando a
  // máquina sai do contrato e inflavam "Em contrato" com equipamentos trocados.
  return Boolean(equipment?.contractExternalId || equipment?.contractId);
}

export function filterCrmEquipments(equipments, statusFilter) {
  if (statusFilter === 'active') return equipments.filter((equipment) => equipment?.isActive !== false);
  if (statusFilter === 'contracted') return equipments.filter((equipment) => equipment?.isActive !== false && isContractedEquipment(equipment));
  if (statusFilter === 'inactive') return equipments.filter((equipment) => equipment?.isActive === false);
  return equipments;
}

export function CrmEquipmentFilters({ equipments, value, onChange }) {
  const counts = {
    all: equipments.length,
    active: equipments.filter((equipment) => equipment?.isActive !== false).length,
    contracted: equipments.filter((equipment) => equipment?.isActive !== false && isContractedEquipment(equipment)).length,
    inactive: equipments.filter((equipment) => equipment?.isActive === false).length,
  };
  const options = [
    ['all', 'Todos'],
    ['active', 'Ativos'],
    ['contracted', 'Em contrato'],
    ['inactive', 'Inativos'],
  ];

  return (
    <div style={styles.filterGroup} role="group" aria-label="Filtrar equipamentos por situação">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          style={{ ...styles.filterButton, ...(value === id ? styles.filterButtonActive : {}) }}
          onClick={() => onChange(id)}
        >
          {value === id ? <Check size={12} /> : null}
          {label} <span style={styles.count}>{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}

const styles = {
  contactActions: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.45rem' },
  actionButton: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minHeight: 32, padding: '0 0.55rem', borderRadius: 9, border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 700 },
  whatsAppButton: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', minHeight: 32, padding: '0 0.65rem', borderRadius: 9, border: '1px solid var(--success-border)', background: 'var(--success-light)', color: 'var(--success)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 800 },
  filterGroup: { display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' },
  filterButton: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', minHeight: 30, padding: '0 0.55rem', borderRadius: 999, border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700 },
  filterButtonActive: { borderColor: 'var(--accent-border)', background: 'var(--accent-light)', color: 'var(--accent)' },
  count: { opacity: 0.8, fontVariantNumeric: 'tabular-nums' },
};
