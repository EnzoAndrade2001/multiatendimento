import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Mail, Phone, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { acceptPrivacyPolicy, anonymizePrivacySubject, exportPrivacySubject, getPrivacyPolicy, searchPrivacySubjects } from '../services/api';
import { toast } from '../utils/toast';
import { usePermissions } from '../auth/PermissionContext';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';


function formatDate(value) {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('pt-BR');
}

function safeWebUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export default function Privacy() {
  const { can } = usePermissions();
  const [policy, setPolicy] = useState(null);
  const [acceptance, setAcceptance] = useState(null);
  const [selectedScopes, setSelectedScopes] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadPolicy() {
    setLoading(true);
    setError('');
    try {
      const { data } = await getPrivacyPolicy();
      const nextPolicy = data?.policy || null;
      const nextAcceptance = data?.acceptance || null;
      setPolicy(nextPolicy);
      setAcceptance(nextAcceptance);
      setSelectedScopes(new Set(Array.isArray(nextAcceptance?.scopes) ? nextAcceptance.scopes : []));
    } catch (requestError) {
      setPolicy(null);
      setAcceptance(null);
      setError(requestError.response?.data?.error || 'Não foi possível carregar a política de privacidade.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPolicy();
  }, []);

  const purposes = Array.isArray(policy?.purposes) ? policy.purposes.filter((item) => item?.key) : [];
  const optionalPurposes = purposes.filter((purpose) => !purpose.required);
  const requiredScopes = purposes.filter((purpose) => purpose.required).map((purpose) => purpose.key);
  const currentAcceptance = Boolean(
    acceptance
    && !acceptance.needsReview
    && String(acceptance.policyVersion || '') === String(policy?.version || ''),
  );
  const acceptanceState = !acceptance
    ? { label: 'Escolhas não registradas', tone: 'neutral' }
    : currentAcceptance
      ? { label: 'Política atual registrada', tone: 'success' }
      : { label: 'Revisão necessária', tone: 'warning' };
  const channel = policy?.channel && typeof policy.channel === 'object' ? policy.channel : {};
  const channelUrl = safeWebUrl(channel.url);
  const hasChannel = Boolean(channel.email || channel.phone || channelUrl);

  const sortedPurposes = [...purposes].sort((left, right) => Number(right.required) - Number(left.required));

  function toggleScope(scope) {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function saveAcceptance() {
    if (!policy?.version) {
      toast.error('A política publicada não informa uma versão válida.');
      return;
    }

    const scopes = Array.from(new Set([
      ...requiredScopes,
      ...optionalPurposes.filter((purpose) => selectedScopes.has(purpose.key)).map((purpose) => purpose.key),
    ]));

    setSaving(true);
    try {
      const { data } = await acceptPrivacyPolicy({ policyVersion: policy.version, scopes });
      setAcceptance(data);
      setSelectedScopes(new Set(Array.isArray(data?.scopes) ? data.scopes : scopes));
      toast.success('Suas escolhas de privacidade foram registradas.');
    } catch (requestError) {
      toast.error(requestError.response?.data?.error || 'Não foi possível registrar suas escolhas.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={styles.centerState}>Carregando política de privacidade...</div>;
  }

  return (
    <main className="privacy-page" style={styles.page}>
      <style>{responsiveCss}</style>
      <PageHeader
        kicker="Privacidade e LGPD"
        title="Política e finalidades"
        subtitle="Consulte a política vigente, entenda cada finalidade e registre somente as escolhas que dependem do seu aceite."
        actions={(
          <ActionButton variant="secondary" onClick={loadPolicy}>
            <RefreshCw size={16} /> Atualizar
          </ActionButton>
        )}
      />

      {error ? (
        <section style={{ ...styles.notice, ...styles.errorNotice }} role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Política indisponível</strong>
            <p style={styles.noticeText}>{error}</p>
          </div>
          <ActionButton variant="secondary" size="sm" onClick={loadPolicy}>Tentar novamente</ActionButton>
        </section>
      ) : !policy ? (
        <section style={styles.notice}>
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <strong>Nenhuma política publicada</strong>
            <p style={styles.noticeText}>Esta empresa ainda não disponibilizou uma política de privacidade nesta área.</p>
          </div>
        </section>
      ) : (
        <div className="privacy-grid" style={styles.grid}>
          <div style={styles.mainColumn}>
            <section style={styles.card} aria-labelledby="privacy-policy-title">
              <div style={styles.cardHeader}>
                <div style={styles.iconBox}><ShieldCheck size={22} /></div>
                <div style={{ minWidth: 0 }}>
                  <h2 id="privacy-policy-title" style={styles.cardTitle}>{policy.title || 'Política de privacidade'}</h2>
                  <p style={styles.meta}>Versão {policy.version || 'não informada'} · Vigência: {formatDate(policy.effectiveAt)}</p>
                </div>
                <span style={{ ...styles.statusBadge, ...styles[`${acceptanceState.tone}Badge`] }}>
                  {acceptanceState.label}
                </span>
              </div>
              {policy.summary ? <p style={styles.summary}>{policy.summary}</p> : null}
              {acceptance?.acceptedAt ? (
                <p style={styles.lastRecord}>
                  Último registro: {formatDate(acceptance.acceptedAt)} · versão {acceptance.policyVersion || 'não informada'}
                </p>
              ) : null}
            </section>

            <section style={styles.card} aria-labelledby="privacy-purposes-title">
              <div style={styles.sectionHeading}>
                <div>
                  <h2 id="privacy-purposes-title" style={styles.cardTitle}>Finalidades do tratamento</h2>
                  <p style={styles.sectionSubtitle}>Finalidades necessárias são informativas. As demais ficam sob sua escolha e podem ser alteradas.</p>
                </div>
              </div>

              {sortedPurposes.length === 0 ? (
                <p style={styles.emptyText}>Nenhuma finalidade foi publicada para esta versão.</p>
              ) : (
                <div style={styles.purposeList}>
                  {sortedPurposes.map((purpose) => {
                    const isRequired = Boolean(purpose.required);
                    const checked = isRequired || selectedScopes.has(purpose.key);
                    return (
                      <label key={purpose.key} style={{ ...styles.purposeCard, cursor: isRequired ? 'default' : 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isRequired || saving}
                          onChange={() => toggleScope(purpose.key)}
                          style={styles.checkbox}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={styles.purposeTitleRow}>
                            <strong style={styles.purposeTitle}>{purpose.label || purpose.key}</strong>
                            <span style={isRequired ? styles.requiredBadge : styles.optionalBadge}>
                              {isRequired ? 'Necessária para o serviço' : 'Depende de aceite'}
                            </span>
                          </span>
                          {purpose.description ? <span style={styles.purposeDescription}>{purpose.description}</span> : null}
                          {isRequired ? (
                            <span style={styles.requiredHelp}>Esta finalidade integra a operação do serviço e não é tratada como uma escolha opcional nesta tela.</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div style={styles.formFooter}>
                <p style={styles.formHelp}>O uso das demais áreas do sistema não é interrompido por esta tela.</p>
                <ActionButton onClick={saveAcceptance} loading={saving} disabled={!policy.version || purposes.length === 0}>
                  <CheckCircle2 size={17} /> Registrar escolhas
                </ActionButton>
              </div>
            </section>
          </div>

          <aside style={styles.sideColumn}>
            <section style={styles.card} aria-labelledby="privacy-channel-title">
              <h2 id="privacy-channel-title" style={styles.cardTitle}>Canal de privacidade</h2>
              <p style={styles.sectionSubtitle}>Use exclusivamente os canais publicados pela sua empresa para dúvidas ou solicitações sobre dados pessoais.</p>
              {hasChannel ? (
                <div style={styles.channelList}>
                  {channel.email ? (
                    <a href={`mailto:${channel.email}`} style={styles.channelLink}><Mail size={17} /> {channel.email}</a>
                  ) : null}
                  {channel.phone ? (
                    <a href={`tel:${channel.phone}`} style={styles.channelLink}><Phone size={17} /> {channel.phone}</a>
                  ) : null}
                  {channelUrl ? (
                    <a href={channelUrl} target="_blank" rel="noopener noreferrer" style={styles.channelLink}>
                      <ExternalLink size={17} /> Abrir canal informado
                    </a>
                  ) : null}
                </div>
              ) : <p style={styles.emptyText}>Nenhum canal foi informado na política vigente.</p>}
            </section>

            {can('privacy.manage') ? (
              <>
              <section style={styles.card} aria-labelledby="privacy-admin-title">
                <span style={styles.adminKicker}>Configuração administrativa</span>
                <h2 id="privacy-admin-title" style={styles.cardTitle}>Publicação atual</h2>
                <dl style={styles.definitionList}>
                  <div><dt style={styles.term}>Versão</dt><dd style={styles.definition}>{policy.version || 'Não informada'}</dd></div>
                  <div><dt style={styles.term}>Vigência</dt><dd style={styles.definition}>{formatDate(policy.effectiveAt)}</dd></div>
                  <div><dt style={styles.term}>Finalidades</dt><dd style={styles.definition}>{purposes.length}</dd></div>
                  <div><dt style={styles.term}>Canal publicado</dt><dd style={styles.definition}>{hasChannel ? 'Configurado' : 'Não configurado'}</dd></div>
                </dl>
                <p style={styles.adminNote}>
                  A edição será disponibilizada quando a API administrativa de política e canal estiver ativa. Esta tela não simula alterações que não possam ser persistidas.
                </p>
              </section>
              <PrivacyRightsPanel />
              </>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}

+function PrivacyRightsPanel() {
  const [selector, setSelector] = useState('');
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  async function search() {
    const value = selector.trim();
    if (!value) { setMessage('Informe um e-mail ou CPF/CNPJ.'); return; }
    setLoading(true); setMessage(''); setPending(null);
    try {
      const key = value.includes('@') ? 'email' : 'cpfCnpj';
      const { data } = await searchPrivacySubjects({ [key]: value });
      const found = Array.isArray(data?.subjects) ? data.subjects : [];
      setSubjects(found);
      if (!found.length) setMessage('Nenhum titular encontrado nesta empresa.');
    } catch (error) {
      setSubjects([]);
      setMessage(error.response?.data?.error || 'Não foi possível consultar os titulares.');
    } finally { setLoading(false); }
  }

  async function exportSubject(subject) {
    try {
      const { data } = await exportPrivacySubject(subject.source, subject.id);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url; link.download = 'lgpd-' + subject.source + '-' + subject.id + '.json';
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(error.response?.data?.error || 'Não foi possível gerar a exportação.'); }
  }

  async function previewAnonymization(subject) {
    setProcessing(true); setMessage('');
    try {
      const { data } = await anonymizePrivacySubject(subject.source, subject.id, { dryRun: true });
      setPending({ subject, impact: data?.impact || null }); setReason('');
    } catch (error) { setMessage(error.response?.data?.error || 'Não foi possível preparar a anonimização.'); }
    finally { setProcessing(false); }
  }

  async function confirmAnonymization() {
    if (!pending || reason.trim().length < 10) { setMessage('Informe um motivo com pelo menos 10 caracteres.'); return; }
    setProcessing(true); setMessage('');
    try {
      await anonymizePrivacySubject(pending.subject.source, pending.subject.id, { dryRun: false, confirm: true, reason: reason.trim() });
      setSubjects((current) => current.map((item) => item.id === pending.subject.id && item.source === pending.subject.source ? { ...item, status: 'anonymized', name: 'Titular anonimizado' } : item));
      setPending(null); setReason(''); setMessage('Titular anonimizado; o histórico operacional obrigatório foi preservado.');
    } catch (error) { setMessage(error.response?.data?.error || 'Não foi possível anonimizar o titular.'); }
    finally { setProcessing(false); }
  }

  return (
    <section style={styles.card} aria-labelledby="privacy-rights-title">
      <span style={styles.adminKicker}>Direitos do titular</span>
      <h2 id="privacy-rights-title" style={styles.cardTitle}>Exportar ou anonimizar dados</h2>
      <p style={styles.sectionSubtitle}>Consulta restrita a administradores. A exportação não inclui segredos de integração; a anonimização exige prévia, confirmação e motivo.</p>
      <div style={styles.rightsSearch}>
        <input value={selector} onChange={(event) => setSelector(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(); }} placeholder="E-mail ou CPF/CNPJ" style={styles.rightsInput} />
        <ActionButton onClick={search} loading={loading}><Search size={16} /> Consultar</ActionButton>
      </div>
      {message ? <p style={styles.rightsMessage} role="status">{message}</p> : null}
      <div style={styles.subjectList}>
        {subjects.map((subject) => (
          <div key={subject.source + '-' + subject.id} style={styles.subjectRow}>
            <div style={{ minWidth: 0 }}>
              <strong style={styles.subjectName}>{subject.name || 'Não informado'}</strong>
              <span style={styles.subjectMeta}>{subject.source} · {subject.cpfCnpjMasked || subject.email || 'identificador mascarado'} · {subject.status}</span>
            </div>
            <div style={styles.subjectActions}>
              <ActionButton variant="secondary" size="sm" onClick={() => exportSubject(subject)}><Download size={15} /> Exportar</ActionButton>
              {subject.status !== 'anonymized' ? <ActionButton variant="danger" size="sm" onClick={() => previewAnonymization(subject)} disabled={processing}><Trash2 size={15} /> Anonimizar</ActionButton> : null}
            </div>
          </div>
        ))}
      </div>
      {pending ? (
        <div style={styles.confirmBox} role="alert">
          <strong>Confirme a anonimização</strong>
          <span style={styles.subjectMeta}>Serão redigidos dados de contato, mídias e conteúdo pessoal. Chamados e registros necessários permanecem no histórico.</span>
          <span style={styles.subjectMeta}>Impacto: {(pending.impact && pending.impact.contacts) || 0} contato(s), {(pending.impact && pending.impact.messages) || 0} mensagem(ns), {(pending.impact && pending.impact.serviceOrders) || 0} O.S.</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo da solicitação (mín. 10 caracteres)" style={styles.rightsInput} />
          <div style={styles.subjectActions}>
            <ActionButton variant="secondary" size="sm" onClick={() => setPending(null)}>Cancelar</ActionButton>
            <ActionButton variant="danger" size="sm" onClick={confirmAnonymization} loading={processing}>Confirmar anonimização</ActionButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const responsiveCss = `
  @media (max-width: 960px) {
    .privacy-grid { grid-template-columns: 1fr !important; }
  }
  @media (max-width: 640px) {
    .privacy-page { padding: var(--space-4) !important; }
  }
`;

const styles = {
  page: { flex: 1, minWidth: 0, overflowY: 'auto', padding: 'var(--space-8)', background: 'var(--bg-base)', color: 'var(--text-main)' },
  centerState: { minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontWeight: 700 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(18rem, 0.75fr)', gap: 'var(--space-5)', alignItems: 'start' },
  mainColumn: { display: 'grid', gap: 'var(--space-5)', minWidth: 0 },
  sideColumn: { display: 'grid', gap: 'var(--space-5)', minWidth: 0 },
  card: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-xs)' },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' },
  iconBox: { width: 44, height: 44, display: 'grid', placeItems: 'center', flexShrink: 0, borderRadius: 'var(--radius-md)', background: 'var(--accent-subtle)', color: 'var(--accent)' },
  cardTitle: { margin: 0, color: 'var(--text-main)', fontSize: 'var(--text-lg)', fontWeight: 800, letterSpacing: '-0.02em' },
  meta: { margin: 'var(--space-1) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
  summary: { margin: 'var(--space-5) 0 0', color: 'var(--text-muted)', lineHeight: 'var(--leading-relaxed)', whiteSpace: 'pre-wrap' },
  lastRecord: { margin: 'var(--space-4) 0 0', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-color)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  statusBadge: { marginLeft: 'auto', borderRadius: '999px', padding: '0.35rem 0.65rem', fontSize: 'var(--text-xs)', fontWeight: 800, border: '1px solid transparent' },
  successBadge: { color: 'var(--success)', background: 'var(--success-light)', borderColor: 'var(--success-border)' },
  warningBadge: { color: 'var(--warning)', background: 'var(--warning-light)', borderColor: 'var(--warning-border)' },
  neutralBadge: { color: 'var(--text-muted)', background: 'var(--bg-surface)', borderColor: 'var(--border-color)' },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' },
  sectionSubtitle: { margin: 'var(--space-2) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)' },
  purposeList: { display: 'grid', gap: 'var(--space-3)' },
  purposeCard: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)' },
  checkbox: { width: 18, height: 18, marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 },
  purposeTitleRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' },
  purposeTitle: { color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  purposeDescription: { display: 'block', marginTop: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)' },
  requiredHelp: { display: 'block', marginTop: 'var(--space-2)', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-relaxed)' },
  requiredBadge: { padding: '0.2rem 0.45rem', borderRadius: 999, background: 'var(--bg-panel-hover)', color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 800 },
  optionalBadge: { padding: '0.2rem 0.45rem', borderRadius: 999, background: 'var(--accent-subtle)', color: 'var(--accent)', fontSize: '0.68rem', fontWeight: 800 },
  formFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-5)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap' },
  formHelp: { margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  channelList: { display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-5)' },
  channelLink: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-main)', textDecoration: 'none', background: 'var(--bg-surface)', fontWeight: 700, fontSize: 'var(--text-sm)', overflowWrap: 'anywhere' },
  emptyText: { margin: 'var(--space-4) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  adminKicker: { display: 'block', marginBottom: 'var(--space-2)', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' },
  definitionList: { display: 'grid', gap: 'var(--space-3)', margin: 'var(--space-5) 0 0' },
  term: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  definition: { margin: 'var(--space-1) 0 0', color: 'var(--text-main)', fontSize: 'var(--text-sm)', fontWeight: 700 },
  adminNote: { margin: 'var(--space-5) 0 0', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-relaxed)' },
  notice: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-5)', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)' },
  errorNotice: { borderColor: 'var(--danger-border)', background: 'var(--danger-light)', color: 'var(--danger-text)' },
  noticeText: { margin: 'var(--space-1) 0 0', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)' },
  rightsSearch: { display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap' },
  rightsInput: { flex: 1, minWidth: '14rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.7rem 0.8rem', background: 'var(--bg-surface)', color: 'var(--text-main)', font: 'inherit' },
  rightsMessage: { margin: 'var(--space-3) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  subjectList: { display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-4)' },
  subjectRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', flexWrap: 'wrap' },
  subjectName: { display: 'block', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  subjectMeta: { display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: '0.2rem' },
  subjectActions: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' },
  confirmBox: { display: 'grid', gap: 'var(--space-2)', marginTop: 'var(--space-4)', padding: 'var(--space-4)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', background: 'var(--danger-light)', color: 'var(--danger-text)' },
};
