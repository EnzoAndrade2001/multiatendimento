import React, { useEffect, useMemo, useState } from 'react';
import { 
  getRevenueStats, 
  getRevenueBenchmark, 
  getRevenueDetective, 
  getAuditedTickets, 
  auditTicket,
  getRevenueDrilldown,
  BACKEND_URL
} from '../services/api';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell
} from 'recharts';
import { 
  AlertTriangle, 
  ShieldAlert, 
  Coins, 
  TrendingUp, 
  Zap, 
  Building2, 
  Users, 
  Search, 
  CheckCircle,
  Play,
  RotateCw,
  Award,
  Clock
} from 'lucide-react';
import { toast } from '../utils/toast';
import SaudeParque from './parque/SaudeParque';
import { useSearchParams } from 'react-router-dom';

const TABS = [
  { key: 'parque', label: 'Saúde do Parque', description: 'Equipamentos, telemetria e decisões operacionais.' },
  { key: 'crise', label: 'Risco de Receita & SLA', description: 'Impacto financeiro, SLAs rompidos e prioridades executivas.' },
  { key: 'funil', label: 'Fluxo de O.S.', description: 'Evolução, gargalos e ordens paradas no processo de atendimento.' },
  { key: 'benchmark', label: 'Benchmark Interno', description: 'Comparação de desempenho entre equipes e períodos.' },
  { key: 'detetive', label: 'Detetive IA', description: 'Investigação assistida de padrões e causas operacionais.' },
  { key: 'auditoria', label: 'Qualidade dos Atendimentos', description: 'Avaliação por IA da qualidade das conversas resolvidas.' },
];

