import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Database,
  Link2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wifi,
  XCircle,
} from 'lucide-react';
import {
  createPrintGuardPairing,
  disconnectPrintGuard,
  getPrintGuardMetrics,
  getPrintGuardStatus,
  syncPrintGuardEvents,
  testPrintGuardConnection,
} from '../services/api';
import ActionButton from '../components/ui/ActionButton';

const EMPTY_CONNECTION = { status: 'disconnected', baseUrl: '', organization: '', lastSync: null, mapping: null };

function unwrap(data) {
  if (!data || typeof data !== 'object') return {};
  return data.data && typeof data.data === 'object' ? data.data : data;
}

function statusValue(connection) {
  const value = String(connection?.status || connection?.state || '').toLowerCase();
  if (['connected', 'online', 'active', 'paired', 'ready'].includes(value)) return 'connected';
  if (['pending', 'pairing', 'connecting', 'processing'].includes(value)) return 'pending';
  return 'disconnected';
}

function statusLabel(value) {
  return value === 'connected' ? 'Conectado' : value === 'pending' ? 'Aguardando pareamento' : 'Desconectado';
}

function dateLabel(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}

function numberLabel(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

function normalizeMapping(value) {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? { source: item, target: '—', status: 'mapped' } : item));
  if (value && typeof value === 'object') return Object.entries(value).map(([source, target]) => ({ source, target: typeof target === 'object' ? target.target || target.name || '—' : target, status: typeof target === 'object' ? target.status : 'mapped' }));
  return [];
}

