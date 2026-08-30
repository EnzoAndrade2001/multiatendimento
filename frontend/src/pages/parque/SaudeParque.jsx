import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpRight, RefreshCw, X } from 'lucide-react';
import {
  getParkQueue, getParkCoverage, getParkRanking, getParkEquipmentTimeline,
  consolidateParkServiceOrder, approveTelemetryEvent, monitorTelemetryEvent, ignoreTelemetryEvent,
  getOsTypes,
} from '../../services/api';
import { toast } from '../../utils/toast';

const SUBTABS = [
  { key: 'fila', label: 'Fila de decisão' },
  { key: 'franquia', label: 'Contadores & Franquia' },
  { key: 'cobertura', label: 'Cobertura' },
  { key: 'problema', label: 'Equipamentos-problema' },
  { key: 'auditoria', label: 'Auditoria' },
];

const money = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const ageLabel = (min) => {
  if (min == null) return '';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
};
const sevTone = (sev) => {
  const v = String(sev || '').toUpperCase();
  if (v === 'CRITICAL' || v === 'HIGH') return 'crit';
  if (v === 'WARNING' || v === 'MEDIUM') return 'warn';
  return 'info';
};

export default function SaudeParque() {
  const [tab, setTab] = useState('fila');
  const [osTypes, setOsTypes] = useState([]);

  useEffect(() => { getOsTypes().then(({ data }) => setOsTypes(Array.isArray(data) ? data : [])).catch(() => {}); }, []);

  return (
    <div style={s.wrap}>
      <div style={s.subtabs} role="tablist">
        {SUBTABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            style={{ ...s.subtab, ...(tab === t.key ? s.subtabActive : {}) }}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'fila' && <FilaDecisao osTypes={osTypes} />}
      {tab === 'franquia' && <ContadoresFranquia />}
      {tab === 'cobertura' && <Cobertura />}
      {tab === 'problema' && <EquipamentosProblema />}
      {tab === 'auditoria' && <Auditoria />}
    </div>
  );
}

/* -------------------- FILA DE DECISÃO -------------------- */

