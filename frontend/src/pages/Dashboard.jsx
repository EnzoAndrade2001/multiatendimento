import React, { useEffect, useRef, useState } from 'react';
import { getDashboardStats } from '../services/api';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, ArrowRight, Bot, CheckCircle2, Clock, Database, MessageSquare, RefreshCw, Star, TrendingUp, UserPlus } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';

const PERIOD_OPTIONS = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [periodDays, setPeriodDays] = useState(30);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const periodCacheRef = useRef(new Map());
  const latestRequestRef = useRef(0);

  useEffect(() => {
    const cached = periodCacheRef.current.get(periodDays);
    if (cached) {
      setStats(cached);
      setLastUpdatedAt(cached.generatedAt || new Date().toISOString());
      load(periodDays, { silent: true });
    } else {
      load(periodDays, { silent: Boolean(stats) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays]);

  async function load(days, { silent = false, force = false } = {}) {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const { data } = await getDashboardStats(days, force);
      periodCacheRef.current.set(days, data);
      if (requestId !== latestRequestRef.current) return;
      setStats(data);
      setLastUpdatedAt(data.generatedAt || new Date().toISOString());
    } catch (error) {
      console.error('Erro ao carregar dashboard:', error);
    } finally {
      if (requestId !== latestRequestRef.current) return;
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-6)', background: 'var(--bg-base)', flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-6)', marginBottom: 'var(--space-10)' }}>
          {[1, 2, 3, 4].map((item) => (
            <div key={item} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: 'var(--space-6)', height: '110px' }}>
              <div style={{ height: '12px', width: '60%', background: 'var(--bg-base)', borderRadius: '6px', marginBottom: 'var(--space-4)', animation: 'pulse-sk 1.5s infinite' }} />
              <div style={{ height: '28px', width: '40%', background: 'var(--bg-base)', borderRadius: '6px', animation: 'pulse-sk 1.5s infinite' }} />
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '24px', height: '360px', animation: 'pulse-sk 1.5s infinite' }} />
        <style>{`
          @keyframes pulse-sk {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.8; }
          }
        `}</style>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={s.errorState}>
        <AlertCircle size={28} color="var(--danger)" />
        <p style={s.errorTitle}>Não foi possível carregar o dashboard</p>
        <p style={s.errorText}>Verifique sua conexão e tente novamente.</p>
        <button type="button" style={s.retryBtn} onClick={() => load(periodDays)}>Tentar novamente</button>
      </div>
    );
  }

  const { kpis, dailyMessages, agentBreakdown, ratingsDistribution } = stats;
  const iaShare = kpis.totalMessages > 0 ? Math.round((kpis.iaMessages / kpis.totalMessages) * 100) : 0;
  const receivedMessages = Number(kpis.receivedMessages || 0);
  const health = stats.health || { overall: 'unknown', services: {} };
  const healthStatus = healthStatusInfo(health.overall);
  const whatsappHealth = healthStatusInfo(health.services?.whatsapp?.status);
  const iluxWebHealth = healthStatusInfo(health.services?.iluxWeb?.status);

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Visão operacional"
        title="Dashboard de performance"
        subtitle="Indicadores em tempo real para acompanhar eficiência, qualidade e capacidade da equipe."
        actions={(
          <div style={s.headerActions}>
            <div style={{ ...s.statusBadge, ...healthStatus.badge }} title="Status calculado a partir das instâncias WhatsApp e da última sincronização do ILUX WEB">
              <span style={{ ...s.dot, background: healthStatus.color, boxShadow: `0 0 10px ${healthStatus.glow}` }} /> {healthStatus.label}
            </div>
            <button type="button" style={s.refreshBtn} onClick={() => load(periodDays, { silent: true, force: true })} disabled={refreshing}>
              <RefreshCw size={15} style={refreshing ? { animation: 'dashboard-spin 0.9s linear infinite' } : undefined} />
              {refreshing ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        )}
        compact
      />

      <div style={s.toolbar}>
        <div style={s.periodGroup}>
          <span style={s.periodLabel}>Período:</span>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              style={{ ...s.periodBtn, ...(periodDays === opt.value ? s.periodBtnActive : {}) }}
              onClick={() => setPeriodDays(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={s.allTimeHint}>
          Desde o início: <strong>{kpis.totalMessagesAllTime.toLocaleString('pt-BR')}</strong> mensagens enviadas
          ({kpis.iaMessagesAllTime.toLocaleString('pt-BR')} pela IA · {kpis.humanMessagesAllTime.toLocaleString('pt-BR')} por humanos)
        </div>
      </div>

      <div style={s.healthRow} aria-label="Saúde das integrações">
        <span style={s.updatedAt}><Clock size={13} /> Atualizado às {formatDateTime(lastUpdatedAt)}</span>
        <span style={{ ...s.healthChip, ...whatsappHealth.chip }}><CheckCircle2 size={13} /> WhatsApp: {whatsappHealth.label}</span>
        <span style={{ ...s.healthChip, ...iluxWebHealth.chip }}><Database size={13} /> LCDDIGITALWEB: {iluxWebHealth.label}</span>
        <span style={s.queueHint}>Fila: {kpis.activeTickets || 0} abertas · {kpis.pendingTickets || 0} aguardando</span>
      </div>

      {kpis.tmaSampleSize > 0 && (
        <div style={s.metricNote}>
          Indicadores de atendimento calculados por sessão. Uma nova sessão começa após {kpis.sessionInactivityHours || 24}h sem atividade
          {kpis.reconstructedSessions > 0 ? ` · ${kpis.reconstructedSessions} sessão(ões) histórica(s) reconstruída(s)` : ''}.
        </div>
      )}

      <div style={s.kpiGrid}>
        <KpiCard
          icon={<MessageSquare color="#8b5cf6" />}
          label="Mensagens enviadas no período"
          value={kpis.totalMessages.toLocaleString('pt-BR')}
          hint={`${iaShare}% pela IA (${kpis.iaMessages.toLocaleString('pt-BR')} de ${kpis.totalMessages.toLocaleString('pt-BR')}) · ${receivedMessages.toLocaleString('pt-BR')} recebidas`}
          accentColor="#8b5cf6"
        />
        <KpiCard
          icon={<Bot color="#D4AF37" />}
          label="Tempo Economizado"
          value={`${kpis.hoursSaved}h`}
          hint={`${kpis.iaMessages} mensagens processadas pela IA`}
          accentColor="#D4AF37"
        />
        <KpiCard
          icon={<TrendingUp color="#10b981" />}
          label="Retenção IA por sessão"
          value={formatPercent(kpis.retentionRateEngaged)}
          hint={kpis.retentionEngagedSampleSize ? `${kpis.retainedByIAEngaged} de ${kpis.retentionEngagedSampleSize} conversas que o bot atendeu foram resolvidas sem humano` : 'Sem conversas encerradas no período'}
          accentColor="#10b981"
        />
        <KpiCard
          icon={<Clock color="var(--accent)" />}
          label="Tempo de resolução (mediana)"
          value={formatDuration(kpis.medianTMA)}
          hint={kpis.tmaSampleSize
            ? `Tempo útil ${formatDuration(kpis.medianBusinessTMA)} · Média corrida ${formatDuration(kpis.avgTMA)} · P90 ${formatDuration(kpis.p90TMA)} · ${kpis.tmaSampleSize} sessões`
            : 'Sem sessões encerradas no período'}
          accentColor="var(--accent)"
        />
        <KpiCard
          icon={<Star color="#f59e0b" />}
          label="Satisfação (CSAT)"
          value={kpis.avgRating == null ? '—' : `${kpis.avgRating}/5`}
          hint={`Baseado em ${kpis.totalRatings} avaliações`}
          accentColor="#f59e0b"
        />
        <KpiCard
          icon={<UserPlus color="#ec4899" />}
          label="Novos Contatos"
          value={kpis.newContacts.toLocaleString('pt-BR')}
          hint={`${kpis.totalContacts.toLocaleString('pt-BR')} contatos no total`}
          accentColor="#ec4899"
        />
      </div>

      <div style={s.mainGrid} className="dashboard-main-grid">
        <div style={s.chartSection}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Mensagens enviadas por dia ({periodDays} dias)</h2>
            <div style={s.legend}>
              <div style={s.legendItem}><span style={{ ...s.legendDot, background: '#D4AF37' }} /> IA</div>
              <div style={s.legendItem}><span style={{ ...s.legendDot, background: 'var(--text-muted)' }} /> Humano</div>
            </div>
          </div>
          <div style={s.chartWrapper}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailyMessages}>
                <defs>
                  <linearGradient id="colorIA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', color: 'var(--text-main)' }}
                  itemStyle={{ fontSize: '12px' }}
                  formatter={(value, name) => [Number(value || 0).toLocaleString('pt-BR'), name]}
                />
                <Area type="monotone" dataKey="ia" name="IA" stroke="#D4AF37" fillOpacity={1} fill="url(#colorIA)" strokeWidth={3} />
                <Area type="monotone" dataKey="human" name="Humano" stroke="var(--text-muted)" fillOpacity={0} strokeWidth={2} strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={s.sidebar}>
          <div style={s.sideCard}>
            <h3 style={s.sideTitle}>Distribuição de Notas</h3>
            {kpis.totalRatings === 0 ? <p style={s.emptyHint}>Nenhuma avaliação registrada ainda.</p> : (
              <div style={s.ratingDist}>
                {ratingsDistribution.slice().reverse().map((rating) => (
                  <div key={rating.rating} style={s.ratingRow}>
                    <span style={s.ratingLabel}>
                      {rating.rating} <Star size={12} style={{ display: 'inline', marginBottom: '2px' }} />
                    </span>
                    <div style={s.ratingBarBg}>
                      <div style={{ ...s.ratingBar, width: `${(rating.count / kpis.totalRatings) * 100}%` }} />
                    </div>
                    <span style={s.ratingCount}>{rating.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={s.sideCard}>
            <h3 style={s.sideTitle}>Ranking de Agentes</h3>
            <div style={s.ranking}>
              {agentBreakdown.slice(0, 5).map((agent, index) => (
                <div key={agent.id} style={s.rankItem}>
                  <div style={s.rankNum}>{index + 1}</div>
                  <div style={s.rankInfo}>
                    <div style={s.rankName}>{agent.name}</div>
                    <div style={s.rankMeta}>
                      {agent.resolvedCount} tickets · {agent.messagesCount} msgs
                      {agent.avgCsat != null && <> · ★ {agent.avgCsat}</>}
                    </div>
                  </div>
                  <ArrowRight size={14} color="var(--text-dim)" />
                </div>
              ))}
              {agentBreakdown.length === 0 && <p style={s.emptyHint}>Nenhum ticket resolvido no período selecionado.</p>}
            </div>
          </div>
        </div>
      </div>

      <div style={s.chartSection}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Desempenho por Atendente ({periodDays} dias)</h2>
        </div>
        {agentBreakdown.length === 0 ? (
          <p style={s.emptyHint}>Nenhuma atividade de atendente no período selecionado.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.agentTable}>
              <thead>
                <tr>
                  <th style={s.agentTh}>Atendente</th>
                  <th style={{ ...s.agentTh, textAlign: 'center' }}>Tickets Resolvidos</th>
                  <th style={{ ...s.agentTh, textAlign: 'center' }}>Mensagens Enviadas</th>
                  <th style={{ ...s.agentTh, textAlign: 'center' }}>Tempo médio</th>
                  <th style={{ ...s.agentTh, textAlign: 'center' }}>CSAT</th>
                </tr>
              </thead>
              <tbody>
                {agentBreakdown.map((agent) => (
                  <tr key={agent.id} style={s.agentTr}>
                    <td style={s.agentTd}><strong>{agent.name}</strong></td>
                    <td style={{ ...s.agentTd, textAlign: 'center' }}>{agent.resolvedCount}</td>
                    <td style={{ ...s.agentTd, textAlign: 'center' }}>{agent.messagesCount}</td>
                    <td style={{ ...s.agentTd, textAlign: 'center' }}>{formatDuration(agent.avgTma)}</td>
                    <td style={{ ...s.agentTd, textAlign: 'center' }}>
                      {agent.avgCsat != null ? `★ ${agent.avgCsat} (${agent.csatCount})` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        @keyframes dashboard-spin { to { transform: rotate(360deg); } }
        @media (max-width: 900px) {
          .dashboard-main-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '—';
  const value = Math.max(0, Math.round(Number(minutes)));
  if (value < 60) return `${value}m`;
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const remainingMinutes = value % 60;
  if (days > 0) return `${days}d${hours ? ` ${hours}h` : ''}`;
  return `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''}`;
}

function formatPercent(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Number(value)}%`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function healthStatusInfo(status) {
  const normalized = String(status || 'unknown').toLowerCase();
  if (normalized === 'ok') return { label: 'Operacional', color: '#16a34a', glow: 'rgba(22,163,74,.35)', badge: {}, chip: { color: 'var(--success-text)', borderColor: 'var(--success-border)', background: 'var(--success-light)' } };
  if (normalized === 'syncing') return { label: 'Sincronizando', color: '#d97706', glow: 'rgba(217,119,6,.35)', badge: {}, chip: { color: 'var(--warning-text)', borderColor: 'var(--warning-border)', background: 'var(--warning-light)' } };
  if (normalized === 'degraded') return { label: 'Atenção', color: '#dc2626', glow: 'rgba(220,38,38,.35)', badge: { borderColor: 'var(--danger-border)' }, chip: { color: 'var(--danger-text)', borderColor: 'var(--danger-border)', background: 'var(--danger-light)' } };
  if (normalized === 'not_configured') return { label: 'Não configurado', color: '#64748b', glow: 'rgba(100,116,139,.25)', badge: {}, chip: { color: 'var(--text-muted)', borderColor: 'var(--border-color)', background: 'var(--bg-base)' } };
  return { label: 'Verificar', color: '#64748b', glow: 'rgba(100,116,139,.25)', badge: { borderColor: 'var(--warning-border)' }, chip: { color: 'var(--warning-text)', borderColor: 'var(--warning-border)', background: 'var(--warning-light)' } };
}

function KpiCard({ icon, label, value, hint, accentColor }) {
  return (
    <div style={{ ...s.kpiCard, position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: accentColor || 'var(--accent)',
          borderRadius: '20px 20px 0 0',
        }}
      />
      <div style={s.kpiIcon}>{icon}</div>
      <div style={s.kpiContent}>
        <div style={s.kpiLabel}>{label}</div>
        <div style={s.kpiValue}>{value}</div>
        <div style={s.kpiHint}>{hint}</div>
      </div>
    </div>
  );
}

const s = {
  container: { padding: 'var(--space-6)', background: 'var(--bg-base)', flex: 1, overflowY: 'auto', color: 'var(--text-main)' },
  errorState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', minHeight: '50vh', padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-main)' },
  errorTitle: { fontSize: 'var(--text-md)', fontWeight: 700, margin: 0 },
  errorText: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 },
  retryBtn: { marginTop: 'var(--space-2)', padding: '0.6rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-border)', background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', fontSize: 'var(--text-sm)' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' },
  statusBadge: { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', padding: '0.6rem 1rem', borderRadius: '100px', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px rgba(16,185,129,0.4)' },
  refreshBtn: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minHeight: 38, padding: '0.55rem 0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontWeight: 800, cursor: 'pointer', fontSize: 'var(--text-sm)' },
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' },
  periodGroup: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  periodLabel: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginRight: '2px' },
  periodBtn: { padding: '0.4rem 0.9rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: 700, cursor: 'pointer' },
  periodBtnActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-inverse)' },
  allTimeHint: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)' },
  healthRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.45rem 0.8rem', margin: '-0.9rem 0 var(--space-6)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  metricNote: { margin: '-0.85rem 0 var(--space-5)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  updatedAt: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem' },
  healthChip: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', borderRadius: '999px', padding: '0.22rem 0.5rem', fontWeight: 700 },
  queueHint: { marginLeft: 'auto' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-6)', marginBottom: 'var(--space-10)' },
  kpiCard: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '20px', padding: 'var(--space-6)', display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' },
  kpiIcon: { background: 'var(--bg-base)', padding: 'var(--space-3)', borderRadius: '12px', border: '1px solid var(--border-color)' },
  kpiContent: { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 },
  kpiLabel: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' },
  kpiValue: { fontSize: 'var(--text-2xl)', fontWeight: 900, margin: '4px 0', color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' },
  kpiHint: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  mainGrid: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' },
  chartSection: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '24px', padding: 'var(--space-8)', minWidth: 0 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-8)', flexWrap: 'wrap', gap: 'var(--space-3)' },
  sectionTitle: { fontSize: 'var(--text-lg)', fontWeight: 800, margin: 0, fontFamily: 'var(--font-display)' },
  legend: { display: 'flex', gap: 'var(--space-6)' },
  legendItem: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' },
  legendDot: { width: '8px', height: '8px', borderRadius: '50%' },
  chartWrapper: { marginTop: 'var(--space-4)' },
  sidebar: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', minWidth: 0 },
  sideCard: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '24px', padding: 'var(--space-6)' },
  sideTitle: { fontSize: 'var(--text-sm)', fontWeight: 800, marginBottom: 'var(--space-6)', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  ratingDist: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },
  ratingRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' },
  ratingLabel: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: '30px' },
  ratingBarBg: { flex: 1, height: '6px', background: 'var(--bg-base)', borderRadius: '3px', overflow: 'hidden' },
  ratingBar: { height: '100%', background: '#f59e0b', borderRadius: '3px' },
  ratingCount: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', minWidth: '20px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  ranking: { display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  rankItem: { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.9rem 1rem', borderRadius: '16px', background: 'var(--bg-base)', border: '1px solid var(--border-color)' },
  rankNum: { width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--text-inverse)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '0.85rem' },
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rankMeta: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' },
  emptyHint: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 },
  agentTable: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: 'var(--space-4)' },
  agentTh: { padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-color)' },
  agentTr: { borderBottom: '1px solid var(--border-color)' },
  agentTd: { padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' },
};
