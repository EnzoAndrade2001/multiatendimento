import React, { useMemo, useState } from 'react';
import { Radio, Wifi } from 'lucide-react';
import ModalShell from './ui/ModalShell';
import ActionButton from './ui/ActionButton';

function isConnected(instance) {
  const status = String(instance?.status || '').toLowerCase();
  const state = String(instance?.state || '').toLowerCase();
  const health = String(instance?.healthStatus || '').toLowerCase();
  return status === 'connected' && (state === 'open' || health === 'healthy' || (!state && !health));
}

function getInstanceLabel(instance) {
  const suffix = instance?.instanceName?.split('_').pop();
  return suffix?.toUpperCase() || instance?.instanceName || 'INSTÂNCIA';
}

export default function InstanceSelectionModal({
  instances = [],
  title = 'Escolher instância',
  description,
  confirmLabel = 'Abrir conversa',
  loading = false,
  onClose,
  onConfirm,
}) {
  const [selectedId, setSelectedId] = useState('');
  const connectedInstances = useMemo(
    () => instances.filter(isConnected),
    [instances]
  );

  return (
    <ModalShell kicker="Canal WhatsApp" title={title} onClose={onClose} maxWidth="34rem">
      <div style={s.body}>
        <p style={s.description}>
          {description || 'Selecione a instância que será vinculada a esta conversa.'}
        </p>

        <div style={s.list}>
          {connectedInstances.map((instance) => {
            const selected = selectedId === instance.id;
            return (
              <button
                type="button"
                key={instance.id}
                style={{ ...s.option, ...(selected ? s.optionSelected : {}) }}
                onClick={() => setSelectedId(instance.id)}
              >
                <span style={{ ...s.icon, ...(selected ? s.iconSelected : {}) }}>
                  {selected ? <Radio size={18} /> : <Wifi size={18} />}
                </span>
                <span style={s.optionText}>
                  <strong style={s.optionTitle}>{getInstanceLabel(instance)}</strong>
                  <span style={s.optionMeta}>{instance.phone || instance.instanceName}</span>
                </span>
                <span style={s.connected}>Conectada</span>
              </button>
            );
          })}

          {connectedInstances.length === 0 ? (
            <div style={s.empty}>
              Nenhuma instância conectada. Reconecte uma instância antes de abrir a conversa.
            </div>
          ) : null}
        </div>
      </div>

      <div style={s.footer}>
        <ActionButton variant="secondary" onClick={onClose} disabled={loading}>
          Cancelar
        </ActionButton>
        <ActionButton onClick={() => onConfirm(selectedId)} disabled={!selectedId || loading}>
          {loading ? 'Abrindo...' : confirmLabel}
        </ActionButton>
      </div>
    </ModalShell>
  );
}

const s = {
  body: { padding: '1.4rem 1.8rem', overflowY: 'auto' },
  description: {
    margin: '0 0 1rem',
    color: 'var(--text-muted)',
    fontSize: '0.9rem',
    lineHeight: 1.55,
  },
  list: { display: 'flex', flexDirection: 'column', gap: '0.7rem' },
  option: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    padding: '0.9rem',
    borderRadius: '14px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-panel)',
    color: 'var(--text-main)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  optionSelected: { borderColor: 'var(--accent)', background: 'var(--accent-light)' },
  icon: {
    width: '38px',
    height: '38px',
    borderRadius: '11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-surface)',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  iconSelected: { color: 'var(--accent)' },
  optionText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: '0.9rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionMeta: {
    color: 'var(--text-muted)',
    fontSize: '0.76rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  connected: {
    color: 'var(--success)',
    fontSize: '0.68rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  empty: {
    padding: '1rem',
    borderRadius: '12px',
    background: 'var(--warning-light)',
    border: '1px solid var(--warning-border)',
    color: 'var(--warning-text)',
    lineHeight: 1.5,
    fontSize: '0.85rem',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    padding: '1rem 1.8rem 1.5rem',
    borderTop: '1px solid var(--border-color)',
  },
};
