import React, { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw, X } from 'lucide-react';
import {
  getParkQueue, getParkCoverage, getParkRanking, getParkEquipmentTimeline,
  getOsTypes,
} from '../../services/api';
import { toast } from '../../utils/toast';
import DecisionCenter from './DecisionCenter';

const SUBTABS = [
  { key: 'fila', label: 'Fila de decisão' },
  { key: 'franquia', label: 'Contadores & Franquia' },
  { key: 'cobertura', label: 'Cobertura' },
  { key: 'problema', label: 'Equipamentos-problema' },
  { key: 'auditoria', label: 'Auditoria' },
];

const money = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

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

      {tab === 'fila' && <DecisionCenter osTypes={osTypes} />}
      {tab === 'franquia' && <ContadoresFranquia />}
      {tab === 'cobertura' && <Cobertura />}
      {tab === 'problema' && <EquipamentosProblema />}
      {tab === 'auditoria' && <Auditoria />}
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
  const withoutRecentSignal = data.rows.filter((r) => r.status !== 'ativo');
  return (
    <>
      <div style={s.kpis}>
        <div style={s.kpi} title="Equipamentos ativos do iLux com vínculo PrintGuard confirmado"><span style={s.kpiV}>{int(sum.total)}</span><span style={s.kpiL}>Vinculadas ao PrintGuard</span></div>
        <div style={s.kpi} title="Percentual dos equipamentos vinculados que enviou sinal nas últimas 48 horas"><span style={{ ...s.kpiV, color: 'var(--accent)' }}>{sum.coveragePct ?? 0}%</span><span style={s.kpiL}>Com sinal recente</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--warning, #b3730a)' }}>{int(sum.offline)}</span><span style={s.kpiL}>Offline &gt; 48h</span></div>
        <div style={s.kpi}><span style={{ ...s.kpiV, color: 'var(--danger, #d64545)' }}>{int(sum.noSignal)}</span><span style={s.kpiL}>Sem sinal</span></div>
        <div style={s.kpi} title="Vínculos ainda ambíguos ou não encontrados, fora do cálculo de cobertura"><span style={{ ...s.kpiV, color: 'var(--warning, #b3730a)' }}>{int(sum.pendingBindings)}</span><span style={s.kpiL}>Vínculos pendentes</span></div>
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
                  <td style={s.td}><span style={{ ...s.pill, ...(r.status === 'offline' ? s.pillWarn : s.pillCrit) }}>{r.status === 'offline' ? `offline ${r.ageDays}d` : 'sem sinal'}</span></td>
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

  split: { display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  splitMain: { flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  splitAside: { flex: '1 1 240px', maxWidth: 360 },
  resupplyRow: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 15px', borderBottom: '1px solid var(--border-color)' },
  resupplyName: { fontWeight: 600, fontSize: 12.5 },

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
  incGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '8px 22px', maxWidth: 560 },

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