export default function PrintGuardSettings() {
  const [connection, setConnection] = useState(EMPTY_CONNECTION);
  const [metrics, setMetrics] = useState({ devices: 0, readings24h: 0, alerts: 0, errors24h: 0 });
  const [mapping, setMapping] = useState([]);
  const [pairingCode, setPairingCode] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusResult, metricsResult] = await Promise.allSettled([
        getPrintGuardStatus(),
        getPrintGuardMetrics(),
      ]);
      if (statusResult.status !== 'fulfilled') throw statusResult.reason;
      const payload = unwrap(statusResult.value?.data);
      const nextConnection = payload.connection || payload;
      setConnection({
        ...EMPTY_CONNECTION,
        ...nextConnection,
        status: statusValue(nextConnection),
        baseUrl: nextConnection.baseUrl || nextConnection.url || '',
        organization: nextConnection.organization?.name || nextConnection.organization || nextConnection.companyName || '',
        lastSync: nextConnection.lastSync || nextConnection.lastSyncAt || nextConnection.lastConnectedAt || nextConnection.lastTestAt || nextConnection.syncedAt || null,
      });
      setBaseUrl(nextConnection.baseUrl || nextConnection.url || '');
      setMapping(normalizeMapping(payload.mappingSummary || payload.mapping || nextConnection.mapping));
      if (metricsResult.status === 'fulfilled') {
        const metricsPayload = unwrap(metricsResult.value?.data);
        // Use the functional updater so a refresh cannot overwrite values
        // from a concurrent request with a stale closure.
        setMetrics((current) => ({ ...current, ...metricsPayload.metrics, ...metricsPayload }));
      } else if (payload.metrics) {
        setMetrics((current) => ({ ...current, ...payload.metrics }));
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Não foi possível consultar o PrintGuard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handlePairing() {
    const code = pairingCode.trim();
    if (!code) {
      setError('Informe o código temporário gerado no PrintGuard.');
      return;
    }
    setWorking('pair');
    setError('');
    setNotice('');
    try {
      await createPrintGuardPairing({ code, baseUrl: baseUrl.trim() || undefined });
      setPairingCode('');
      setNotice('PrintGuard vinculado com sucesso. A sincronização já pode ser testada.');
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError.message || 'Não foi possível concluir o pareamento. Confira o código e tente novamente.');
    } finally {
      setWorking('');
    }
  }

  async function handleTest() {
    setWorking('test');
    setError('');
    setNotice('');
    try {
      const { data } = await testPrintGuardConnection();
      const payload = unwrap(data);
      setNotice(payload.message || 'Conexão testada com sucesso.');
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'O teste de conexão falhou.');
    } finally {
      setWorking('');
    }
  }

  async function handleSync() {
    setWorking('sync');
    setError('');
    setNotice('');
    try {
      const { data } = await syncPrintGuardEvents();
      const payload = unwrap(data);
      const processed = Number(payload.processed || 0);
      const reconciled = Number(payload.reconciled || 0);
      const pages = Number(payload.pages || 0);
      setNotice(processed > 0 || reconciled > 0
        ? `Sincronização concluída: ${processed.toLocaleString('pt-BR')} novo(s) evento(s) e ${reconciled.toLocaleString('pt-BR')} vínculo(s) corrigido(s) em ${pages.toLocaleString('pt-BR')} página(s).`
        : 'Sincronização concluída. Não havia novos eventos pendentes no PrintGuard.');
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Não foi possível sincronizar os eventos do PrintGuard.');
    } finally {
      setWorking('');
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Desativar a conexão PrintGuard? A coleta ficará pausada até um novo pareamento.')) return;
    setWorking('disconnect');
    setError('');
    setNotice('');
    try {
      await disconnectPrintGuard();
      setPairingCode('');
      setNotice('Conexão PrintGuard desativada.');
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.error || 'Não foi possível desativar a conexão.');
    } finally {
      setWorking('');
    }
  }

  const status = statusValue(connection);
  const statusIcon = status === 'connected' ? <CheckCircle2 size={19} /> : status === 'pending' ? <Clock3 size={19} /> : <XCircle size={19} />;
  const statusTone = status === 'connected' ? 'success' : status === 'pending' ? 'warning' : 'muted';
  const hasMapping = mapping.length > 0;

  return (
    <div className="printguard-page" style={styles.page}>
      <style>{responsiveCss}</style>
      <div style={styles.header}>
        <div>
          <p style={styles.kicker}>Integrações</p>
          <h2 style={styles.title}>PrintGuard</h2>
          <p style={styles.subtitle}>Conecte a coleta de impressoras e acompanhe a saúde da operação em um único lugar.</p>
        </div>
        <ActionButton variant="secondary" onClick={load} loading={loading}><RefreshCw size={16} /> Atualizar</ActionButton>
      </div>

      {error ? <div style={styles.alertError} role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={load} style={styles.alertButton}>Tentar novamente</button></div> : null}
      {notice ? <div style={styles.alertSuccess} role="status"><Check size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} style={styles.alertClose} aria-label="Fechar aviso"><XCircle size={16} /></button></div> : null}

      <section style={styles.connectionGrid} className="printguard-connection-grid" aria-label="Conexão PrintGuard">
        <div style={styles.card}>
          <div style={styles.cardHeading}><div><h3 style={styles.cardTitle}><Link2 size={18} /> Pareamento</h3><p style={styles.cardSubtitle}>Cole o código temporário gerado no painel do PrintGuard para vincular esta empresa.</p></div><span style={{ ...styles.statusPill, ...styles[`${statusTone}Pill`] }}>{statusIcon}{statusLabel(status)}</span></div>
          <label style={styles.field}><span>URL da API PrintGuard</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://printguard.suaempresa.com" /></label>
          <div style={styles.pairingRow} className="printguard-pairing-row">
            <label style={styles.field}><span>Código gerado no PrintGuard</span><input value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="Ex.: mta_..." autoComplete="off" spellCheck={false} /></label>
            <div style={styles.actionStack} className="printguard-action-stack"><ActionButton onClick={handlePairing} loading={working === 'pair'} disabled={!pairingCode.trim()}><PlugZap size={16} /> Conectar PrintGuard</ActionButton></div>
          </div>
          <div style={styles.help}><ShieldCheck size={16} /><span>O código é gerado no PrintGuard, expira em 15 minutos e só pode ser usado uma vez. Tokens e segredos permanecem protegidos nos servidores.</span></div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardHeading}><div><h3 style={styles.cardTitle}><Wifi size={18} /> Estado da integração</h3><p style={styles.cardSubtitle}>Último sinal recebido e organização vinculada.</p></div><span style={{ ...styles.statusDot, ...(status === 'connected' ? styles.statusDotOn : {}) }} /></div>
          {loading && !connection.organization ? <div style={styles.loading}><RefreshCw size={17} className="spin" /> Consultando integração…</div> : <div style={styles.connectionDetails}><Detail label="Organização" value={connection.organization || 'Não vinculada'} /><Detail label="Última comunicação" value={dateLabel(connection.lastSync)} /><Detail label="Endpoint" value={connection.baseUrl || 'Não informado'} /></div>}
          <div style={styles.connectionActions}>
            <ActionButton variant="secondary" onClick={handleTest} loading={working === 'test'} disabled={status === 'disconnected' || Boolean(working)}><Activity size={16} /> Testar conexão</ActionButton>
            <ActionButton onClick={handleSync} loading={working === 'sync'} disabled={status === 'disconnected' || Boolean(working)}><RefreshCw size={16} /> Sincronizar agora</ActionButton>
            <button type="button" style={styles.dangerButton} onClick={handleDisconnect} disabled={Boolean(working) || status === 'disconnected'}>{working === 'disconnect' ? <RefreshCw size={15} className="spin" /> : <Unplug size={15} />} Desativar</button>
          </div>
        </div>
      </section>

      <section style={styles.metricGrid} className="printguard-metric-grid" aria-label="Métricas PrintGuard">
        <Metric icon={<Database size={18} />} label="Equipamentos monitorados" value={metrics.devices ?? metrics.equipment ?? 0} />
        <Metric icon={<Activity size={18} />} label="Leituras nas últimas 24h" value={metrics.readings24h ?? metrics.readings ?? 0} />
        <Metric icon={<AlertCircle size={18} />} label="Alertas ativos" value={metrics.alerts ?? metrics.activeAlerts ?? 0} tone="warning" />
        <Metric icon={<XCircle size={18} />} label="Falhas nas últimas 24h" value={metrics.errors24h ?? metrics.errors ?? 0} tone="danger" />
      </section>

      <section style={styles.card} aria-labelledby="mapping-title">
        <div style={styles.cardHeading}><div><h3 id="mapping-title" style={styles.cardTitle}><Clipboard size={18} /> Prévia do mapeamento</h3><p style={styles.cardSubtitle}>Campos que serão sincronizados entre o PrintGuard e o CRM, sem expor credenciais.</p></div><span style={styles.previewBadge}>{hasMapping ? `${mapping.length} campos` : 'Aguardando vínculo'}</span></div>
        {!hasMapping ? <div style={styles.empty}><Database size={27} /><strong>Nenhum mapeamento disponível</strong><span>Conclua o pareamento para visualizar os campos e o status da última sincronização.</span></div> : <div style={styles.mappingTableWrap} className="printguard-table-wrap"><table style={styles.table}><thead><tr><th style={styles.th}>Origem PrintGuard</th><th style={styles.th}>Destino no CRM</th><th style={styles.th}>Estado</th></tr></thead><tbody>{mapping.map((item, index) => <tr key={`${item.source || index}-${item.target || ''}`}><td style={styles.td}>{item.source || item.from || '—'}</td><td style={styles.td}>{item.target || item.to || '—'}</td><td style={styles.td}><span style={styles.mappingStatus}><CheckCircle2 size={14} /> {String(item.status || 'mapped').toLowerCase() === 'mapped' ? 'Mapeado' : item.status}</span></td></tr>)}</tbody></table></div>}
      </section>

      <div style={styles.footerNote}><ShieldCheck size={15} /> A integração é isolada por organização. O PrintGuard envia apenas leituras operacionais previstas no contrato.</div>
    </div>
  );
}