function FilaDecisao({ osTypes }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(null); // 'critical' | 'toner' | 'unlinked' | 'stopped' | null
  const [selected, setSelected] = useState({}); // eventId -> incident
  const [osPicker, setOsPicker] = useState(null); // { mode:'single'|'consolidate', incidents:[], cdOstp }
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getParkQueue({ windowHours: 168 })
      .then(({ data }) => setData(data))
      .catch((e) => toast.error(e.response?.data?.error || 'Falha ao carregar a fila.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const incidents = useMemo(() => {
    const list = data?.incidents || [];
    if (!filter) return list;
    if (filter === 'critical') return list.filter((i) => sevTone(i.severity) === 'crit');
    if (filter === 'toner') return list.filter((i) => i.isLowToner);
    if (filter === 'unlinked') return list.filter((i) => i.mappingState !== 'MATCHED');
    if (filter === 'stopped') return list.filter((i) => i.isHardware && sevTone(i.severity) === 'crit');
    return list;
  }, [data, filter]);

  const selectedList = Object.values(selected);
  const selCustomers = new Set(selectedList.map((i) => i.customer?.id || i.customerName));
  const canConsolidate = selectedList.length >= 2 && selCustomers.size === 1
    && selectedList.every((i) => i.mappingState === 'MATCHED');

  const toggle = (inc) => setSelected((prev) => {
    const next = { ...prev };
    if (next[inc.id]) delete next[inc.id]; else next[inc.id] = inc;
    return next;
  });

  async function doApprove(cdOstp) {
    if (!osPicker) return;
    setBusy(true);
    try {
      if (osPicker.mode === 'consolidate') {
        await consolidateParkServiceOrder({ eventIds: osPicker.incidents.map((i) => i.id), cdOstp });
        toast.success('O.S. consolidada criada.');
      } else {
        await approveTelemetryEvent(osPicker.incidents[0].id, { cdOstp });
        toast.success('O.S. criada.');
      }
      setOsPicker(null); setSelected({}); load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível abrir a O.S.');
    } finally { setBusy(false); }
  }

  async function quick(action, incident) {
    setBusy(true);
    try {
      if (action === 'monitor') await monitorTelemetryEvent(incident.id);
      if (action === 'ignore') await ignoreTelemetryEvent(incident.id);
      toast.success(action === 'monitor' ? 'Em monitoramento.' : 'Evento ignorado.');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Falha na ação.'); }
    finally { setBusy(false); }
  }

  if (loading) return <div style={s.loading}><RefreshCw size={16} className="spin" /> Carregando fila…</div>;
  if (!data) return <div style={s.errorBox}>Telemetria indisponível.</div>;

  const sum = data.summary || {};
  const kpis = [
    ['stopped', 'Parado agora', sum.stopped, 'crit'],
    ['critical', 'Críticos', sum.critical, 'crit'],
    [null, 'Aguardando decisão', sum.awaitingDecision, 'warn'],
    [null, 'Em monitoramento', sum.monitoring, ''],
    ['unlinked', 'Vínculos pendentes', sum.unlinked, 'warn'],
    ['toner', 'Toner/insumo baixo', sum.lowToner, 'accent'],
    [null, 'Excedente projetado', money(sum.overageValue), 'accent'],
  ];

  return (
    <>
      <div style={s.kpis}>
        {kpis.map(([f, label, value, tone], idx) => (
          <button key={idx} type="button"
            aria-pressed={f && filter === f}
            onClick={() => f && setFilter(filter === f ? null : f)}
            style={{ ...s.kpi, ...(f && filter === f ? s.kpiActive : {}), cursor: f ? 'pointer' : 'default' }}>
            <span style={{ ...s.kpiV, ...(tone ? { color: `var(--${tone === 'accent' ? 'accent' : tone === 'crit' ? 'danger, #d64545' : 'warning, #b3730a'})` } : {}) }}>
              {typeof value === 'number' ? int(value) : (value ?? '—')}
            </span>
            <span style={s.kpiL}>{label}</span>
          </button>
        ))}
      </div>

      {canConsolidate && (
        <div style={s.consolidate}>
          <span><b>{selectedList.length}</b> itens de <b>{selectedList[0].customerName}</b> — mesmo cliente → 1 O.S. de suprimento</span>
          <button style={s.btnPrimary} disabled={busy}
            onClick={() => setOsPicker({ mode: 'consolidate', incidents: selectedList, cdOstp: selectedList[0].suggestedOsType?.code || '' })}>
            Gerar 1 O.S.
          </button>
        </div>
      )}
      {selectedList.length >= 2 && !canConsolidate && (
        <div style={{ ...s.consolidate, background: 'var(--bg-panel)', borderColor: 'var(--border-color)' }}>
          <span>Seleção com clientes diferentes ou vínculo pendente — cada um vira uma O.S.</span>
        </div>
      )}

      <div style={s.card}>
        <div style={s.cardH}>
          <strong>Fila de decisão</strong>
          <span style={s.hint}>{incidents.length} de {sum.total ?? 0} · janela 7 dias · <button style={s.linkBtn} onClick={load}>atualizar</button></span>
        </div>
        {incidents.length === 0 && <div style={s.empty}>Nada aguardando decisão no período.</div>}
        {incidents.map((inc) => (
          <IncidentCard key={inc.id} inc={inc} checked={!!selected[inc.id]} onToggle={() => toggle(inc)}
            onOpenOs={() => setOsPicker({ mode: 'single', incidents: [inc], cdOstp: inc.suggestedOsType?.code || '' })}
            onQuick={quick} busy={busy} />
        ))}
      </div>

      {osPicker && (
        <OsTypeModal
          osTypes={osTypes}
          suggested={osPicker.incidents[0]?.suggestedOsType}
          count={osPicker.mode === 'consolidate' ? osPicker.incidents.length : 1}
          busy={busy}
          onClose={() => setOsPicker(null)}
          onConfirm={doApprove}
        />
      )}
    </>
  );
}

function IncidentCard({ inc, checked, onToggle, onOpenOs, onQuick, busy }) {
  const tone = sevTone(inc.severity);
  const fr = inc.franchise;
  return (
    <div style={{ ...s.incident, borderLeft: `3px solid var(--${tone === 'crit' ? 'danger, #d64545' : tone === 'warn' ? 'warning, #b3730a' : 'border-color'})` }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={s.check} aria-label="Selecionar" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.incTop}>
          <span style={{ ...s.tag, ...s[`tag_${tone}`] }}>{inc.severity}</span>
          <span style={s.tagType}>{inc.eventType}{inc.isHardware && sevTone(inc.severity) === 'crit' ? ' · parou' : ''}</span>
          <span style={s.incAge}>{ageLabel(inc.ageMinutes)}</span>
        </div>
        <div style={s.incClient}>{inc.customerName}</div>

        <div style={s.incGrid}>
          {inc.contract && (
            <Field label="Contrato · franquia">
              {inc.contract.number ? `#${inc.contract.number} · ` : ''}{int(inc.contract.pageFranchise)} pág
              {fr && fr.consumedPct != null && (
                <>
                  <div style={s.minibar}><span style={{ width: `${Math.min(100, fr.consumedPct)}%`, background: fr.consumedPct >= 100 ? 'var(--danger, #d64545)' : fr.consumedPct >= 85 ? 'var(--warning, #b3730a)' : 'var(--accent)' }} /></div>
                  <span style={s.small}>{fr.consumedPct}% consumido{fr.willExceed ? ` · projeção ${fr.projectedPct}%` : ''}</span>
                </>
              )}
            </Field>
          )}
          {inc.equipment && (
            <Field label="Equipamento">
              {inc.equipment.model} · <span style={s.mono}>{inc.equipment.serialNumber || 's/série'}</span>
              {inc.equipment.sector ? ` · ${inc.equipment.sector}` : ''}
              {inc.health?.score != null && (
                <span style={{ ...s.chip, ...s[`chip_${inc.health.bucket}`] }}>
                  Saúde {inc.health.score} · {inc.health.callCount90d} chamados/90d
                </span>
              )}
            </Field>
          )}
          {inc.measurement && <Field label="Leitura"><span style={s.mono}>{inc.measurement}</span></Field>}
          {inc.toner?.daysLeft != null && (
            <Field label="Previsão do toner">
              acaba em <b>{inc.toner.daysLeft < 1 ? '< 1 dia' : `~${Math.round(inc.toner.daysLeft)} dias`}</b>
              {inc.trend?.pagesPerDay ? ` (≈ ${int(inc.trend.pagesPerDay)} pág/dia)` : ''}
            </Field>
          )}
          {inc.trend && inc.trend.pagesPerDay != null && !inc.toner?.daysLeft && (
            <Field label="Consumo">≈ {int(inc.trend.pagesPerDay)} pág/dia{inc.trend.reliable ? '' : ' (poucos pontos)'}</Field>
          )}
          {fr && fr.willExceed && (
            <Field label="Excedente projetado no fechamento" tone="crit">
              {money(fr.overValue)} · {int(fr.overPages)} pág × {money(inc.contract?.excessPageValue)}
            </Field>
          )}
          {inc.mappingState !== 'MATCHED' && (
            <Field label="Vínculo" tone="crit">
              {inc.mappingState === 'AMBIGUOUS' ? 'Vínculo ambíguo — revisar' : 'Sem vínculo de cliente/equipamento'}
            </Field>
          )}
          {inc.customer?.address && <Field label="Endereço">{inc.customer.address}</Field>}
        </div>

        <div style={s.actions}>
          {inc.canOpenServiceOrder ? (
            <button style={s.btnPrimary} disabled={busy} onClick={onOpenOs}>
              Abrir O.S.{inc.suggestedOsType ? ` · ${inc.suggestedOsType.name || inc.suggestedOsType.code}` : ' ▾'}
            </button>
          ) : (
            <button style={s.btn} disabled title="Resolva o vínculo primeiro">Abrir O.S.</button>
          )}
          <button style={s.btn} disabled={busy} onClick={() => onQuick('monitor', inc)}>Monitorar</button>
          <button style={s.btnGhost} disabled={busy} onClick={() => onQuick('ignore', inc)}>Ignorar</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, tone, children }) {
  return (
    <div style={s.field}>
      <span style={s.fl}>{label}</span>
      <span style={{ ...s.fv, ...(tone === 'crit' ? { color: 'var(--danger, #d64545)' } : {}) }}>{children}</span>
    </div>
  );
}

function OsTypeModal({ osTypes, suggested, count, busy, onClose, onConfirm }) {
  const [code, setCode] = useState(suggested?.code || (osTypes[0]?.code ?? ''));
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalH}>
          <strong>Abrir {count > 1 ? `1 O.S. para ${count} eventos` : 'O.S.'}</strong>
          <button style={s.iconBtn} onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </div>
        <label style={s.fl}>Tipo de O.S. (obrigatório)</label>
        <select style={s.select} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Selecione…</option>
          {osTypes.map((t) => (
            <option key={t.code} value={t.code}>{t.code} — {t.name || t.description || 'Sem nome'}</option>
          ))}
        </select>
        {suggested && <p style={s.small}>Sugestão do sistema: <b>{suggested.name || suggested.code}</b></p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={s.btn} onClick={onClose} disabled={busy}>Cancelar</button>
          <button style={s.btnPrimary} disabled={busy || !code} onClick={() => onConfirm(code)}>
            {busy ? 'Criando…' : 'Criar O.S.'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------- CONTADORES & FRANQUIA -------------------- */

function ContadoresFranquia() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    getParkQueue({ windowHours: 720 }).then(({ data }) => {
      const byContract = new Map();
      for (const inc of data.incidents || []) {
        if (!inc.contract || !inc.franchise) continue;
        const k = inc.contract.externalId || inc.equipment?.serialNumber;
        if (!k || byContract.has(k)) continue;
        byContract.set(k, {
          customer: inc.customerName, contract: inc.contract, fr: inc.franchise,
          equipment: inc.equipment, pagesPerDay: inc.trend?.pagesPerDay ?? null,
        });
      }
      setRows([...byContract.values()].sort((a, b) => (b.fr.overValue || 0) - (a.fr.overValue || 0)));
    }).catch(() => setRows([]));
  }, []);

  if (!rows) return <div style={s.loading}><RefreshCw size={16} className="spin" /> Carregando…</div>;
  const totalOver = rows.reduce((sum, r) => sum + (r.fr.overValue || 0), 0);

  return (
    <div style={s.card}>
      <div style={s.cardH}>
        <strong>Consumo vs. franquia — ciclo atual</strong>
        <span style={s.hint}>excedente projetado: {money(totalOver)}</span>
      </div>
      {rows.length === 0 && <div style={s.empty}>Sem dados de contrato conciliados ainda. Depende do sync de contratos e do histórico de contador.</div>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead><tr>
              {['Cliente / contrato', 'Equipamento', 'Franquia', 'Consumido', 'Projeção', 'Excedente'].map((h) => <th key={h} style={s.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={s.td}><b>{r.customer}</b><span style={s.small}>{r.contract.number ? `#${r.contract.number} · ` : ''}{r.contract.type || r.contract.modality || ''}</span></td>
                  <td style={s.td}>{r.equipment?.model}<span style={s.small}><span style={s.mono}>{r.equipment?.serialNumber}</span></span></td>
                  <td style={s.tdNum}>{int(r.fr.franchise)}</td>
                  <td style={s.td}>
                    <div style={s.gauge}><div style={s.gaugeTrack}><span style={{ width: `${Math.min(100, r.fr.consumedPct || 0)}%`, background: (r.fr.consumedPct || 0) >= 100 ? 'var(--danger, #d64545)' : 'var(--accent)' }} /></div><span style={s.mono}>{r.fr.consumedPct ?? '—'}%</span></div>
                  </td>
                  <td style={s.tdNum}>{int(r.fr.projected)}</td>
                  <td style={{ ...s.tdNum, color: r.fr.overValue ? 'var(--danger, #d64545)' : 'var(--text-muted)' }}>{r.fr.overValue ? money(r.fr.overValue) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={s.footNote}>Projeção = produzido no ciclo + páginas/dia × dias restantes. Fica confiável quando o histórico de contador tiver 3+ pontos.</p>
    </div>
  );
}

/* -------------------- COBERTURA -------------------- */

function Cobertura() {
  const [data, setData] = useState(null);
  useEffect(() => { getParkCoverage().then(({ data }) => setData(data)).catch(() => setData({ rows: [], summary: {} })); }, []);
  if (!data) return <div style={s.loading}><RefreshCw size={16} className="spin" /> Carregando…</div>;
  const sum = data.summary || {};
  return (
    <>
      <div style={s.kpis}>
        <div style={s.kpi}><span style={s.kpiV}>{int(sum.total)}</span><span style={s.kpiL}>Impressoras ativas</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--accent)' }}>{sum.coveragePct ?? 0}%</span><span style={s.kpiL}>Cobertura de telemetria</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--warning, #b3730a)' }}>{int(sum.offline)}</span><span style={s.kpiL}>Offline &gt; 48h</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--danger, #d64545)' }}>{int(sum.noSignal)}</span><span style={s.kpiL}>Sem sinal</span></div>
      </div>
      <div style={s.card}>
        <div style={s.cardH}><strong>Impressoras sem sinal confiável</strong></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead><tr>{['Impressora', 'Cliente', 'Status', 'Último sinal'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.filter((r) => r.status !== 'ativo').map((r) => (
                <tr key={r.id}>
                  <td style={s.td}><b>{r.model}</b><span style={s.small}><span style={s.mono}>{r.serialNumber || '—'}</span></span></td>
                  <td style={s.td}>{r.customerName || '—'}</td>
                  <td style={s.td}><span style={{ ...s.pill, ...(r.status === 'offline' ? s.pillWarn : s.pillCrit) }}>{r.status === 'offline' ? `offline ${r.ageDays}d` : 'sem sinal'}</span></td>
                  <td style={s.td}>{r.lastSignalAt ? new Date(r.lastSignalAt).toLocaleString('pt-BR') : 'nunca'}</td>
                </tr>
              ))}
              {data.rows.filter((r) => r.status !== 'ativo').length === 0 && <tr><td style={s.td} colSpan={4}>Todo o parque com sinal recente. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* -------------------- EQUIPAMENTOS-PROBLEMA -------------------- */

function EquipamentosProblema() {
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState(null); // { equipmentId, loading, data }
  useEffect(() => { getParkRanking({ days: 90 }).then(({ data }) => setData(data)).catch(() => setData({ rows: [], summary: {} })); }, []);

  const openTimeline = (equipmentId) => {
    setTimeline({ equipmentId, loading: true, data: null });
    getParkEquipmentTimeline(equipmentId).then(({ data }) => setTimeline({ equipmentId, loading: false, data }))
      .catch(() => setTimeline({ equipmentId, loading: false, data: null }));
  };

  if (!data) return <div style={s.loading}><RefreshCw size={16} className="spin" /> Carregando…</div>;
  return (
    <>
      <div style={s.kpis}>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--danger, #d64545)' }}>{int(data.summary.candidates)}</span><span style={s.kpiL}>Candidatas a troca</span></div>
        <div style={s.kpi}><span style={s.kpiV}>{data.summary.avgCallsPer1k ?? 0}</span><span style={s.kpiL}>Chamados / 1k pág — média</span></div>
      </div>
      <div style={s.card}>
        <div style={s.cardH}><strong>Ranking — 90 dias · chamados por 1.000 páginas</strong></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead><tr>{['#', 'Equipamento', 'Cliente', 'Chamados/1k', 'Chamados', 'Pág/dia', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.equipmentId}>
                  <td style={{ ...s.td, color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                  <td style={s.td}><b>{r.model}</b><span style={s.small}><span style={s.mono}>{r.serialNumber || '—'}</span></span></td>
                  <td style={s.td}>{r.customerName || '—'}</td>
                  <td style={s.tdNum}>{r.callsPer1k ?? '—'}</td>
                  <td style={s.tdNum}>{r.calls}</td>
                  <td style={s.tdNum}>{r.pagesPerDay != null ? int(r.pagesPerDay) : '—'}</td>
                  <td style={s.td}><button style={s.linkBtn} onClick={() => openTimeline(r.equipmentId)}>Timeline</button></td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td style={s.td} colSpan={7}>Sem O.S. suficientes no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {timeline && (
        <div style={s.overlay} onClick={() => setTimeline(null)}>
          <div style={{ ...s.modal, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalH}>
              <strong>Timeline do equipamento</strong>
              <button style={s.iconBtn} onClick={() => setTimeline(null)} aria-label="Fechar"><X size={16} /></button>
            </div>
            {timeline.loading && <div style={s.loading}><RefreshCw size={16} className="spin" /> Carregando…</div>}
            {timeline.data && (
              <>
                <p style={s.small}>
                  {timeline.data.equipment?.model} · <span style={s.mono}>{timeline.data.equipment?.serialNumber}</span>
                  {timeline.data.equipment?.pageCounter != null ? ` · contador ${int(timeline.data.equipment.pageCounter)}` : ''}
                </p>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {(timeline.data.timeline || []).map((t, i) => (
                    <div key={i} style={s.tlItem}>
                      <span style={s.tlWhen}>{new Date(t.at).toLocaleString('pt-BR')}</span>
                      <span><span style={s.tlTag}>{t.kind === 'os' ? 'O.S.' : t.severity || 'EVENTO'}</span> {t.title} {t.detail ? `— ${String(t.detail).slice(0, 90)}` : ''}</span>
                    </div>
                  ))}
                  {(timeline.data.timeline || []).length === 0 && <div style={s.empty}>Sem histórico.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------- AUDITORIA -------------------- */

function Auditoria() {
  return (
    <div style={s.card}>
      <div style={s.cardH}><strong>Trilha de decisões do parque</strong></div>
      <div style={{ padding: 18 }}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          As decisões (aprovar, consolidar, ignorar, vincular) são registradas na auditoria central com ação <code>PRINTGUARD_*</code>.
        </p>
        <a href="/audit?resource=printguard_event" style={{ ...s.linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 10 }}>
          Abrir na Auditoria do sistema <ArrowUpRight size={14} />
        </a>
        <p style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          Painel dedicado (MTTR, % auto-resolvido, falso-positivo por tipo) — próxima entrega.
        </p>
      </div>
    </div>
  );
}

/* -------------------- estilos -------------------- */

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  subtabs: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  subtab: { font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '7px 13px', borderRadius: 'var(--radius-pill)' },
  subtabActive: { background: 'var(--accent-light)', borderColor: 'var(--accent-border)', color: 'var(--accent)' },

  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  kpi: { textAlign: 'left', font: 'inherit', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 2 },
  kpiActive: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent) inset' },
  kpiV: { fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: 'var(--text-main)' },
  kpiL: { fontSize: 11.5, color: 'var(--text-muted)' },

  consolidate: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--accent-light)', border: '1px solid var(--accent-border)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, flexWrap: 'wrap' },

  card: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16 },
  cardH: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--border-color)', fontSize: 14 },
  hint: { fontSize: 11.5, color: 'var(--text-muted)' },
  empty: { padding: 18, fontSize: 13, color: 'var(--text-muted)' },
  loading: { display: 'flex', alignItems: 'center', gap: 8, padding: 24, color: 'var(--text-muted)', fontSize: 13 },
  errorBox: { padding: 18, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, color: 'var(--text-muted)' },
  footNote: { padding: '10px 15px 14px', fontSize: 11.5, color: 'var(--text-muted)', margin: 0 },

  incident: { display: 'flex', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--border-color)' },
  check: { width: 15, height: 15, marginTop: 3, accentColor: 'var(--accent)', cursor: 'pointer', flex: 'none' },
  incTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tag: { fontFamily: 'ui-monospace, monospace', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', padding: '3px 7px', borderRadius: 5 },
  tag_crit: { background: 'var(--danger-light, #fbeae7)', color: 'var(--danger, #b42318)' },
  tag_warn: { background: 'var(--warning-light, #fbf0dd)', color: 'var(--warning, #9a6700)' },
  tag_info: { background: 'var(--bg-surface)', color: 'var(--text-muted)' },
  tagType: { fontFamily: 'ui-monospace, monospace', fontSize: 10.5, padding: '3px 7px', borderRadius: 5, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' },
  incAge: { marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' },
  incClient: { fontWeight: 700, fontSize: 14, margin: '7px 0' },
  incGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px 20px' },

  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  fl: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)' },
  fv: { fontSize: 12.5, color: 'var(--text-main)' },
  small: { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 2 },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: 12 },
  minibar: { height: 6, borderRadius: 3, background: 'var(--border-color)', overflow: 'hidden', marginTop: 4 },
  chip: { display: 'inline-block', fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', marginTop: 4 },
  chip_ok: { background: 'var(--success-light, #e6f2ea)', color: 'var(--success, #1a7f37)', borderColor: 'transparent' },
  chip_warn: { background: 'var(--warning-light, #fbf0dd)', color: 'var(--warning, #9a6700)', borderColor: 'transparent' },
  chip_bad: { background: 'var(--danger-light, #fbeae7)', color: 'var(--danger, #b42318)', borderColor: 'transparent' },
  chip_unknown: {},

  actions: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 },
  btn: { font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', borderRadius: 8, padding: '6px 11px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)' },
  btnPrimary: { font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 8, padding: '6px 12px', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--text-inverse, #fff)' },
  btnGhost: { font: 'inherit', fontSize: 12, cursor: 'pointer', borderRadius: 8, padding: '6px 8px', border: '1px solid transparent', background: 'transparent', color: 'var(--text-muted)' },
  linkBtn: { font: 'inherit', fontSize: 12, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--accent)', padding: 0, textDecoration: 'underline' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 18, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px -20px rgba(0,0,0,.4)' },
  modalH: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 },
  select: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: 13, marginTop: 4 },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', padding: '11px 14px', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', borderBottom: '1px solid var(--border-color)', verticalAlign: 'middle' },
  tdNum: { padding: '11px 14px', borderBottom: '1px solid var(--border-color)', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' },
  gauge: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 },
  gaugeTrack: { flex: 1, height: 7, borderRadius: 4, background: 'var(--border-color)', overflow: 'hidden' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 'var(--radius-pill)' },
  pillWarn: { background: 'var(--warning-light, #fbf0dd)', color: 'var(--warning, #9a6700)' },
  pillCrit: { background: 'var(--danger-light, #fbeae7)', color: 'var(--danger, #b42318)' },

  tlItem: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-color)', fontSize: 12 },
  tlWhen: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-muted)' },
  tlTag: { fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', marginRight: 6 },
};
