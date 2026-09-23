import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Check, MapPin, Search, X } from 'lucide-react';

export function cleanEquipmentLocationPart(value) {
  const result = String(value || '').replace(/\s+/g, ' ').trim();
  return result && result.toUpperCase() !== 'N/A' ? result : '';
}

export function equipmentAddress(equipment) {
  if (!equipment) return '';
  const address = cleanEquipmentLocationPart(equipment.address);
  const complement = cleanEquipmentLocationPart(equipment.complement);
  const city = cleanEquipmentLocationPart(equipment.city);
  const state = cleanEquipmentLocationPart(equipment.state);
  const parts = [address];
  if (complement && !address.toUpperCase().includes(complement.toUpperCase())) parts.push(complement);
  if (city) parts.push(state ? `${city}/${state}` : city);
  return parts.filter(Boolean).join(' — ');
}

export function equipmentOperationalLocation(equipment) {
  if (!equipment) return '';
  return [
    cleanEquipmentLocationPart(equipment.department) && `Departamento: ${cleanEquipmentLocationPart(equipment.department)}`,
    cleanEquipmentLocationPart(equipment.installLocation) && `Local: ${cleanEquipmentLocationPart(equipment.installLocation)}`,
  ].filter(Boolean).join(' | ');
}

function searchableText(equipment) {
  return [
    equipment.externalId,
    equipment.model,
    equipment.serialNumber,
    equipmentAddress(equipment),
    equipmentOperationalLocation(equipment),
  ].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function EquipmentPickerModal({ open, equipments, selectedId, onSelect, onClose }) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const filteredEquipments = useMemo(() => {
    const term = search.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!term) return equipments;
    return equipments.filter((equipment) => searchableText(equipment).includes(term));
  }, [equipments, search]);

  if (!open) return null;

  const s = {
    overlay: { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0, 0, 0, 0.82)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
    modal: { width: '760px', maxWidth: '100%', height: 'min(760px, 92vh)', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '16px', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', padding: '20px 22px 14px', borderBottom: '1px solid var(--border-color)' },
    title: { margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-lg)', fontWeight: 900 },
    subtitle: { margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
    close: { width: '36px', height: '36px', borderRadius: '9px', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 },
    searchWrap: { position: 'relative', margin: '16px 22px 12px' },
    searchIcon: { position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' },
    search: { width: '100%', height: '44px', padding: '0 14px 0 42px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-main)', fontSize: 'var(--text-sm)', outline: 'none' },
    count: { padding: '0 22px 10px', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
    list: { flex: 1, overflowY: 'auto', padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: '9px' },
    empty: { padding: '48px 20px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' },
  };

  return (
    <div style={s.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-labelledby="equipment-picker-title">
        <div style={s.header}>
          <div>
            <h3 id="equipment-picker-title" style={s.title}>Selecionar equipamento</h3>
            <p style={s.subtitle}>Pesquise por modelo, série, endereço, departamento ou local.</p>
          </div>
          <button type="button" style={s.close} onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>

        <div style={s.searchWrap}>
          <Search size={18} style={s.searchIcon} />
          <input
            autoFocus
            style={s.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar equipamento ou localização..."
          />
        </div>
        <div style={s.count}>{filteredEquipments.length} equipamento(s) encontrado(s)</div>

        <div style={s.list}>
          {filteredEquipments.length === 0 ? (
            <div style={s.empty}>
              {search ? (
                <>
                  <div>Nenhum equipamento encontrado para "{search}".</div>
                  <button type="button" onClick={() => setSearch('')} style={{ marginTop: '10px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--accent)', borderRadius: '8px', padding: '6px 14px', fontSize: 'var(--text-xs)', fontWeight: 700, cursor: 'pointer' }}>Limpar busca</button>
                </>
              ) : 'Nenhum equipamento cadastrado para este cliente.'}
            </div>
          ) : null}
          {filteredEquipments.map((equipment) => {
            const selected = equipment.id === selectedId;
            const address = equipmentAddress(equipment);
            const operationalLocation = equipmentOperationalLocation(equipment);
            return (
              <button
                type="button"
                key={equipment.id}
                onClick={() => { onSelect(equipment); onClose(); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '14px 15px', borderRadius: '11px', cursor: 'pointer',
                  // A selecao de equipamento continua usando o vermelho
                  // operacional do LCD; o laranja e reservado para a marca.
                  border: selected ? '1px solid var(--danger)' : '1px solid var(--border-color)',
                  background: selected ? 'var(--danger-light)' : 'var(--bg-base)', color: 'var(--text-main)',
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '7px', marginBottom: '7px' }}>
                    <strong style={{ fontSize: 'var(--text-md)', wordBreak: 'break-word' }}>{equipment.model}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Série: {equipment.serialNumber || 'S/N'}</span>
                    {/* O identificador externo (geralmente um UUID) é usado
                        apenas na integração. O técnico escolhe pela máquina,
                        série, patrimônio e endereço; não mostramos o ID bruto. */}
                  </div>
                  {address ? <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', color: 'var(--text-main)', fontSize: 'var(--text-xs)', lineHeight: 1.35 }}><MapPin size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: '1px' }} /><span>{address}</span></div> : null}
                  {operationalLocation ? <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.35, marginTop: '5px' }}><Building2 size={14} style={{ flexShrink: 0, marginTop: '1px' }} /><span>{operationalLocation}</span></div> : null}
                </div>
                <span style={{ width: '27px', height: '27px', borderRadius: '50%', display: 'grid', placeItems: 'center', border: selected ? 'none' : '1px solid var(--border-color)', background: selected ? 'var(--danger)' : 'transparent', color: selected ? '#fff' : 'transparent' }}><Check size={16} /></span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