function Detail({ label, value }) { return <div style={styles.detail}><span>{label}</span><strong title={value}>{value}</strong></div>; }
function Metric({ icon, label, value, tone = 'default' }) { return <div style={styles.metric}><span style={{ ...styles.metricIcon, ...(styles[`${tone}Metric`] || {}) }}>{icon}</span><span style={styles.metricBody}><small>{label}</small><strong>{numberLabel(value)}</strong></span></div>; }

const responsiveCss = `
  .printguard-page input { min-height: 40px; width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0 .75rem; background: var(--bg-surface); color: var(--text-main); font: inherit; }
  .printguard-page input:focus-visible, .printguard-page button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .printguard-page .spin { animation: printguard-spin .8s linear infinite; }
  @keyframes printguard-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @media (max-width: 900px) { .printguard-connection-grid { grid-template-columns: 1fr !important; } .printguard-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
  @media (max-width: 620px) { .printguard-page { padding: 1rem !important; } .printguard-metric-grid { grid-template-columns: 1fr !important; } .printguard-pairing-row { grid-template-columns: 1fr !important; } .printguard-action-stack { flex-direction: row !important; } .printguard-page .printguard-table-wrap { overflow-x: auto; } .printguard-page table { min-width: 560px; } }
`;

const styles = {
  page: { minWidth: 0, padding: 'var(--space-8)', background: 'var(--bg-base)', color: 'var(--text-main)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-5)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' },
  kicker: { margin: '0 0 .45rem', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' },
  title: { margin: 0, color: 'var(--text-main)', fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 850 },
  subtitle: { margin: '.45rem 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-md)', lineHeight: 1.5 },
  alertError: { display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: 'var(--space-4)', padding: '.75rem 1rem', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-light)', color: 'var(--danger-text)' },
  alertSuccess: { display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: 'var(--space-4)', padding: '.75rem 1rem', border: '1px solid var(--success-border, var(--border-color))', borderRadius: 'var(--radius-md)', background: 'var(--success-light)', color: 'var(--success-text, var(--success))' },
  alertButton: { marginLeft: 'auto', border: '1px solid currentColor', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'inherit', padding: '.35rem .55rem', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 },
  alertClose: { marginLeft: 'auto', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center' },
  connectionGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' },
  card: { minWidth: 0, padding: 'var(--space-5)', marginBottom: 'var(--space-5)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow-xs)' },
  cardHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' },
  cardTitle: { display: 'flex', alignItems: 'center', gap: '.5rem', margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-lg)', fontWeight: 800 },
  cardSubtitle: { margin: '.4rem 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.45 },
  statusPill: { display: 'inline-flex', alignItems: 'center', gap: '.35rem', borderRadius: 999, padding: '.38rem .6rem', fontSize: 'var(--text-xs)', fontWeight: 800, whiteSpace: 'nowrap' },
  successPill: { color: 'var(--success-text, var(--success))', background: 'var(--success-light)' },
  warningPill: { color: 'var(--warning-text, var(--warning))', background: 'var(--warning-light)' },
  mutedPill: { color: 'var(--text-muted)', background: 'var(--bg-surface)' },
  field: { display: 'grid', gap: '.4rem', marginBottom: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800 },
  pairingRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-3)', alignItems: 'stretch' },
  codeBox: { display: 'grid', gap: '.25rem', alignContent: 'center', minWidth: 0, padding: '.75rem .9rem', border: '1px dashed var(--accent-border)', borderRadius: 'var(--radius-md)', background: 'var(--accent-light)' },
  codeLabel: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' },
  codeBoxStrong: {},
  actionStack: { display: 'flex', flexDirection: 'column', gap: '.5rem', justifyContent: 'center' },
  secondaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '.35rem', minHeight: 38, padding: '.45rem .65rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-main)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 },
  help: { display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: 'var(--space-4)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', lineHeight: 1.45 },
  statusDot: { width: 11, height: 11, flexShrink: 0, borderRadius: '50%', background: 'var(--text-dim)' },
  statusDotOn: { background: 'var(--success)', boxShadow: '0 0 0 4px var(--success-light)' },
  connectionDetails: { display: 'grid', gap: '.55rem', marginBottom: 'var(--space-5)' },
  detail: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', paddingBottom: '.55rem', borderBottom: '1px solid var(--border-color)', minWidth: 0 },
  detailSpan: {},
  detailStrong: {},
  connectionActions: { display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' },
  dangerButton: { display: 'inline-flex', alignItems: 'center', gap: '.35rem', minHeight: 38, padding: '.45rem .7rem', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--danger-text)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-xs)', fontWeight: 800 },
  loading: { minHeight: '8rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '.5rem', color: 'var(--text-muted)', fontWeight: 700 },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' },
  metric: { display: 'flex', alignItems: 'center', gap: '.7rem', minWidth: 0, padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)' },
  metricIcon: { display: 'grid', placeItems: 'center', width: 38, height: 38, flexShrink: 0, borderRadius: 'var(--radius-md)', color: 'var(--accent)', background: 'var(--accent-light)' },
  warningMetric: { color: 'var(--warning-text, var(--warning))', background: 'var(--warning-light)' },
  dangerMetric: { color: 'var(--danger-text, var(--danger))', background: 'var(--danger-light)' },
  metricBody: { display: 'grid', gap: '.2rem', minWidth: 0 },
  previewBadge: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800 },
  empty: { display: 'grid', placeItems: 'center', gap: '.5rem', minHeight: '9rem', padding: 'var(--space-5)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', textAlign: 'center' },
  mappingTableWrap: { overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '.7rem .8rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 800 },
  td: { padding: '.75rem .8rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  mappingStatus: { display: 'inline-flex', alignItems: 'center', gap: '.3rem', color: 'var(--success-text, var(--success))', fontSize: 'var(--text-xs)', fontWeight: 800 },
  footerNote: { display: 'flex', alignItems: 'center', gap: '.4rem', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
};
