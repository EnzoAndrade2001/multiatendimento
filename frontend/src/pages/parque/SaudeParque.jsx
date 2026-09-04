import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  getParkQueue, getParkCoverage, getParkRanking, getParkEquipmentTimeline,
  getOsTypes,
} from '../../services/api';
import DecisionCenter from './DecisionCenter';
import { useSearchParams } from 'react-router-dom';

const SUBTABS = [
  { key: 'fila', label: 'Operação diária', description: 'Decida, atribua e acompanhe as ocorrências que exigem ação agora.' },
  { key: 'franquia', label: 'Consumo & Franquia', description: 'Projete consumo, franquia e possível excedente no ciclo atual.' },
  { key: 'cobertura', label: 'Cobertura da Telemetria', description: 'Acompanhe vínculos, conectividade e equipamentos sem sinal recente.' },
  { key: 'problema', label: 'Recorrência & Troca', description: 'Identifique reincidência e equipamentos que merecem avaliação de troca.' },
];

const money = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

export default function SaudeParque({ onSummaryChange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const tab = SUBTABS.some((item) => item.key === requestedSection) ? requestedSection : 'fila';
  const setTab = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('area', 'parque');
    next.set('section', key);
    setSearchParams(next, { replace: true });
  };
  const [osTypes, setOsTypes] = useState([]);

  useEffect(() => { getOsTypes().then(({ data }) => setOsTypes(Array.isArray(data) ? data : [])).catch(() => {}); }, []);
  const currentTab = SUBTABS.find((item) => item.key === tab) || SUBTABS[0];

  return (
    <div style={s.wrap}>
      <div style={s.subtabs} role="tablist" aria-label="Áreas da Saúde do Parque">
        {SUBTABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            style={{ ...s.subtab, ...(tab === t.key ? s.subtabActive : {}) }}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={s.sectionPurpose} role="status"><strong>{currentTab.label}</strong><span>{currentTab.description}</span></div>

      {tab === 'fila' && <DecisionCenter osTypes={osTypes} onSummaryChange={onSummaryChange} />}
      {tab === 'franquia' && <ContadoresFranquia />}
      {tab === 'cobertura' && <Cobertura />}
      {tab === 'problema' && <EquipamentosProblema />}
    </div>
  );
}

/* -------------------- CONSUMO & FRANQUIA -------------------- */

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
                    <div style={s.gauge}><div style={s.gaugeTrack}><span style={{ width: `${Math.min(100, r.fr.consumedPct || 0)}%`, background: (r.fr.consumedPct || 0) >= 100 ? 'var(--critical)' : 'var(--accent)' }} /></div><span style={s.mono}>{r.fr.consumedPct ?? '—'}%</span></div>
                  </td>
                  <td style={s.tdNum}>{int(r.fr.projected)}</td>
                  <td style={{ ...s.tdNum, color: r.fr.overValue ? 'var(--critical)' : 'var(--text-muted)' }}>{r.fr.overValue ? money(r.fr.overValue) : '—'}</td>
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

/* -------------------- COBERTURA DA TELEMETRIA -------------------- */

function Cobertura() {
  const [data, setData] = useState(null);
  useEffect(() => { getParkCoverage().then(({ data }) => setData(data)).catch(() => setData({ rows: [], summary: {} })); }, []);
  if (!data) return <div style={s.loading}><RefreshCw size={16} className="spin" /> Carregando…</div>;
  const sum = data.summary || {};
  const withoutRecentSignal = data.rows.filter((r) => r.status !== 'ativo');
  return (
    <>
      <div style={s.kpis}>
        <div style={s.kpi} title="Equipamentos ativos do iLux com vínculo PrintGuard confirmado"><span style={s.kpiV}>{int(sum.total)}</span><span style={s.kpiL}>Vinculadas ao PrintGuard</span></div>
        <div style={s.kpi} title="Percentual dos equipamentos vinculados que enviou sinal nas últimas 48 horas"><span style={{ ...s.kpiV, color: 'var(--accent)' }}>{sum.coveragePct ?? 0}%</span><span style={s.kpiL}>Com sinal recente</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--warning-text)' }}>{int(sum.offline)}</span><span style={s.kpiL}>Offline &gt; 48h</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--critical)' }}>{int(sum.noSignal)}</span><span style={s.kpiL}>Sem sinal</span></div>
        <div style={s.kpi} title="Vínculos ainda ambíguos ou não encontrados, fora do cálculo de cobertura"><span style={{ ...s.kpiV, color: 'var(--warning-text)' }}>{int(sum.pendingBindings)}</span><span style={s.kpiL}>Vínculos pendentes</span></div>
      </div>
      <div style={s.card}>
        <div style={s.cardH}><strong>Equipamentos vinculados sem sinal recente</strong><span style={s.hint}>Somente vínculos PrintGuard confirmados entram nesta lista.</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead><tr>{['Impressora', 'Cliente', 'Status', 'Último sinal'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {withoutRecentSignal.map((r) => (
                <tr key={r.id}>
                  <td style={s.td}><b>{r.model}</b><span style={s.small}><span style={s.mono}>{r.serialNumber || '—'}</span></span></td>
                  <td style={s.td}>{r.customerName || '—'}</td>
                  <td style={s.td}><span style={{ ...s.pill, ...(r.status === 'offline' ? s.pillWarn : s.pillCrit) }}>{r.status === 'offline' ? `offline ${r.ageDays}d` : r.status === 'inativo' ? 'inativo no iLux' : 'sem sinal'}</span></td>
                  <td style={s.td}>{r.lastSignalAt ? new Date(r.lastSignalAt).toLocaleString('pt-BR') : 'nunca'}</td>
                </tr>
              ))}
              {withoutRecentSignal.length === 0 && <tr><td style={s.td} colSpan={4}>{sum.total ? 'Todos os equipamentos vinculados estão com sinal recente. 🎉' : 'Nenhum equipamento ativo possui vínculo PrintGuard confirmado.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p style={s.footNote}>Cobertura considera somente equipamentos ativos com vínculo PrintGuard confirmado. Vínculos pendentes ficam fora do percentual até serem corrigidos.</p>
    </>
  );
}

/* -------------------- RECORRÊNCIA & TROCA -------------------- */

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
        <div style={s.kpi} title="Equipamentos com pelo menos três alertas, dois alertas críticos, duas O.S. ou recorrência muito acima da média"><span style={{ ...s.kpiV, color: 'var(--critical)' }}>{int(data.summary.candidates)}</span><span style={s.kpiL}>Candidatas a troca</span></div>
        <div style={s.kpi} title="Alertas do PrintGuard recebidos nos equipamentos vinculados nos últimos 90 dias"><span style={s.kpiV}>{int(data.summary.totalAlerts)}</span><span style={s.kpiL}>Alertas PrintGuard / 90d</span></div>
        <div style={s.kpi} title="Ordens de serviço abertas ou encerradas nos últimos 90 dias"><span style={s.kpiV}>{int(data.summary.totalCalls)}</span><span style={s.kpiL}>O.S. / 90d</span></div>
        <div style={s.kpi} title="Índice médio combinando alertas PrintGuard e O.S. por 1.000 páginas"><span style={s.kpiV}>{data.summary.avgProblemsPer1k ?? 0}</span><span style={s.kpiL}>Problemas / 1k pág — média</span></div>
      </div>
      <div style={s.card}>
        <div style={s.cardH}><strong>Equipamentos com recorrência — últimos 90 dias</strong><span style={s.hint}>Combina alertas PrintGuard e O.S. para indicar risco de troca.</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead><tr>{['#', 'Equipamento', 'Cliente', 'Alertas PG', 'O.S.', 'Problemas/1k', 'Pág/dia', 'Situação', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.equipmentId}>
                  <td style={{ ...s.td, color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                  <td style={s.td}><b>{r.model}</b><span style={s.small}><span style={s.mono}>{r.serialNumber || '—'}</span></span></td>
                  <td style={s.td}>{r.customerName || '—'}</td>
                  <td style={s.tdNum}>{r.alerts}</td>
                  <td style={s.tdNum}>{r.calls}</td>
                  <td style={s.tdNum} title={r.problemsPer1k == null ? 'Sem histórico de contador suficiente para normalizar por volume.' : 'Alertas + O.S. por 1.000 páginas'}>{r.problemsPer1k ?? '—'}</td>
                  <td style={s.tdNum}>{r.pagesPerDay != null ? int(r.pagesPerDay) : '—'}</td>
                  <td style={s.td}><span style={{ ...s.pill, ...(r.candidate ? s.pillCrit : s.pillWarn) }}>{r.candidate ? 'candidata a troca' : 'acompanhar'}</span></td>
                  <td style={s.td}><button style={s.linkBtn} onClick={() => openTimeline(r.equipmentId)}>Timeline do equipamento</button></td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td style={s.td} colSpan={9}>Nenhum alerta ou O.S. recorrente encontrado nos equipamentos vinculados no período.</td></tr>}
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

/* -------------------- estilos -------------------- */

const MONO = 'var(--font-mono)';
const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  subtabs: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  subtab: { font: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '7px 13px', borderRadius: 'var(--radius-pill)' },
  subtabActive: { background: 'var(--accent-light)', borderColor: 'var(--accent-border)', color: 'var(--accent-strong, var(--accent))' },
  sectionPurpose: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '1px 2px', color: 'var(--text-muted)', fontSize: 12 },

  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 },
  kpi: { textAlign: 'left', font: 'inherit', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 2 },
  kpiActive: { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent) inset' },
  kpiV: { fontFamily: MONO, fontSize: 20, fontWeight: 600, lineHeight: 1.1, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' },
  kpiL: { fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)' },

  consolidate: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--accent-light)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12.5, flexWrap: 'wrap' },

  split: { display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  splitMain: { flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  splitAside: { flex: '1 1 240px', maxWidth: 360 },
  resupplyRow: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 15px', borderBottom: '1px solid var(--border-color)' },
  resupplyName: { fontWeight: 600, fontSize: 12.5 },

  card: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' },
  cardH: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--border-color)', fontSize: 14, fontWeight: 600 },
  hint: { fontSize: 11.5, color: 'var(--text-muted)' },
  empty: { padding: 18, fontSize: 13, color: 'var(--text-muted)' },
  loading: { display: 'flex', alignItems: 'center', gap: 8, padding: 24, color: 'var(--text-muted)', fontSize: 13 },
  errorBox: { padding: 18, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' },
  footNote: { padding: '10px 15px 14px', fontSize: 11.5, color: 'var(--text-muted)', margin: 0 },

  incident: { display: 'flex', gap: 10, padding: '13px 15px', borderBottom: '1px solid var(--border-color)' },
  check: { width: 15, height: 15, marginTop: 3, accentColor: 'var(--accent)', cursor: 'pointer', flex: 'none' },
  incTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tag: { fontFamily: MONO, fontSize: 10.5, fontWeight: 500, letterSpacing: 0, padding: '3px 7px', borderRadius: 'var(--radius-xs)' },
  tag_crit: { background: 'var(--critical-light)', color: 'var(--critical)' },
  tag_warn: { background: 'var(--warning-light)', color: 'var(--warning-text)' },
  tag_info: { background: 'var(--bg-surface)', color: 'var(--text-muted)' },
  tagType: { fontFamily: MONO, fontSize: 10.5, padding: '3px 7px', borderRadius: 'var(--radius-xs)', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' },
  incAge: { marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO },
  incClient: { fontWeight: 600, fontSize: 14, margin: '7px 0' },
  incGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '8px 22px', maxWidth: 560 },

  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  fl: { fontFamily: MONO, fontSize: 10.5, letterSpacing: 0, color: 'var(--text-dim)' },
  fv: { fontSize: 12.5, color: 'var(--text-main)' },
  small: { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 2 },
  mono: { fontFamily: MONO, fontSize: 12 },
  minibar: { height: 6, borderRadius: 3, background: 'var(--border-color)', overflow: 'hidden', marginTop: 4 },
  chip: { display: 'inline-block', fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', marginTop: 4 },
  chip_ok: { background: 'var(--success-light)', color: 'var(--success-text)', borderColor: 'transparent' },
  chip_warn: { background: 'var(--warning-light)', color: 'var(--warning-text)', borderColor: 'transparent' },
  chip_bad: { background: 'var(--critical-light)', color: 'var(--critical)', borderColor: 'transparent' },
  chip_unknown: {},

  actions: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 },
  btn: { font: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '6px 11px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)' },
  btnPrimary: { font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '6px 12px', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--text-inverse)' },
  btnGhost: { font: 'inherit', fontSize: 12, cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '6px 8px', border: '1px solid transparent', background: 'transparent', color: 'var(--text-muted)' },
  linkBtn: { font: 'inherit', fontSize: 12, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--accent-strong, var(--accent))', padding: 0, textDecoration: 'underline' },

  overlay: { position: 'fixed', inset: 0, background: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 18, width: '100%', maxWidth: 420, boxShadow: 'var(--shadow-lg)' },
  modalH: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 },
  select: { width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: 13, marginTop: 4 },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', fontFamily: MONO, fontSize: 11, letterSpacing: 0, fontWeight: 500, color: 'var(--text-dim)', padding: '11px 14px', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', borderBottom: '1px solid var(--border-color)', verticalAlign: 'middle' },
  tdNum: { padding: '11px 14px', borderBottom: '1px solid var(--border-color)', textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' },
  gauge: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 },
  gaugeTrack: { flex: 1, height: 7, borderRadius: 4, background: 'var(--border-color)', overflow: 'hidden' },
  pill: { fontFamily: MONO, fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 'var(--radius-xs)' },
  pillWarn: { background: 'var(--warning-light)', color: 'var(--warning-text)' },
  pillCrit: { background: 'var(--critical-light)', color: 'var(--critical)' },

  tlItem: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--border-color)', fontSize: 12 },
  tlWhen: { fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)' },
  tlTag: { fontFamily: MONO, fontSize: 10, padding: '1px 5px', borderRadius: 'var(--radius-xs)', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', marginRight: 6 },
};