export default function RevGuard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedArea = searchParams.get('area');
  const activeTab = TABS.some((tab) => tab.key === requestedArea) ? requestedArea : 'parque';
  const setActiveTab = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('area', key);
    if (key !== 'parque') next.delete('section');
    setSearchParams(next, { replace: true });
  };
  
  // States para cada aba
  const [crisisData, setCrisisData] = useState(null);
  const [benchmarkData, setBenchmarkData] = useState(null);
  const [benchmarkPeriod, setBenchmarkPeriod] = useState('90');
  const [detectiveData, setDetectiveData] = useState(null);
  const [auditList, setAuditList] = useState([]);
  const [auditSummary, setAuditSummary] = useState(null);
  const [parkSummary, setParkSummary] = useState(null);
  
  // Loading states
  const [loadingCrisis, setLoadingCrisis] = useState(true);
  const [loadingBenchmark, setLoadingBenchmark] = useState(false);
  const [loadingDetective, setLoadingDetective] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditingTicketId, setAuditingTicketId] = useState(null);
  
  // Ticket selecionado para auditoria
  const [selectedTicket, setSelectedTicket] = useState(null);
  // Busca local na lista de atendimentos para auditoria (pode ter até 50 itens)
  const [auditSearch, setAuditSearch] = useState('');

  // Drilldown states
  const [drilldownData, setDrilldownData] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownTitle, setDrilldownTitle] = useState('');
  const [showDrilldownModal, setShowDrilldownModal] = useState(false);

  useEffect(() => {
    loadCrisis();
  }, []);

  useEffect(() => {
    if (activeTab === 'crise' || activeTab === 'funil') loadCrisis();
    if (activeTab === 'benchmark') loadBenchmark();
    if (activeTab === 'detetive') loadDetective();
    if (activeTab === 'auditoria') loadAuditList();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'benchmark') loadBenchmark();
  }, [benchmarkPeriod]);

  async function loadCrisis() {
    setLoadingCrisis(true);
    try {
      const res = await getRevenueStats();
      setCrisisData(res.data);
    } catch (error) {
      console.error('Erro ao carregar dados do RevGuard:', error);
      const message = error.response?.data?.error || error.message || 'Falha desconhecida.';
      toast.error(`Erro ao carregar dados de receita: ${message}`);
    } finally {
      setLoadingCrisis(false);
    }
  }

  async function loadBenchmark() {
    setLoadingBenchmark(true);
    try {
      const res = await getRevenueBenchmark(benchmarkPeriod);
      setBenchmarkData(res.data);
    } catch (error) {
      console.error('Erro ao carregar benchmark:', error);
      const message = error.response?.data?.error || error.message || 'Falha desconhecida.';
      toast.error(`Erro ao carregar benchmark: ${message}`);
    } finally {
      setLoadingBenchmark(false);
    }
  }

  async function loadDetective() {
    setLoadingDetective(true);
    try {
      const res = await getRevenueDetective();
      setDetectiveData(res.data);
    } catch (error) {
      console.error('Erro ao carregar detetive:', error);
      const message = error.response?.data?.error || error.message || 'Falha desconhecida.';
      toast.error(`Erro ao carregar Detetive IA: ${message}`);
    } finally {
      setLoadingDetective(false);
    }
  }

  async function loadAuditList() {
    setLoadingAudit(true);
    try {
      const res = await getAuditedTickets();
      const list = res.data?.tickets || [];
      setAuditList(list);
      setAuditSummary(res.data?.summary || null);
      if (selectedTicket) {
        // Atualiza o ticket selecionado caso ele já estivesse aberto
        const updated = list.find(t => t.id === selectedTicket.id);
        if (updated) setSelectedTicket(updated);
      }
    } catch (error) {
      console.error('Erro ao carregar atendimentos:', error);
      const message = error.response?.data?.error || error.message || 'Falha desconhecida.';
      toast.error(`Erro ao carregar atendimentos: ${message}`);
    } finally {
      setLoadingAudit(false);
    }
  }

  async function handleAudit(ticketId) {
    setAuditingTicketId(ticketId);
    try {
      toast.info('IA analisando conversa... Isso pode levar alguns segundos.');
      const res = await auditTicket(ticketId);
      toast.success('Auditoria concluída com sucesso!');
      
      // Recarrega a lista
      await loadAuditList();
      
      // Atualiza o painel lateral com os resultados novos mesclando dados anteriores
      setSelectedTicket(prev => {
        if (!prev) return res.data;
        return {
          ...prev,
          auditScore: res.data.auditScore,
          auditResult: res.data.auditResult,
          auditedAt: res.data.auditedAt
        };
      });
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Falha na análise.';
      toast.error(`Erro ao auditar: ${message}`);
    } finally {
      setAuditingTicketId(null);
    }
  }

  async function handleOpenDrilldown(type, title) {
    setDrilldownTitle(title);
    setDrilldownData([]);
    setShowDrilldownModal(true);
    setDrilldownLoading(true);
    try {
      const res = await getRevenueDrilldown(type);
      setDrilldownData(res.data || []);
    } catch (error) {
      console.error('Erro ao buscar detalhamento:', error);
      toast.error('Erro ao carregar dados detalhados. Tente novamente.');
      setShowDrilldownModal(false);
    } finally {
      setDrilldownLoading(false);
    }
  }

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  const sourceLabel = (source) => ({
    firebird: 'Firebird',
    crm: 'cadastro CRM',
    manual_estimate: 'estimativa manual',
    missing: 'sem valor',
  }[source] || source);

  const sourceSummary = (quality) => {
    const sources = quality?.valueSources || {};
    const parts = [];
    if (sources.firebird) parts.push(`${sources.firebird} Firebird`);
    if (sources.crm) parts.push(`${sources.crm} CRM`);
    if (sources.manual_estimate) parts.push(`${sources.manual_estimate} estimada${sources.manual_estimate === 1 ? '' : 's'}`);
    if (sources.missing) parts.push(`${sources.missing} sem valor`);
    return parts.join(' · ') || 'Nenhum valor disponível';
  };

  const syncState = crisisData?.synchronization;
  const syncIsHealthy = syncState && !syncState.stale && ['ok', 'online'].includes(String(syncState.status).toLowerCase());
  const syncStatusLabel = !syncState
    ? 'Monitoramento ativo'
    : syncState.stale
      ? 'Agente Firebird desatualizado'
      : `Firebird sincronizado${syncState.ageMinutes != null ? ` há ${syncState.ageMinutes} min` : ''}`;

  // Selo de tendência (hoje vs. última data com snapshot registrado). Para
  // métricas "quanto menor melhor" (risco, vazamento) increaseIsBad=true;
  // increaseIsBad=false para o inverso (ex.: taxa de resolução).
  const renderTrendBadge = (delta, { format = 'currency', increaseIsBad = true, previousDate } = {}) => {
    if (delta == null || Number.isNaN(delta)) return null;
    const isFlat = Math.abs(delta) < (format === 'currency' ? 1 : 0.05);
    const isUp = delta > 0;
    const isGood = isFlat ? null : (isUp ? !increaseIsBad : increaseIsBad);
    const color = isFlat ? 'var(--text-dim)' : (isGood ? 'var(--success)' : 'var(--critical)');
    const arrow = isFlat ? '→' : (isUp ? '▲' : '▼');
    const formatted = format === 'currency'
      ? formatCurrency(Math.abs(delta))
      : format === 'hours'
        ? `${Math.abs(delta).toFixed(1)}h`
        : Math.abs(delta).toFixed(0);
    const dateLabel = previousDate ? new Date(previousDate).toLocaleDateString('pt-BR') : null;
    return (
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color }} title={dateLabel ? `Comparado com a leitura de ${dateLabel}` : undefined}>
        {arrow} {formatted} vs. leitura anterior
      </span>
    );
  };

  // Memoizado: evita refiltrar a lista de atendimentos a cada render
  // (ex.: quando auditingTicketId muda durante uma auditoria em andamento).
  const filteredAuditList = useMemo(() => {
    const term = auditSearch.trim().toLowerCase();
    if (!term) return auditList;
    return auditList.filter((ticket) =>
      ticket.contactName?.toLowerCase().includes(term) ||
      ticket.agentName?.toLowerCase().includes(term)
    );
  }, [auditList, auditSearch]);

  const renderMarkdown = (txt) => {
    if (!txt) return null;
    return txt.split('\n').map((line, i) => {
      if (line.startsWith('### ')) {
        return <h3 key={i} style={{ fontSize: '0.95rem', fontWeight: 800, margin: '14px 0 6px 0', color: 'var(--accent)' }}>{line.slice(4)}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={i} style={{ fontSize: '1.05rem', fontWeight: 800, margin: '18px 0 8px 0', color: 'var(--accent)', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>{line.slice(3)}</h2>;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return <li key={i} style={{ fontSize: '0.85rem', margin: '4px 0 4px 12px', listStyleType: 'disc', color: 'var(--text-muted)' }}>{line.slice(2)}</li>;
      }
      const parts = line.split('**');
      if (parts.length > 1) {
        return (
          <p key={i} style={{ fontSize: '0.85rem', margin: '6px 0', lineHeight: 1.5, color: 'var(--text-muted)' }}>
            {parts.map((p, idx) => idx % 2 === 1 ? <strong key={idx} style={{ color: 'var(--text-main)', fontWeight: 700 }}>{p}</strong> : p)}
          </p>
        );
      }
      return <p key={i} style={{ fontSize: '0.85rem', margin: '6px 0', lineHeight: 1.5, color: 'var(--text-muted)' }}>{line}</p>;
    });
  };

  return (
    <div style={s.container}>
      <header style={s.header}>
        <div style={s.headerInfo}>
          <div style={s.kickerGroup}>
            <span style={s.kicker}>ILUX WEB Sentinela</span>
            <span style={s.intelligenceBadge}>Inteligência sobre dados reais do ILUX WEB</span>
          </div>
          <h1 style={s.title}>Cockpit de Operações e Receita</h1>
          <p style={s.subtitle}>Decida sobre o parque, acompanhe O.S., proteja SLAs e melhore a qualidade dos atendimentos.</p>
        </div>
        <div style={s.statusBadge} title={syncState?.error || undefined}>
          <span style={{ ...s.dot, background: syncIsHealthy === false ? 'var(--warning)' : 'var(--success)' }} /> {syncStatusLabel}
        </div>
      </header>

      {/* Navegação de Abas */}
      {syncState && (
        <div style={{ ...s.syncBanner, ...(syncState.stale ? s.syncBannerStale : {}) }}>
          <div>
            <strong>{syncState.stale ? 'Atenção: os indicadores podem estar desatualizados.' : 'Dados operacionais sincronizados do ILUX WEB.'}</strong>
            <span>
              {syncState.lastSyncedAt
                ? ` Última leitura: ${new Date(syncState.lastSyncedAt).toLocaleString('pt-BR')}.`
                : ' O agente ainda não enviou uma leitura.'}
            </span>
          </div>
          {syncState.error && <span title={syncState.error} style={s.syncError}>Ver erro</span>}
        </div>
      )}

      {activeTab === 'crise' && crisisData && (
        <div style={s.sourceBanner} role="status">
          <strong>Fonte dos indicadores</strong>
          <span>MRR: {sourceSummary(crisisData.dataQuality?.mrr)}</span>
          <span>Orçamentos: {sourceSummary(crisisData.dataQuality?.stalledEstimates)}</span>
        </div>
      )}

      {activeTab === 'parque' && (
        <div style={s.sourceBanner} role="status">
          <strong>Fonte</strong>
          <span>{parkSummary?.dataSource || 'PrintGuard'} · janela de {Math.round((parkSummary?.windowHours || 168) / 24)} dia(s)</span>
          <span style={s.sourceMeta}>
            {parkSummary?.affectedCustomers || 0} cliente(s) afetado(s) · {parkSummary?.withoutCustomerPhone || 0} sem telefone · {parkSummary?.withMeterHistory || 0} com histórico de contador
          </span>
        </div>
      )}

      <div style={s.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            title={t.description}
            aria-label={`${t.label}. ${t.description}`}
            style={{ ...s.tab, ...(activeTab === t.key ? s.tabActive : {}) }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ABA 0: CENTRO DE CRISE */}
      {activeTab === 'parque' && <SaudeParque onSummaryChange={setParkSummary} />}

      {activeTab === 'crise' && (
        loadingCrisis ? (
          <div style={s.loadingBox}>
            <div style={s.spinner} /> Carregando riscos de receita e SLA...
          </div>
        ) : !crisisData ? (
          <div style={s.errorBox}>Erro ao carregar dados do ILUX WEB Sentinela.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* KPI Grid */}
            <div style={s.kpiGrid}>
              <div style={s.riskCard}>
                <div style={s.riskCardHeader}>
                  <AlertTriangle color="#ef4444" size={24} style={s.pulseAlert} />
                  <span style={s.riskLabel}>Receita em Risco Hoje</span>
                </div>
                <div style={s.riskValue}>{formatCurrency(crisisData.receitaEmRiscoHoje)}</div>
                {crisisData.trend && renderTrendBadge(crisisData.trend.mrrInRiskDelta, { previousDate: crisisData.trend.previousDate })}
                <p style={s.riskHint}>
                  Soma do MRR sob quebra de SLA ({crisisData.kpis.kpiSlaLimitHours}h+) e orçamentos avulsos parados.
                </p>
              </div>

              <div 
                style={{ ...s.kpiCard, cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                onClick={() => handleOpenDrilldown('mrr_risk', 'MRR Sob Risco (Detalhado)')}
              >
                <div style={{ ...s.kpiIcon, color: 'var(--accent)' }}><Coins size={22} /></div>
                <div style={s.kpiContent}>
                  <span style={s.kpiLabel}>Locações Sob Risco (MRR)</span>
                  <span style={s.kpiValue}>{formatCurrency(crisisData.mrrInRisk)}</span>
                  {crisisData.trend
                    ? renderTrendBadge(crisisData.trend.mrrInRiskDelta, { previousDate: crisisData.trend.previousDate })
                    : <span style={s.kpiHint}>Baseado nos contratos (Firebird)</span>}
                </div>
                {crisisData.mrrRiskBands && (
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', width: '100%', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', padding: '6px', borderRadius: '4px', borderTop: '2px solid #10b981', border: '1px solid var(--border-color)' }}>
                      <div style={{ color: 'var(--text-dim)' }}>1-3 dias</div>
                      <div style={{ color: 'var(--text-base)', fontWeight: 'bold' }}>{formatCurrency(crisisData.mrrRiskBands.band1to3)}</div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', padding: '6px', borderRadius: '4px', borderTop: '2px solid #f59e0b', border: '1px solid var(--border-color)' }}>
                      <div style={{ color: 'var(--text-dim)' }}>3-7 dias</div>
                      <div style={{ color: 'var(--text-base)', fontWeight: 'bold' }}>{formatCurrency(crisisData.mrrRiskBands.band3to7)}</div>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', padding: '6px', borderRadius: '4px', borderTop: '2px solid #ef4444', border: '1px solid var(--border-color)' }}>
                      <div style={{ color: 'var(--text-dim)' }}>+7 dias</div>
                      <div style={{ color: 'var(--text-base)', fontWeight: 'bold' }}>{formatCurrency(crisisData.mrrRiskBands.bandOver7)}</div>
                    </div>
                  </div>
                )}
              </div>

              <div 
                style={{ ...s.kpiCard, cursor: 'pointer' }}
                onClick={() => handleOpenDrilldown('stalled_estimates', 'Orçamentos Avulsos Parados')}
              >
                <div style={{ ...s.kpiIcon, color: 'var(--warning)' }}><Zap size={22} /></div>
                <div style={s.kpiContent}>
                  <span style={s.kpiLabel}>Orçamentos Avulsos Parados</span>
                  <span style={s.kpiValue}>{crisisData.stalledEstimatesCount ?? 0} O.S.</span>
                  <span style={s.kpiHint}>
                    {crisisData.stalledEstimatesValue > 0
                      ? `${formatCurrency(crisisData.stalledEstimatesValue)} aguardando aprovação do cliente`
                      : 'Aguardando aprovação do cliente (ILUX WEB)'}
                  </span>
                </div>
              </div>

              <div style={s.kpiCard}>
                <div style={{ ...s.kpiIcon, color: '#8b5cf6' }}><Clock size={22} /></div>
                <div style={s.kpiContent}>
                  <span style={s.kpiLabel}>Tempo Médio em Aberto</span>
                  <span style={s.kpiValue}>
                    {typeof crisisData.averageOpenTimeHours === 'number' && crisisData.averageOpenTimeHours > 0 
                      ? (crisisData.averageOpenTimeHours > 24 
                          ? (crisisData.averageOpenTimeHours/24).toFixed(1) + ' dias' 
                          : crisisData.averageOpenTimeHours.toFixed(1) + ' horas') 
                      : '0 h'}
                  </span>
                  {crisisData.trend
                    ? renderTrendBadge(crisisData.trend.avgOpenHoursDelta, { format: 'hours', previousDate: crisisData.trend.previousDate })
                    : <span style={s.kpiHint}>Média geral de tempo para O.S. ativas</span>}
                </div>
              </div>
            </div>

            {/* Main Grid: Gargalos e Mini-Funil */}
            <div style={s.mainGrid}>
              {/* Gargalos */}
              <div style={s.chartSection}>
                <div style={s.sectionHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldAlert size={20} color="var(--accent)" />
                    <h2 style={s.sectionTitle}>Gargalos Críticos Identificados</h2>
                  </div>
                </div>
                <div style={s.causesList}>
                  {crisisData.causas.map((causa) => {
                    let type = '';
                    if (causa.id === '1') type = 'no_technician';
                    if (causa.id === '2') type = 'stalled_estimates';
                    if (causa.id === '3') type = 'reincident_equipments';
                    if (causa.id === '4') type = 'bad_csat';

                    return (
                    <div 
                      key={causa.id} 
                      style={{ ...s.causeRow, cursor: 'pointer' }}
                      onClick={() => handleOpenDrilldown(type, causa.descricao)}
                    >
                      <div style={s.causeInfo}>
                        <span
                          role="img"
                          aria-label={causa.prioridade === 'alta' ? 'Prioridade alta' : 'Prioridade média'}
                          title={causa.prioridade === 'alta' ? 'Prioridade alta' : 'Prioridade média'}
                          style={{
                            ...s.priorityDot,
                            background: causa.prioridade === 'alta' ? 'var(--critical)' : 'var(--warning)',
                            boxShadow: causa.prioridade === 'alta' ? '0 0 8px rgba(239,68,68,0.5)' : '0 0 8px rgba(245,158,11,0.5)'
                          }}
                        />
                        <span style={s.causeText}>{causa.descricao}</span>
                      </div>
                      <div style={s.causeStats}>
                        <span style={s.causeCount}>{causa.quantidade}</span>
                        <span style={s.causeSub}>Ocorrências</span>
                      </div>
                    </div>
                  )})}
                  {crisisData.causas.length === 0 && (
                    <p style={s.emptyHint}>Nenhum gargalo crítico identificado no momento. Operação dentro do esperado.</p>
                  )}
                </div>
              </div>

              {/* Mini-Funil */}
              <div style={s.chartSection}>
                <div style={s.sectionHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp size={20} color="#10b981" />
                    <h2 style={s.sectionTitle}>Conversão de Chamados (Últimos 30 dias)</h2>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center', height: '100%' }}>
                  <div style={s.miniFunnelRow}>
                    <span>Novos Chamados:</span>
                    <strong>{crisisData.funnel.novosChamados}</strong>
                  </div>
                  <div style={s.miniFunnelRow}>
                    <span>Em Atendimento:</span>
                    <strong>{crisisData.funnel.emAtendimento}</strong>
                  </div>
                  <div style={s.miniFunnelRow}>
                    <span>Aguardando Aprovação:</span>
                    <strong>{crisisData.funnel.aguardandoCliente}</strong>
                  </div>
                  <div style={s.miniFunnelRow}>
                    <span>Finalizadas no Mês:</span>
                    <strong>{crisisData.funnel.finalizadosMes}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Ranking dos Clientes em Risco */}
            {crisisData.rankingClientsAtRisk && crisisData.rankingClientsAtRisk.length > 0 && (
              <div style={s.chartSection}>
                <div style={s.sectionHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={20} color="#ef4444" />
                    <h2 style={s.sectionTitle}>Ranking: Top 10 Clientes em Risco de Cancelamento</h2>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Cliente</th>
                        <th style={s.th}>MRR Ameaçado</th>
                        <th style={s.th}>Maior Atraso</th>
                        <th style={s.th}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crisisData.rankingClientsAtRisk.map((client, i) => (
                        <tr key={client.clientExternalId} style={s.tr}>
                          <td style={s.tdClientName}>
                            <span style={{ fontWeight: '600' }}>#{i+1} {client.clientName}</span>
                          </td>
                          <td style={{ ...s.td, color: 'var(--critical)', fontWeight: 'bold' }}>
                            {formatCurrency(client.mrr)}
                            <span style={s.inlineSource}>{sourceLabel(client.valueSource)}</span>
                          </td>
                          <td style={s.td}>
                            {typeof client.daysLate === 'number' ? client.daysLate.toFixed(1) : 0} dias
                          </td>
                          <td style={s.td}>
                            {client.oldestOSExternalId && (
                              <button 
                                style={{ ...s.actionBtn, background: 'var(--accent)', padding: '4px 12px' }} 
                                onClick={() => window.open(`${BACKEND_URL}/api/os/${encodeURIComponent(client.oldestOSExternalId)}/pdf?token=${localStorage.getItem('token')}`, '_blank')}
                              >
                                Ver O.S. mais antiga
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )
      )}

      {/* ABA 1: VAZAMENTO DO FUNIL */}
      {activeTab === 'funil' && (
        loadingCrisis ? (
          <div style={s.loadingBox}><div style={s.spinner} /> Carregando funil...</div>
        ) : !crisisData ? (
          <div style={s.errorBox}>Erro ao carregar dados do funil.</div>
        ) : (
          <div style={s.chartSection}>
            <div style={s.sectionHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TrendingUp size={20} color="#10b981" />
                <h2 style={s.sectionTitle}>Pipeline e Gargalos de Ordens de Serviço</h2>
              </div>
              <span style={s.badge}>Leitura Sincronizada (Firebird)</span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem', marginTop: '1rem' }}>
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={[
                      { name: 'Novas O.S.', value: crisisData.funnel.novosChamados, fill: '#8b5cf6' },
                      { name: 'Em Atendimento', value: crisisData.funnel.emAtendimento, fill: 'var(--accent)' },
                      { name: 'Aguardando', value: crisisData.funnel.aguardandoCliente, fill: '#f59e0b' },
                      { name: 'Finalizadas', value: crisisData.funnel.finalizadosMes, fill: '#10b981' }
                    ]} 
                    barSize={80}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', color: 'var(--text-main)' }}
                      cursor={{ fill: 'var(--bg-surface)' }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {[
                        <Cell key="0" fill="#8b5cf6" />,
                        <Cell key="1" fill="var(--accent)" />,
                        <Cell key="2" fill="#f59e0b" />,
                        <Cell key="3" fill="#10b981" />
                      ]}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)' }}>Análise de Conversão & Perdas</h3>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  O gráfico reflete a evolução de O.S. Identifique rapidamente gargalos e prejuízos financeiros.
                </p>
                <div style={{ ...s.causeRow, background: 'rgba(239,68,68,0.04)', borderColor: 'rgba(239,68,68,0.2)' }}>
                  <div>
                    <strong style={{ color: 'var(--critical)', fontSize: '0.88rem', display: 'block' }}>Vazamento Estimado no Funil</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{crisisData.funnel.vazamentoMes || 0} O.S. paradas há mais de 30 dias</span>
                  </div>
                  <strong style={{ fontSize: '1.2rem', color: 'var(--critical)' }}>{formatCurrency(crisisData.funnel.vazamentoValor || 0)}</strong>
                </div>
                {crisisData.funnel.vazamentoSemValorCount > 0 && (
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>
                    ⚠️ {crisisData.funnel.vazamentoSemValorCount} de {crisisData.funnel.vazamentoMes} O.S. vazadas não têm valor de peças/serviço informado pelo Firebird — o valor acima é uma estimativa parcial, o vazamento real pode ser maior.
                  </p>
                )}
                {crisisData.funnel.vazamentoFallbackValueCount > 0 && (
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--warning)', lineHeight: 1.4 }}>
                    {crisisData.funnel.vazamentoFallbackValueCount} O.S. sem valor no Firebird usaram o valor mÃ©dio configurado como estimativa ({formatCurrency(crisisData.dataQuality?.leakage?.manualFallbackValue || 0)}).
                  </p>
                )}
                <div style={{ ...s.causeRow, background: 'rgba(16,185,129,0.04)', borderColor: 'rgba(16,185,129,0.2)' }}>
                  <div>
                    <strong style={{ color: 'var(--success)', fontSize: '0.88rem', display: 'block' }}>Taxa de Resolução (30 dias)</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{crisisData.funnel.finalizadosMes} de {crisisData.funnel.osOpenedLast30d ?? '?'} O.S. abertas nos últimos 30 dias já finalizadas</span>
                  </div>
                  <strong style={{ fontSize: '1.2rem', color: 'var(--text-main)' }}>
                    {crisisData.funnel.resolutionRatePct != null ? `${crisisData.funnel.resolutionRatePct}%` : '--'}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* ABA 2: BENCHMARK INTERNO */}
      {activeTab === 'benchmark' && (
        loadingBenchmark ? (
          <div style={s.loadingBox}><div style={s.spinner} /> Carregando benchmark...</div>
        ) : !benchmarkData ? (
          <div style={s.errorBox}>Erro ao carregar benchmark.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Período:</span>
              {[['30', '30 dias'], ['90', '90 dias'], ['all', 'Todo o histórico']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setBenchmarkPeriod(val)}
                  style={{
                    ...s.periodBtn,
                    ...(benchmarkPeriod === val ? s.periodBtnActive : {})
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* Clientes */}
            <div style={s.chartSection}>
              <div style={s.sectionHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={20} color="var(--accent)" />
                  <h2 style={s.sectionTitle}>Benchmark por Clientes (Top 10)</h2>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Cliente</th>
                      <th style={{ ...s.th, textAlign: 'center' }}>Total O.S.</th>
                      <th style={{ ...s.th, textAlign: 'center' }}>SLA Médio (h)</th>
                      <th style={{ ...s.th, textAlign: 'center' }}>CSAT Médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarkData.clientes.map((c, idx) => {
                      const maxOS = benchmarkData.clientes[0]?.osCount || 1;
                      const pct = Math.min((c.osCount / maxOS) * 100, 100);
                      const bgGradient = `linear-gradient(to right, rgba(16, 185, 129, 0.08) ${pct}%, transparent ${pct}%)`;
                      let slaColor = 'var(--text-main)';
                      if (c.avgSla) {
                        if (c.avgSla <= 24) slaColor = 'var(--success)';
                        else if (c.avgSla <= 72) slaColor = 'var(--warning)';
                        else slaColor = 'var(--critical)';
                      }
                      return (
                        <tr key={c.id} style={s.tr}>
                          <td style={s.tdClientName} title={c.nome}>
                            <span style={{ fontWeight: '600' }}>#{idx+1} {c.nome}</span>
                          </td>
                          <td style={{ ...s.td, textAlign: 'center', background: bgGradient, fontWeight: 'bold' }}>{c.osCount}</td>
                          <td style={{ ...s.td, textAlign: 'center', color: slaColor, fontWeight: 'bold' }}>
                            {c.avgSla ? `${c.avgSla}h` : '--'}
                          </td>
                          <td style={{ ...s.td, textAlign: 'center', fontWeight: 'bold', color: c.avgCsat && c.avgCsat <= 3.0 ? 'var(--critical)' : 'var(--success)' }} title={!c.csatLinked ? 'Este cliente não tem contato de WhatsApp vinculado — CSAT indisponível' : c.avgCsat ? `${c.csatSampleSize} avaliação(ões)` : undefined}>
                            {c.avgCsat ? `★ ${c.avgCsat} (${c.csatSampleSize})` : c.csatLinked ? '--' : 'sem vínculo'}
                          </td>
                        </tr>
                      );
                    })}
                    {benchmarkData.clientes.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)' }}>Nenhum dado de cliente para comparar.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Atendentes */}
            <div style={s.chartSection}>
              <div style={s.sectionHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={20} color="var(--accent)" />
                  <h2 style={s.sectionTitle}>Performance de Atendentes</h2>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Atendente</th>
                      <th style={{ ...s.th, textAlign: 'center' }}>O.S. Feitas</th>
                      <th style={{ ...s.th, textAlign: 'center' }}>SLA Médio (h)</th>
                      <th style={{ ...s.th, textAlign: 'center' }}>CSAT Médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarkData.atendentes.map((a, idx) => {
                      const maxOS = benchmarkData.atendentes[0]?.osCount || 1;
                      const pct = Math.min((a.osCount / maxOS) * 100, 100);
                      const bgGradient = `linear-gradient(to right, var(--accent-light) ${pct}%, transparent ${pct}%)`;
                      let slaColor = 'var(--text-main)';
                      if (a.avgSla) {
                        if (a.avgSla <= 24) slaColor = 'var(--success)';
                        else if (a.avgSla <= 72) slaColor = 'var(--warning)';
                        else slaColor = 'var(--critical)';
                      }
                      let medal = '';
                      if (idx === 0) medal = '🥇 ';
                      else if (idx === 1) medal = '🥈 ';
                      else if (idx === 2) medal = '🥉 ';
                      return (
                        <tr key={a.id} style={s.tr}>
                          <td style={s.tdClientName} title={a.nome}>
                            <span style={{ fontWeight: '600' }}>{medal}{a.nome}</span>
                          </td>
                          <td style={{ ...s.td, textAlign: 'center', background: bgGradient, fontWeight: 'bold' }}>{a.osCount}</td>
                          <td style={{ ...s.td, textAlign: 'center', color: slaColor, fontWeight: 'bold' }}>{a.avgSla ? `${a.avgSla}h` : '--'}</td>
                          <td style={{ ...s.td, textAlign: 'center', fontWeight: 'bold', color: a.avgCsat && a.avgCsat <= 3.0 ? 'var(--critical)' : 'var(--success)' }} title={!a.matched ? 'Nome do técnico no Firebird não bateu com nenhum usuário do sistema — CSAT indisponível' : a.avgCsat ? `${a.csatSampleSize} avaliação(ões)` : undefined}>
                            {a.avgCsat ? `★ ${a.avgCsat} (${a.csatSampleSize})` : a.matched ? '--' : 'sem vínculo'}
                          </td>
                        </tr>
                      );
                    })}
                    {benchmarkData.atendentes.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ ...s.td, textAlign: 'center', color: 'var(--text-dim)' }}>Nenhum atendente ativo registrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {benchmarkData.note && (
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-dim)', textAlign: 'right' }}>ℹ️ {benchmarkData.note}</p>
          )}
          </div>
        )
      )}

      {/* ABA 3: DETETIVE IA */}
      {activeTab === 'detetive' && (
        loadingDetective ? (
          <div style={s.loadingBox}><div style={s.spinner} /> Detetive analisando histórico...</div>
        ) : !detectiveData ? (
          <div style={s.errorBox}>Erro ao carregar Detetive IA.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Quadro comparativo */}
            <div style={s.detectiveGrid}>
              <div style={s.detectiveCard}>
                <h3 style={s.detectiveCardTitle}>Novos Chamados</h3>
                <div style={s.detectiveCardValue}>
                  {detectiveData.stats.atual.tickets}
                  <span style={{ 
                    ...s.diffBadge, 
                    color: detectiveData.stats.atual.tickets >= detectiveData.stats.anterior.tickets ? 'var(--critical)' : 'var(--success)'
                  }}>
                    {detectiveData.stats.atual.tickets >= detectiveData.stats.anterior.tickets ? '▲' : '▼'} vs {detectiveData.stats.anterior.tickets}
                  </span>
                </div>
              </div>
              <div style={s.detectiveCard} title="Registros internos do sistema — não é o mesmo total do Firebird usado em Risco de Receita & SLA ou Benchmark">
                <h3 style={s.detectiveCardTitle}>O.S. (sistema interno)</h3>
                <div style={s.detectiveCardValue}>
                  {detectiveData.stats.atual.os}
                  <span style={{ 
                    ...s.diffBadge, 
                    color: detectiveData.stats.atual.os >= detectiveData.stats.anterior.os ? 'var(--accent)' : 'var(--text-muted)'
                  }}>
                    vs {detectiveData.stats.anterior.os}
                  </span>
                </div>
              </div>
              <div style={s.detectiveCard}>
                <h3 style={s.detectiveCardTitle}>Chamados Fora do SLA</h3>
                <div style={s.detectiveCardValue}>
                  {detectiveData.stats.atual.overdue}
                  <span style={{ 
                    ...s.diffBadge, 
                    color: detectiveData.stats.atual.overdue > detectiveData.stats.anterior.overdue ? 'var(--critical)' : 'var(--success)'
                  }}>
                    {detectiveData.stats.atual.overdue > detectiveData.stats.anterior.overdue ? '▲' : '▼'} vs {detectiveData.stats.anterior.overdue}
                  </span>
                </div>
              </div>
              <div style={s.detectiveCard}>
                <h3 style={s.detectiveCardTitle}>CSAT Médio</h3>
                <div style={s.detectiveCardValue}>
                  ★ {detectiveData.stats.atual.csat}
                  <span style={{ 
                    ...s.diffBadge, 
                    color: detectiveData.stats.atual.csat >= detectiveData.stats.anterior.csat ? 'var(--success)' : 'var(--critical)'
                  }}>
                    vs ★ {detectiveData.stats.anterior.csat}
                  </span>
                </div>
              </div>
            </div>

            {/* Diagnóstico da IA */}
            <div style={{ ...s.chartSection, background: 'rgba(139,92,246,0.03)', borderColor: 'rgba(139,92,246,0.15)' }}>
              <div style={s.sectionHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Search size={22} color="var(--accent)" />
                  <h2 style={{ ...s.sectionTitle, color: 'var(--accent)' }}>Diagnóstico do Detetive IA</h2>
                </div>
              </div>
              <div style={s.diagnosisContent}>
                {renderMarkdown(detectiveData.diagnosis)}
              </div>
            </div>
            {detectiveData.dataSourceNote && (
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-dim)' }}>ℹ️ {detectiveData.dataSourceNote}</p>
            )}
          </div>
        )
      )}

      {/* ABA 4: AUDITORIA IA */}
      {activeTab === 'auditoria' && (
        loadingAudit ? (
          <div style={s.loadingBox}><div style={s.spinner} /> Carregando atendimentos para auditoria...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {auditSummary && auditSummary.totalResolvedCount > 0 && (
              <div style={s.kpiGrid}>
                <div style={s.kpiCard}>
                  <div style={{ ...s.kpiIcon, color: 'var(--accent)' }}><Award size={22} /></div>
                  <div style={s.kpiContent}>
                    <span style={s.kpiLabel}>Cobertura de Auditoria</span>
                    <span style={s.kpiValue}>{auditSummary.totalAuditedCount} de {auditSummary.totalResolvedCount}</span>
                    <span style={s.kpiHint}>Atendimentos resolvidos já auditados pela IA (lista mostra os 50 mais recentes)</span>
                  </div>
                </div>
                <div style={s.kpiCard}>
                  <div style={{ ...s.kpiIcon, color: auditSummary.avgAuditScore == null ? 'var(--text-dim)' : auditSummary.avgAuditScore >= 80 ? 'var(--success)' : auditSummary.avgAuditScore >= 50 ? 'var(--warning)' : 'var(--critical)' }}><ShieldAlert size={22} /></div>
                  <div style={s.kpiContent}>
                    <span style={s.kpiLabel}>Nota Média de Conformidade</span>
                    <span style={s.kpiValue}>{auditSummary.avgAuditScore != null ? auditSummary.avgAuditScore : '--'}</span>
                    <span style={s.kpiHint}>Média entre todos os atendimentos já auditados</span>
                  </div>
                </div>
                <div style={s.kpiCard}>
                  <div style={{ ...s.kpiIcon, color: 'var(--critical)' }}><AlertTriangle size={22} /></div>
                  <div style={s.kpiContent}>
                    <span style={s.kpiLabel}>Notas Baixas (&lt; 60)</span>
                    <span style={s.kpiValue}>{auditSummary.scoreDistribution.baixo}</span>
                    <span style={s.kpiHint}>de {auditSummary.totalAuditedCount} atendimentos auditados</span>
                  </div>
                </div>
              </div>
            )}
          <div style={s.auditGrid}>
            {/* Lista de Atendimentos */}
            <div style={s.chartSection}>
              <div style={s.sectionHeader}>
                <h2 style={s.sectionTitle}>Atendimentos Finalizados Recentes</h2>
              </div>
              {auditList.length > 0 && (
                <div style={s.auditSearchBox}>
                  <Search size={15} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <input
                    style={s.auditSearchInput}
                    placeholder="Buscar por cliente ou atendente..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                  />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxHeight: '450px', overflowY: 'auto' }}>
                {filteredAuditList.map((ticket) => {
                  const isSelected = selectedTicket?.id === ticket.id;
                  return (
                    <div
                      key={ticket.id}
                      style={{
                        ...s.auditRow,
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border-color)',
                        background: isSelected ? 'var(--accent-light)' : 'var(--bg-base)'
                      }}
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <strong style={s.auditRowName} title={ticket.contactName}>{ticket.contactName}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Atendente: {ticket.agentName}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Finalizado em: {new Date(ticket.resolvedAt).toLocaleDateString('pt-BR')}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                        {ticket.rating && (
                          <span style={s.csatBadge}>★ {ticket.rating}</span>
                        )}
                        {ticket.auditScore !== null ? (
                          <span style={{ ...s.scoreBadge, background: ticket.auditScore >= 80 ? 'rgba(16,185,129,0.1)' : ticket.auditScore >= 50 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: ticket.auditScore >= 80 ? 'var(--success)' : ticket.auditScore >= 50 ? 'var(--warning)' : 'var(--critical)' }}>
                            Nota: {ticket.auditScore}
                          </span>
                        ) : (
                          <span style={s.pendingAuditBadge}>Não Auditado</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filteredAuditList.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', padding: '2rem 0' }}>
                    {auditSearch
                      ? 'Nenhum atendimento encontrado para essa busca.'
                      : 'Nenhum atendimento resolvido recente encontrado para auditoria.'}
                  </p>
                )}
              </div>
            </div>

            {/* Painel de Auditoria Detalhado */}
            <div style={s.chartSection}>
              {selectedTicket ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%' }}>
                  <div style={s.auditDetailHeader}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', marginBottom: '12px', gap: '1rem' }}>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text-main)', overflowWrap: 'break-word' }} title={selectedTicket.contactName}>{selectedTicket.contactName}</h3>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>ID: {selectedTicket.id}</span>
                      </div>

                      <button
                        style={{ ...s.auditBtn, flexShrink: 0 }}
                        disabled={auditingTicketId !== null}
                        onClick={() => handleAudit(selectedTicket.id)}
                      >
                        {auditingTicketId === selectedTicket.id ? (
                          <><RotateCw size={14} className="animate-spin" /> Analisando...</>
                        ) : (
                          <><Play size={14} /> Auditar com IA</>
                        )}
                      </button>
                    </div>

                    <div style={s.metadataGrid}>
                      <div style={s.metadataItem}>
                        <span style={s.metadataLabel}>Atendente</span>
                        <span style={s.metadataValue}>{selectedTicket.agentName}</span>
                      </div>
                      <div style={s.metadataItem}>
                        <span style={s.metadataLabel}>Iniciado em</span>
                        <span style={s.metadataValue}>
                          {new Date(selectedTicket.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                      <div style={s.metadataItem}>
                        <span style={s.metadataLabel}>Finalizado em</span>
                        <span style={s.metadataValue}>
                          {new Date(selectedTicket.resolvedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                      <div style={s.metadataItem}>
                        <span style={s.metadataLabel}>CSAT Cliente</span>
                        <span style={{ 
                          ...s.metadataValue, 
                          color: selectedTicket.rating ? 'var(--success)' : 'var(--text-dim)',
                          fontWeight: selectedTicket.rating ? 'bold' : 'normal'
                        }}>
                          {selectedTicket.rating ? `★ ${selectedTicket.rating}/5` : 'Não avaliado'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedTicket.auditScore !== null ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '380px', paddingRight: '4px' }}>
                      {/* Score card */}
                      <div style={s.auditScorePanel}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{
                            ...s.scoreCircle,
                            borderColor: selectedTicket.auditScore >= 80 ? 'var(--success)' : selectedTicket.auditScore >= 50 ? 'var(--warning)' : 'var(--critical)'
                          }}>
                            {selectedTicket.auditScore}
                          </div>
                          <div>
                            <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)', display: 'block' }}>Avaliação de Conformidade</strong>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Auditoria executada em: {new Date(selectedTicket.auditedAt).toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>

                      {/* Relatório Markdown */}
                      <div style={s.reportBox}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--accent)' }}>
                          <Award size={16} />
                          <strong style={{ fontSize: '0.85rem', fontWeight: 600 }}>Parecer da auditoria</strong>
                        </div>
                        {renderMarkdown(selectedTicket.auditResult)}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '12px', textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                      <ShieldAlert size={40} color="var(--text-dim)" />
                      <div>
                        <strong style={{ display: 'block', fontSize: '0.88rem', color: 'var(--text-muted)' }}>Atendimento Sem Auditoria</strong>
                        <span style={{ fontSize: '0.78rem' }}>Clique em "Auditar com IA" no topo para analisar a conduta deste atendimento.</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '8px', color: 'var(--text-dim)', textAlign: 'center', minHeight: '300px' }}>
                  <Users size={32} />
                  <span style={{ fontSize: '0.82rem' }}>Selecione um chamado na lista ao lado para inspecionar e auditar.</span>
                </div>
              )}
            </div>
          </div>
          </div>
        )
      )}

      {/* MODAL DE DRILLDOWN */}
      {showDrilldownModal && (
        <div style={s.modalOverlay} onClick={() => setShowDrilldownModal(false)}>
          <div style={s.modalContent} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-main)', fontWeight: 800 }}>{drilldownTitle}</h2>
              <button style={s.modalCloseBtn} onClick={() => setShowDrilldownModal(false)}>✕</button>
            </div>
            
            <div style={s.modalBody}>
              {drilldownLoading ? (
                <div style={s.loadingBox}><div style={s.spinner} /> Buscando detalhamento direto do banco ILUX WEB...</div>
              ) : drilldownData.length === 0 ? (
                <p style={s.emptyHint}>Nenhum registro encontrado para esta métrica no momento.</p>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: '500px' }}>
                  <table style={s.table}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)' }}>
                      <tr>
                        <th style={s.th}>Cliente / Contato</th>
                        <th style={s.th}>Registro Origem</th>
                        <th style={s.th}>Ação Recomendada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drilldownData.map((item, i) => {
                        const nomeCliente = item.clientName || 'Cliente Avulso';
                        const fone = item.clientPhone || '';
                        
                        return (
                        <tr key={i} style={s.tr}>
                          <td style={s.tdClientName} title={nomeCliente}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>{nomeCliente}</span>
                              {fone && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{fone}</span>}
                              {item.technician && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Técnico: {item.technician}</span>}
                            </div>
                          </td>
                          <td style={s.td}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              {item.externalId ? <span>O.S. #{item.externalId}</span> : <span>N/A</span>}
                              {item.osType && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{item.osType}</span>}
                              {item.equipmentModel && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{item.equipmentModel}</span>}
                              {item.count && <span style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>{item.count} chamados</span>}
                              {item.rating != null && <span style={{ fontSize: '0.7rem', color: 'var(--critical)' }}>★ {item.rating}/5</span>}
                            </div>
                          </td>
                          <td style={s.td}>
                            {item.externalId && !item.rating && (
                              <button 
                                style={{ ...s.actionBtn, background: 'var(--accent)' }} 
                                onClick={() => {
                                  window.open(`${BACKEND_URL}/api/os/${encodeURIComponent(item.externalId)}/pdf?token=${localStorage.getItem('token')}`, '_blank');
                                }}
                              >
                                Ver O.S.
                              </button>
                            )}
                            {fone && (
                              <button
                                style={{ ...s.actionBtn, background: 'var(--success)', marginLeft: '6px' }}
                                onClick={() => {
                                  const num = fone.replace(/\D/g, '');
                                  const text = encodeURIComponent(`Olá, tudo bem? Referente à O.S. ${item.externalId || ''}, gostaríamos de verificar como podemos ajudá-lo.`);
                                  window.open(`https://wa.me/${num}?text=${text}`, '_blank');
                                }}
                              >
                                WhatsApp
                              </button>
                            )}
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  container: { padding: '2rem', background: 'var(--bg-base)', flex: 1, overflowY: 'auto', color: 'var(--text-main)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' },
  headerInfo: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  kickerGroup: { display: 'flex', alignItems: 'center', gap: '8px' },
  kicker: { fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 500, letterSpacing: 0 },
  intelligenceBadge: { fontFamily: 'var(--font-mono)', background: 'var(--accent-light)', color: 'var(--accent-strong, var(--accent))', fontSize: '0.66rem', fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-xs)' },
  title: { fontSize: '1.7rem', fontWeight: 600, margin: '4px 0 0 0', letterSpacing: '-0.02em' },
  subtitle: { color: 'var(--text-muted)', fontSize: '0.88rem' },
  statusBadge: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', padding: '0.5rem 0.9rem', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' },
  dot: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--success)', flexShrink: 0 },
  syncBanner: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.65rem', padding: '0.55rem 0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--success-border)', background: 'var(--success-light)', color: 'var(--text-muted)', fontSize: '0.75rem' },
  syncBannerStale: { borderColor: 'var(--warning-border)', background: 'var(--warning-light)' },
  syncError: { color: 'var(--warning)', fontWeight: 600, cursor: 'help', flexShrink: 0 },
  sourceBanner: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem 1rem', marginBottom: '0.75rem', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)', background: 'var(--accent-light)', color: 'var(--text-muted)', fontSize: '0.7rem' },
  sourceMeta: { marginLeft: 'auto', textAlign: 'right' },

  tabs: { display: 'flex', gap: '0.9rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1rem', overflowX: 'auto', scrollbarWidth: 'none' },
  tabPurpose: { display: 'none' },
  tab: { padding: '0.75rem 0.9rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.86rem', color: 'var(--text-muted)', borderBottom: '2px solid transparent', transition: 'all 0.2s', fontWeight: 600, whiteSpace: 'nowrap' },
  tabActive: { color: 'var(--text-main)', borderBottom: '2px solid var(--accent)', fontWeight: 600 },
  periodBtn: { padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  periodBtnActive: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--text-inverse)' },

  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' },
  riskCard: { background: 'var(--critical-light)', border: '1px solid var(--critical-border)', borderRadius: 'var(--radius-sm)', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
  riskCardHeader: { display: 'flex', alignItems: 'center', gap: '8px' },
  pulseAlert: {},
  riskLabel: { fontFamily: 'var(--font-mono)', color: 'var(--critical)', fontSize: 'var(--text-xs)', fontWeight: 500, letterSpacing: 0 },
  riskValue: { fontFamily: 'var(--font-mono)', fontSize: '1.9rem', fontWeight: 600, color: 'var(--text-main)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' },
  riskHint: { color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0, lineHeight: 1.4 },

  kpiCard: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', minWidth: 0 },
  kpiIcon: { background: 'var(--bg-base)', padding: '0.6rem', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--accent)' },
  kpiContent: { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0, width: '100%' },
  kpiLabel: { fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.72rem', fontWeight: 500, letterSpacing: 0 },
  kpiValue: { fontFamily: 'var(--font-mono)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums' },
  kpiHint: { color: 'var(--text-dim)', fontSize: '0.72rem' },
  inlineSource: { display: 'block', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontSize: '0.64rem', fontWeight: 500, marginTop: '2px' },

  mainGrid: { display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' },
  chartSection: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem', minWidth: 0 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: '0.95rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' },
  badge: { background: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 500, padding: '3px 8px', borderRadius: 'var(--radius-pill)' },

  causesList: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  causeRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0.95rem', borderRadius: 'var(--radius-sm)', background: 'var(--bg-base)', border: '1px solid var(--border-color)', gap: '1rem' },
  causeInfo: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
  priorityDot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  causeText: { fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-main)' },
  causeStats: { textAlign: 'right', flexShrink: 0 },
  causeCount: { fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', fontVariantNumeric: 'tabular-nums' },
  causeSub: { fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--text-dim)', letterSpacing: 0 },
  emptyHint: { color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0, textAlign: 'center', padding: '0.5rem 0' },

  miniFunnelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums' },

  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th: { padding: '10px', borderBottom: '1px solid var(--border-color)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: '0.72rem', letterSpacing: 0, textAlign: 'left' },
  tr: { borderBottom: '1px solid var(--border-color)', hover: { background: 'var(--bg-base)' } },
  td: { padding: '12px 10px', color: 'var(--text-main)', fontSize: '0.82rem', fontVariantNumeric: 'tabular-nums' },
  tdClientName: { padding: '12px 10px', color: 'var(--text-main)', fontSize: '0.82rem', fontWeight: 600, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  detectiveGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' },
  detectiveCard: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '8px' },
  detectiveCardTitle: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-dim)', letterSpacing: 0 },
  detectiveCardValue: { fontFamily: 'var(--font-mono)', fontSize: '1.35rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontVariantNumeric: 'tabular-nums' },
  diffBadge: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 500, marginLeft: '8px' },
  diagnosisContent: { fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 },

  auditGrid: { display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: '1.25rem' },
  auditRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s ease', gap: '0.75rem' },
  auditRowName: { fontSize: '0.85rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  auditSearchBox: { display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0 0.75rem' },
  auditSearchInput: { flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)', fontSize: '0.82rem', padding: '0.55rem 0' },
  csatBadge: { fontFamily: 'var(--font-mono)', background: 'var(--success-light)', color: 'var(--success-text)', fontSize: '0.7rem', fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-xs)', fontVariantNumeric: 'tabular-nums' },
  scoreBadge: { fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 500, padding: '2px 6px', borderRadius: 'var(--radius-xs)', fontVariantNumeric: 'tabular-nums' },
  pendingAuditBadge: { fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', border: '1px solid var(--border-color)', color: 'var(--text-dim)', fontSize: '0.68rem', padding: '2px 6px', borderRadius: 'var(--radius-xs)' },
  auditBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', padding: '0.45rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s' },
  auditScorePanel: { padding: '1rem', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' },
  scoreCircle: { width: '48px', height: '48px', borderRadius: '50%', border: '3px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  reportBox: { background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '1.25rem' },

  auditDetailHeader: {
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '16px',
    marginBottom: '12px'
  },
  metadataGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    marginTop: '12px',
    background: 'var(--bg-base)',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)'
  },
  metadataItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0
  },
  metadataLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.68rem',
    fontWeight: 500,
    color: 'var(--text-dim)',
    letterSpacing: 0
  },
  metadataValue: {
    fontSize: '0.8rem',
    fontWeight: 500,
    color: 'var(--text-main)',
    fontVariantNumeric: 'tabular-nums'
  },

  loadingBox: { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: 'var(--text-muted)', fontSize: '0.85rem' },
  spinner: { width: '28px', height: '28px', borderRadius: '50%', border: '3px solid var(--border-color)', borderTopColor: 'var(--accent)', animation: 'spin-sk 1s infinite linear' },
  errorBox: { padding: '2rem', background: 'var(--critical-light)', border: '1px solid var(--critical-border)', borderRadius: 'var(--radius-sm)', color: 'var(--critical)', fontSize: '0.85rem', textAlign: 'center' },

  // Drilldown Modal
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modalContent: { background: 'var(--bg-surface)', width: '90%', maxWidth: '750px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '85vh' },
  modalHeader: { padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalCloseBtn: { background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '1rem', cursor: 'pointer', padding: '0.4rem', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: '0', overflowY: 'auto' },
  actionBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', color: 'var(--text-inverse)', padding: '0.45rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s', whiteSpace: 'nowrap' }
};

// Adiciona estilos globais para as animações
if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    @keyframes spin-sk {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes pulse-alert {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.8; }
    }
    .animate-spin {
      animation: spin-sk 1s infinite linear;
    }
  `;
  document.head.appendChild(styleEl);
}
