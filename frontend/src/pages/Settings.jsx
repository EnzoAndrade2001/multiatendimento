import React, { useEffect, useState } from 'react';
import { toast } from '../utils/toast';
import {
  getSettings,
  getInstances,
  saveSettings,
  updateProfile,
  getMe,
  getQuickResponses,
  createQuickResponse,
  deleteQuickResponse,
  getBusinessHours,
  saveBusinessHours,
  getTags,
  createTag,
  deleteTag,
  uploadLogo,
  getMediaUrl,
  testFirebirdConnection,
  syncFirebirdContacts,
  getBillingLogs,
  getSystemPromptPreview,
  syncCompanyFromFirebird,
} from '../services/api';
import Users from './Users';
import Teams from './Teams';
import ModalShell from '../components/ui/ModalShell';
import { usePermissions } from '../auth/PermissionContext';

const TABS = ['Robô IA', 'Atendimento', 'Atendentes', 'Equipes', 'Empresa', 'Respostas rápidas', 'Etiquetas', 'iLux Sentinela', 'Minha conta', 'Agente Local'];
const TAB_PERMISSIONS = [
  'settings.bot.manage', 'settings.attendance.manage', 'users.manage', 'teams.manage',
  'settings.company.manage', 'quick_responses.manage', 'tags.manage', 'revenue.view',
  null, 'settings.agent.manage',
];
const TAB_GROUPS = [
  { label: 'Automação', indexes: [0, 1, 5, 6] },
  { label: 'Equipe', indexes: [2, 3] },
  { label: 'Negócio', indexes: [4, 7] },
  { label: 'Sistema', indexes: [8, 9] },
];
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export default function Settings() {
  const { can } = usePermissions();
  const isMobile = window.innerWidth <= 768;
  const isAdmin = localStorage.getItem('role') === 'admin' || localStorage.getItem('role') === 'superadmin';
  const [tab, setTab] = useState(() => {
    const firstAllowed = TAB_PERMISSIONS.findIndex((permission) => !permission || can(permission));
    return firstAllowed >= 0 ? firstAllowed : 8;
  });
  const [form, setForm] = useState({
    botEnabled: false,
    botName: '',
    geminiKey: '',
    webhookUrl: '',
    systemPrompt: '',
    transferKeyword: 'atendente',
    outOfOfficeMessage: '',
    ratingEnabled: false,
    ratingMessage: '',
    notificationPhone: '',
    serviceOrderManagerCopyEnabled: false,
    serviceOrderManagerPhone: '',
    serviceOrderManagerInstanceId: '',
    companyName: '',
    companyCnpj: '',
    companyIE: '',
    companyAddress: '',
    companyBairro: '',
    companyCep: '',
    companyPhone: '',
    companyCity: '',
    companyState: '',
    serpApiKey: '',
    firebirdClientToken: '',
    firebirdApiUrl: '',
    firebirdApiKey: '',
    firebirdAuthMode: 'bearer',
    firebirdHealthPath: '/health',
    firebirdContactsPath: '/contacts',
    firebirdSyncEnabled: false,
    firebirdLastSyncAt: '',
    firebirdLastSyncStatus: 'idle',
    firebirdLastSyncError: '',
    firebirdCompany: null,
    firebirdCompanySyncStatus: 'not_synced',
    firebirdCompanySyncRequestedAt: '',
    firebirdCompanySyncRequestId: '',
    firebirdCompanySyncError: '',
    kpiContractValue: 1200.0,
    kpiServiceValue: 350.0,
    kpiSlaLimitHours: 24,
    kpiReincidentThreshold: 2,
    billingMessageTemplate: '',
  });
  const [billingLogs, setBillingLogs] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [hours, setHours] = useState([]);
  const [instances, setInstances] = useState([]);
  const [saving, setSaving] = useState(false);
  const [, setSaved] = useState(false);
  const [, setSaveError] = useState('');
  const [profile, setProfile] = useState({ name: '', email: '', password: '' });
  const [profileSaved, setProfileSaved] = useState(false);
  const [quickResponses, setQuickResponses] = useState([]);
  const [newQuick, setNewQuick] = useState({ shortcut: '', message: '' });
  const [addingQuick, setAddingQuick] = useState(false);
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState({ name: '', color: '#D4AF37' });
  const [addingTag, setAddingTag] = useState(false);
  const [promptPreview, setPromptPreview] = useState(null);
  const [loadingPromptPreview, setLoadingPromptPreview] = useState(false);
  const [testingIntegration, setTestingIntegration] = useState(false);
  const [syncingIntegration, setSyncingIntegration] = useState(false);
  const [syncingCompany, setSyncingCompany] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const visibleTabIndexes = TABS.map((_, index) => index).filter((index) => !TAB_PERMISSIONS[index] || can(TAB_PERMISSIONS[index]));

  useEffect(() => {
    if (!visibleTabIndexes.includes(tab)) setTab(visibleTabIndexes[0] ?? 8);
  }, [tab, visibleTabIndexes.join(',')]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    // As 7 chamadas eram feitas uma depois da outra (await em sequência), então
    // o tempo total era a SOMA de todas -- por isso a tela demorava ~15s. Elas
    // não dependem uma da outra, então rodam em paralelo agora: o tempo total
    // passa a ser o da mais lenta, não a soma de todas.
    const [settingsResult, meResult, instancesResult, quickResponsesResult, tagsResult, hoursResult, billingLogsResult] = await Promise.allSettled([
      getSettings(),
      getMe(),
      getInstances(),
      getQuickResponses(),
      getTags(),
      getBusinessHours(),
      getBillingLogs(),
    ]);

    if (settingsResult.status === 'fulfilled') {
      setForm((current) => ({ ...current, ...settingsResult.value.data }));
    }

    if (meResult.status === 'fulfilled') {
      setProfile({ name: meResult.value.data.name, email: meResult.value.data.email, password: '' });
      setTenant(meResult.value.data.tenant);
    }

    if (instancesResult.status === 'fulfilled') {
      setInstances(Array.isArray(instancesResult.value.data) ? instancesResult.value.data : []);
    } else {
      setInstances([]);
    }

    if (quickResponsesResult.status === 'fulfilled') {
      setQuickResponses(quickResponsesResult.value.data);
    }

    if (tagsResult.status === 'fulfilled') {
      setTags(tagsResult.value.data);
    }

    if (hoursResult.status === 'fulfilled' && hoursResult.value.data && hoursResult.value.data.length > 0) {
      setHours(hoursResult.value.data);
    } else {
      setHours([0, 1, 2, 3, 4, 5, 6].map((day) => ({ dayOfWeek: day, start: '08:00', end: '18:00', active: true })));
    }

    if (billingLogsResult.status === 'fulfilled') {
      setBillingLogs(billingLogsResult.value.data);
    }
  }

  async function handleSave(e) {
    if (e?.preventDefault) e.preventDefault();
    setSaving(true);
    setSaveError('');

    try {
      await saveSettings(form);
      if (tab === 1) {
        await saveBusinessHours({ hours });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast.success('Configurações salvas');
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Backend indisponivel';
      setSaveError(`Erro ao salvar: ${message}`);
      toast.error(`Erro ao salvar: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleCompanySync() {
    setSyncingCompany(true);
    try {
      await syncCompanyFromFirebird();
      toast.success('Consulta da empresa enviada ao agente iLux.');

      // O agente responde por HTTPS no próximo polling de comandos. Atualiza
      // somente as configurações para não reiniciar toda a tela.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const response = await getSettings();
        const next = response.data || {};
        setForm((current) => ({ ...current, ...next }));
        if (next.firebirdCompanySyncStatus !== 'pending') {
          if (next.firebirdCompanySyncStatus === 'ok') {
            toast.success('Dados da empresa atualizados pelo iLux.');
          } else {
            toast.error('O agente não confirmou a consulta da empresa.');
          }
          return;
        }
      }
      toast.info('A consulta ficou pendente. O agente atualizará assim que estiver online.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível solicitar a sincronização da empresa.');
    } finally {
      setSyncingCompany(false);
    }
  }

  async function handleShowPromptPreview() {
    setLoadingPromptPreview(true);
    try {
      const { data } = await getSystemPromptPreview(form.systemPrompt);
      setPromptPreview(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível carregar o prompt completo.');
    } finally {
      setLoadingPromptPreview(false);
    }
  }

  async function handleProfileSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile(profile);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar perfil');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddQuick(e) {
    e.preventDefault();
    if (addingQuick) return;
    setAddingQuick(true);
    try {
      const { data } = await createQuickResponse(newQuick);
      setQuickResponses([...quickResponses, data]);
      setNewQuick({ shortcut: '', message: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao adicionar resposta rápida');
    } finally {
      setAddingQuick(false);
    }
  }

  async function handleDeleteQuick(id, shortcut) {
    toast.confirm(`Excluir a resposta rápida "${shortcut || ''}"?`, async () => {
      try {
        await deleteQuickResponse(id);
        setQuickResponses(quickResponses.filter((item) => item.id !== id));
        toast.success('Resposta excluída');
      } catch {
        toast.error('Erro ao excluir resposta rápida');
      }
    });
  }

  async function handleAddTag(e) {
    e.preventDefault();
    if (!newTag.name || addingTag) return;
    setAddingTag(true);
    try {
      const { data } = await createTag(newTag);
      setTags([...tags, data]);
      setNewTag({ name: '', color: '#D4AF37' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao adicionar etiqueta');
    } finally {
      setAddingTag(false);
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setSaving(true);
    try {
      const { data } = await uploadLogo(file);
      setTenant({ ...tenant, logoUrl: data.url });
      toast.success('Logo atualizada com sucesso');
    } catch {
      toast.error('Erro ao subir logo');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestIntegration() {
    setTestingIntegration(true);
    try {
      const { data } = await testFirebirdConnection();
      toast.success(data?.message || 'Conexão com a API da empresa confirmada');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao testar a conexão');
    } finally {
      setTestingIntegration(false);
    }
  }

  async function handleSyncIntegration() {
    setSyncingIntegration(true);
    try {
      const { data } = await syncFirebirdContacts({ force: true });
      toast.success(`Sincronização concluída: ${data.created || 0} novos, ${data.updated || 0} atualizados.`);
      setForm((current) => ({
        ...current,
        firebirdLastSyncAt: new Date().toISOString(),
        firebirdLastSyncStatus: data.errors?.length ? 'partial' : 'ok',
        firebirdLastSyncError: data.errors?.length ? data.errors.join('\n') : '',
      }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao sincronizar');
    } finally {
      setSyncingIntegration(false);
    }
  }

  function generateFirebirdClientToken() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    setForm((current) => ({ ...current, firebirdClientToken: token }));
    toast.success('Token do agente gerado. Salve a integração para ativar.');
  }

  function handleCopyToken() {
    if (!form.firebirdClientToken) {
      toast.info('Nenhum token para copiar');
      return;
    }
    navigator.clipboard.writeText(form.firebirdClientToken);
    toast.success('Token copiado para a área de transferência!');
  }

  async function handleDeleteTag(id, name) {
    toast.confirm(`Excluir a etiqueta "${name || ''}"?`, async () => {
      try {
        await deleteTag(id);
        setTags(tags.filter((item) => item.id !== id));
        toast.success('Etiqueta excluída');
      } catch {
        toast.error('Erro ao excluir etiqueta');
      }
    });
  }

  // O backend nunca reverte firebirdLastSyncStatus para "offline" sozinho -
  // ele só grava "online" a cada ping do agente. Sem checar a idade do
  // último ping, um agente desligado há dias continuava aparecendo
  // "Conectado" pra sempre (o status ficava congelado no último valor).
  const AGENT_STALE_AFTER_MS = 10 * 60 * 1000; // 2x o intervalo padrão de sync (5 min)
  const agentLastSeenMs = form.firebirdLastSyncAt ? Date.now() - new Date(form.firebirdLastSyncAt).getTime() : null;
  const agentIsOnline = form.firebirdLastSyncStatus === 'online' && agentLastSeenMs != null && agentLastSeenMs < AGENT_STALE_AFTER_MS;
  const firebirdCompany = form.firebirdCompany && typeof form.firebirdCompany === 'object' ? form.firebirdCompany : null;
  const companySyncStatus = form.firebirdCompanySyncStatus || 'not_synced';
  const companySyncLabel = companySyncStatus === 'pending'
    ? 'Aguardando o agente'
    : companySyncStatus === 'ok'
      ? 'Sincronizado com o iLux'
      : companySyncStatus === 'failed'
        ? 'Falha na última consulta'
      : 'Ainda não sincronizado';

  const firebirdEnvPreview = [
    'FIREBIRD_HOST=127.0.0.1',
    'FIREBIRD_PORT=3050',
    'FIREBIRD_DATABASE=C:\\ILUX\\dados\\ILUXBASE.FDB',
    'FIREBIRD_USER=SYSDBA',
    'FIREBIRD_PASSWORD=preencha_a_senha_do_firebird',
    'FIREBIRD_CHARSET=WIN1252',
    'FIREBIRD_COMPANY_ID=1',
    '',
    'CRM_BASE_URL=https://api-crm.lcddigital.com.br',
    `CRM_TENANT_SLUG=${tenant?.slug || 'lcddigital'}`,
    `CRM_SYNC_TOKEN=${form.firebirdClientToken || 'gere_um_token_no_crm_e_salve'}`,
    'SYNC_INTERVAL_SECONDS=300',
    'BATCH_SIZE=250',
    'STATE_FILE=state.json',
    'LOG_DIR=logs',
    'LOG_FILE=logs/client.log',
  ].join('\n');

  return (
    <div className="settings-container" style={s.container}>
      <style>{settingsResponsiveCss}</style>
      <div className="settings-header" style={s.header}>
        <p style={s.kicker}>Preferências</p>
        <h2 className="settings-title" style={s.title}>Configurações</h2>
        <div className="settings-subtitle" style={s.subtitle}>Gerencie o robô, as operações do atendimento e os dados da empresa.</div>
      </div>

      <nav className="settings-nav" style={s.tabs} aria-label="Seções das configurações">
        <label className="settings-mobile-select" style={s.mobileSelectWrap}>
          <span style={s.mobileSelectLabel}>Seção atual</span>
          <select style={s.mobileSelect} value={tab} onChange={(event) => setTab(Number(event.target.value))}>
            {visibleTabIndexes.map((index) => <option key={TABS[index]} value={index}>{TABS[index]}</option>)}
          </select>
        </label>
        <div className="settings-desktop-groups" style={s.tabGroups}>
          {TAB_GROUPS.map((group) => ({ ...group, indexes: group.indexes.filter((index) => visibleTabIndexes.includes(index)) })).filter((group) => group.indexes.length).map((group) => (
            <div key={group.label} style={s.tabGroup}>
              <span style={s.tabGroupLabel}>{group.label}</span>
              <div style={s.tabGroupButtons}>
                {group.indexes.map((index) => (
                  <button
                    key={TABS[index]}
                    type="button"
                    style={{ ...s.tab, ...(tab === index ? s.tabActive : {}) }}
                    onClick={() => setTab(index)}
                    aria-current={tab === index ? 'page' : undefined}
                  >
                    {TABS[index]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {tab === 0 && (
        <div style={s.sections}>
          <div style={s.card}>
            <h2 style={s.cardTitle}>Configurações gerais</h2>
            <form onSubmit={handleSave} style={s.form}>
              {isAdmin && (
                <>
                  <div style={s.field}>
                    <label style={s.label}>URL da API (Evolution)</label>
                    <input
                      style={s.input}
                      value={form.evolutionUrl || ''}
                      onChange={(e) => setForm({ ...form, evolutionUrl: e.target.value })}
                      placeholder="https://api.sua-instância.com"
                    />
                  </div>

                  <div style={s.field}>
                    <label style={s.label}>Chave global da API (Evolution)</label>
                    <input
                      style={s.input}
                      type="password"
                      value={form.evolutionKey || ''}
                      onChange={(e) => setForm({ ...form, evolutionKey: e.target.value })}
                      placeholder="42-caracteres..."
                    />
                  </div>
                </>
              )}

              <div style={s.field}>
                <label style={s.label}>Habilitar robô de IA</label>
                <div style={s.toggleCard}>
                  <div style={s.toggleInfo}>
                    <span style={{ ...s.toggleStatus, color: form.botEnabled ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {form.botEnabled ? 'Robô ativo' : 'Robô desligado'}
                    </span>
                    <p style={s.toggleHint}>O robô responderá automaticamente tickets sem atendente.</p>
                  </div>
                  <input
                    type="checkbox"
                    style={s.switch}
                    checked={form.botEnabled}
                    onChange={(e) => setForm({ ...form, botEnabled: e.target.checked })}
                  />
                </div>
              </div>

              <div style={s.field}>
                <label style={s.label}>Nome do robô</label>
                <input
                  style={s.input}
                  value={form.botName}
                  onChange={(e) => setForm({ ...form, botName: e.target.value })}
                  placeholder="Ex: LCD Bot"
                />
                <p style={s.hint}>Este nome aparece para a equipe no chat interno.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>Chave Gemini (IA)</label>
                <input
                  style={s.input}
                  type="password"
                  value={form.geminiKey}
                  onChange={(e) => setForm({ ...form, geminiKey: e.target.value })}
                  placeholder="AIza..."
                />
              </div>

              <div style={s.field}>
                <label style={s.label}>Chave SerpAPI (Prospecção de Leads)</label>
                <input
                  style={s.input}
                  type="password"
                  value={form.serpApiKey}
                  onChange={(e) => setForm({ ...form, serpApiKey: e.target.value })}
                  placeholder="Cole aqui sua chave do serpapi.com"
                />
                <p style={s.hint}>Cadastre-se grátis em serpapi.com — 250 buscas/mês gratuitas.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>URL do webhook externo</label>
                <input
                  style={s.input}
                  value={form.webhookUrl}
                  onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                  placeholder="https://seu-crm.com/api/webhook"
                />
                <p style={s.hint}>Disparado quando um atendimento é encerrado.</p>
              </div>

              <button style={s.saveBtn} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
            </form>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Comportamento da IA</h2>
            <div style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Instruções do sistema (system prompt)</label>
                <textarea
                  style={{ ...s.input, minHeight: '120px', resize: 'vertical' }}
                  value={form.systemPrompt}
                  onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                  placeholder="Ex: Você é um atendente cordial da clínica X. Seu objetivo é agendar consultas..."
                />
                <p style={s.hint}>
                  Defina personalidade e contexto para o robô. Este texto é só uma parte do que a IA recebe -{' '}
                  <button type="button" style={s.linkBtn} onClick={handleShowPromptPreview} disabled={loadingPromptPreview}>
                    {loadingPromptPreview ? 'carregando...' : 'veja o prompt completo'}
                  </button>.
                </p>
              </div>

              <div style={s.field}>
                <label style={s.label}>Palavra-chave de transferência</label>
                <input
                  style={s.input}
                  value={form.transferKeyword}
                  onChange={(e) => setForm({ ...form, transferKeyword: e.target.value })}
                  placeholder="Ex: atendente"
                />
                <p style={s.hint}>Quando o cliente digitar isso, a IA para de responder e envia para "Aguardando".</p>
              </div>

              <button type="button" style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar comportamento da IA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 1 && (
        <div style={s.sections}>
          <div style={s.card}>
            <h2 style={s.cardTitle}>Horário de atendimento</h2>
            <div style={s.form}>
              {hours.map((hour, index) => (
                <div key={hour.dayOfWeek} className="settings-hour-row" style={s.hourRow}>
                  <div className="settings-hour-day" style={s.hourDay}>
                    {DAYS[hour.dayOfWeek]}
                  </div>

                  <div className="settings-hour-controls" style={s.hourControls}>
                    <input
                      type="checkbox"
                      checked={hour.active}
                      onChange={(e) => {
                        const next = [...hours];
                        next[index].active = e.target.checked;
                        setHours(next);
                      }}
                    />
                    <input
                      type="time"
                      style={s.hourInput}
                      value={hour.start}
                      disabled={!hour.active}
                      onChange={(e) => {
                        const next = [...hours];
                        next[index].start = e.target.value;
                        setHours(next);
                      }}
                    />
                    <span className="settings-hour-until" style={s.hourUntil}>ate</span>
                    <input
                      type="time"
                      style={s.hourInput}
                      value={hour.end}
                      disabled={!hour.active}
                      onChange={(e) => {
                        const next = [...hours];
                        next[index].end = e.target.value;
                        setHours(next);
                      }}
                    />
                  </div>
                </div>
              ))}
              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar horarios'}</button>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Mensagem de ausência</h2>
            <div style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Texto automatico</label>
                <textarea
                  style={{ ...s.input, minHeight: '120px' }}
                  value={form.outOfOfficeMessage}
                  onChange={(e) => setForm({ ...form, outOfOfficeMessage: e.target.value })}
                  placeholder="Olá! No momento nossa equipe está descansando. Deixe sua dúvida que responderemos em breve..."
                />
                <p style={s.hint}>Enviada automaticamente fora do horário comercial.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>WhatsApp para alertas do sistema</label>
                <input
                  style={s.input}
                  value={form.notificationPhone}
                  onChange={(e) => setForm({ ...form, notificationPhone: e.target.value })}
                  placeholder="5511999999999"
                />
                <p style={s.hint}>Você receberá avisos técnicos neste número.</p>
              </div>

              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar configurações de ausência'}
              </button>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Cópia automática de O.S.</h2>
            <div style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Enviar ao gestor após abrir no iLux</label>
                <div style={s.toggleCard}>
                  <div style={s.toggleInfo}>
                    <span style={{ ...s.toggleStatus, color: form.serviceOrderManagerCopyEnabled ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {form.serviceOrderManagerCopyEnabled ? 'Ativa' : 'Desativada'}
                    </span>
                    <p style={s.toggleHint}>O envio ocorre somente após o banco do iLux confirmar o número da O.S.</p>
                  </div>
                  <input
                    type="checkbox"
                    style={s.switch}
                    checked={Boolean(form.serviceOrderManagerCopyEnabled)}
                    onChange={(e) => setForm({ ...form, serviceOrderManagerCopyEnabled: e.target.checked })}
                  />
                </div>
              </div>

              <div style={s.field}>
                <label style={s.label}>WhatsApp do gestor</label>
                <input
                  type="tel"
                  style={s.input}
                  value={form.serviceOrderManagerPhone || ''}
                  disabled={!form.serviceOrderManagerCopyEnabled}
                  onChange={(e) => setForm({ ...form, serviceOrderManagerPhone: e.target.value })}
                  placeholder="5551999999999"
                />
                <p style={s.hint}>Informe país, DDD e número. Exemplo: 5551999999999.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>Instância de saída</label>
                <select
                  style={s.input}
                  value={form.serviceOrderManagerInstanceId || ''}
                  disabled={!form.serviceOrderManagerCopyEnabled}
                  onChange={(e) => setForm({ ...form, serviceOrderManagerInstanceId: e.target.value })}
                >
                  <option value="">Selecione uma instância...</option>
                  {instances.map((instance) => {
                    const connected = instance.status === 'connected' || instance.state === 'open';
                    return <option key={instance.id} value={instance.id}>{instance.instanceName} — {connected ? 'Conectada' : 'Desconectada'}</option>;
                  })}
                </select>
                <p style={s.hint}>
                  {instances.length ? 'A mensagem será enviada exclusivamente pela instância selecionada.' : 'Nenhuma instância de WhatsApp cadastrada.'}
                </p>
              </div>

              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar cópia automática'}
              </button>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Pesquisa de satisfação (CSAT)</h2>
            <div style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Habilitar avaliacao ao encerrar</label>
                <div style={s.toggleCard}>
                  <div style={s.toggleInfo}>
                    <span style={{ ...s.toggleStatus, color: form.ratingEnabled ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {form.ratingEnabled ? 'Ativa' : 'Desativada'}
                    </span>
                    <p style={s.toggleHint}>O cliente receberá uma pergunta de 1 a 5 após o encerramento.</p>
                  </div>
                  <input
                    type="checkbox"
                    style={s.switch}
                    checked={form.ratingEnabled}
                    onChange={(e) => setForm({ ...form, ratingEnabled: e.target.checked })}
                  />
                </div>
              </div>

              <div style={s.field}>
                <label style={s.label}>Mensagem de avaliação</label>
                <textarea
                  style={{ ...s.input, minHeight: '80px' }}
                  value={form.ratingMessage}
                  onChange={(e) => setForm({ ...form, ratingMessage: e.target.value })}
                  placeholder="Como você avalia nosso atendimento de 1 a 5?"
                />
                <p style={s.hint}>Use números de 1 a 5 para que o sistema identifique a nota.</p>
              </div>

              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar configurações CSAT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 2 && <Users />}
      {tab === 3 && <Teams />}

      {tab === 4 && (
        <div style={s.sections}>
          <div style={s.card}>
            <h2 style={s.cardTitle}>Dados da empresa</h2>
            <div
              style={{
                marginBottom: '1.25rem',
                padding: '1rem',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                background: 'var(--bg-panel)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ ...s.label, marginBottom: '.35rem' }}>Cadastro oficial do iLux</div>
                  <div style={{ fontWeight: 700, color: companySyncStatus === 'ok' ? 'var(--success)' : companySyncStatus === 'pending' ? 'var(--accent)' : 'var(--text-dim)' }}>
                    {companySyncLabel}
                  </div>
                  <p style={{ ...s.hint, margin: '.35rem 0 0' }}>
                    A leitura vem da tabela IEMPRESA pelo agente local. Os dados manuais abaixo continuam como fallback.
                  </p>
                  {firebirdCompany?.syncedAt && (
                    <p style={{ ...s.hint, margin: '.25rem 0 0' }}>
                      Última leitura: {new Date(firebirdCompany.syncedAt).toLocaleString('pt-BR')}
                    </p>
                  )}
                  {companySyncStatus === 'failed' && form.firebirdCompanySyncError && (
                    <p style={{ ...s.hint, margin: '.25rem 0 0', color: 'var(--danger)' }}>
                      {form.firebirdCompanySyncError}
                    </p>
                  )}
                </div>
                <button type="button" style={{ ...s.saveBtn, width: 'auto', minWidth: 190, marginTop: 0 }} onClick={handleCompanySync} disabled={syncingCompany}>
                  {syncingCompany ? 'Consultando iLux...' : 'Sincronizar agora'}
                </button>
              </div>

              {firebirdCompany && (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: '.75rem', marginTop: '1rem' }}>
                  {[
                    ['Razão social', firebirdCompany.name],
                    ['Nome fantasia', firebirdCompany.tradeName],
                    ['CNPJ / CPF', firebirdCompany.cnpj],
                    ['Inscrição estadual', firebirdCompany.stateRegistration],
                    ['Endereço', firebirdCompany.addressFull || firebirdCompany.address],
                    ['Bairro', firebirdCompany.neighborhood],
                    ['CEP', firebirdCompany.zipCode],
                    ['Cidade / UF', [firebirdCompany.city, firebirdCompany.state].filter(Boolean).join(' / ')],
                    ['Telefone', firebirdCompany.phone
                      ? (firebirdCompany.areaCode && !String(firebirdCompany.phone).replace(/\D/g, '').startsWith(String(firebirdCompany.areaCode).replace(/\D/g, ''))
                        ? `(${firebirdCompany.areaCode}) ${firebirdCompany.phone}`
                        : firebirdCompany.phone)
                      : null],
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: '.65rem .75rem', borderRadius: 8, background: 'var(--bg-panel-hover)', minWidth: 0 }}>
                      <div style={{ ...s.label, fontSize: 'var(--text-xs)', marginBottom: '.2rem' }}>{label}</div>
                      <div style={{ color: 'var(--text-main)', fontWeight: 600, overflowWrap: 'anywhere' }}>{value || 'Não informado'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Razão social / nome da empresa</label>
                <input
                  style={s.input}
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  placeholder="Sua Empresa LTDA"
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>CNPJ / CPF</label>
                  <input
                    style={s.input}
                    value={form.companyCnpj}
                    onChange={(e) => setForm({ ...form, companyCnpj: e.target.value })}
                    placeholder="00.000.000/0001-00"
                  />
                </div>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>Inscrição estadual</label>
                  <input
                    style={s.input}
                    value={form.companyIE}
                    onChange={(e) => setForm({ ...form, companyIE: e.target.value })}
                    placeholder="Isento"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ ...s.field, flex: 2 }}>
                  <label style={s.label}>Endereço (rua e número)</label>
                  <input
                    style={s.input}
                    value={form.companyAddress}
                    onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
                    placeholder="Ex: Av. Brasil, 123"
                  />
                </div>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>Bairro</label>
                  <input
                    style={s.input}
                    value={form.companyBairro}
                    onChange={(e) => setForm({ ...form, companyBairro: e.target.value })}
                    placeholder="Ex: Centro"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>CEP</label>
                  <input
                    style={s.input}
                    value={form.companyCep}
                    onChange={(e) => setForm({ ...form, companyCep: e.target.value })}
                    placeholder="00000-000"
                  />
                </div>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>Telefone de contato</label>
                  <input
                    style={s.input}
                    value={form.companyPhone}
                    onChange={(e) => setForm({ ...form, companyPhone: e.target.value })}
                    placeholder="(00) 0000-0000"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                <div style={{ ...s.field, flex: 2 }}>
                  <label style={s.label}>Cidade</label>
                  <input
                    style={s.input}
                    value={form.companyCity}
                    onChange={(e) => setForm({ ...form, companyCity: e.target.value })}
                    placeholder="Ex: Porto Alegre"
                  />
                </div>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>Estado (UF)</label>
                  <input
                    style={s.input}
                    value={form.companyState}
                    onChange={(e) => setForm({ ...form, companyState: e.target.value })}
                    placeholder="Ex: RS"
                  />
                </div>
              </div>

              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar dados da empresa'}
              </button>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Logotipo</h2>
            <div style={{ ...s.form, alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
              <div style={s.logoPreview}>
                {tenant?.logoUrl ? (
                  <img src={getMediaUrl(tenant.logoUrl)} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 'var(--text-md)', color: 'var(--text-dim)', fontWeight: 700 }}>Sem logo</span>
                )}
              </div>

              <input type="file" id="logo-upload" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} disabled={saving} />
              <label
                htmlFor="logo-upload"
                style={{
                  ...s.saveBtn,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  textAlign: 'center',
                  width: '100%',
                  display: 'block',
                  opacity: saving ? 0.7 : 1,
                  pointerEvents: saving ? 'none' : 'auto',
                }}
              >
                {saving ? 'Enviando...' : 'Importar nova logo'}
              </label>
              <p style={s.hint}>Tamanho recomendado: 300x300 px (PNG ou JPG)</p>
            </div>
          </div>
        </div>
      )}

      {tab === 5 && (
        <section style={s.card}>
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={s.sectionHeading}>Respostas rápidas</h3>
            <p style={s.hint}>Use "/" no chat para acessar mensagens pre-definidas.</p>
          </div>

          <div style={{ ...s.quickAddBox, flexDirection: isMobile ? 'column' : 'row' }}>
            <input style={s.input} value={newQuick.shortcut} onChange={(e) => setNewQuick({ ...newQuick, shortcut: e.target.value })} placeholder="/atalho" />
            <input
              style={{ ...s.input, flex: 2 }}
              value={newQuick.message}
              onChange={(e) => setNewQuick({ ...newQuick, message: e.target.value })}
              placeholder="Mensagem automatica..."
            />
            <button type="button" onClick={handleAddQuick} style={s.saveBtn} disabled={addingQuick}>
              {addingQuick ? 'Adicionando...' : 'Adicionar'}
            </button>
          </div>

          <div style={s.quickList}>
            {quickResponses.length === 0 ? (
              <p style={s.hint}>Nenhuma resposta rápida cadastrada ainda. Use o formulario acima para criar a primeira.</p>
            ) : (
              quickResponses.map((item) => (
                <div key={item.id} style={s.quickItem}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: 'var(--accent)' }}>{item.shortcut}</strong>
                    <div style={s.quickMessage}>{item.message}</div>
                  </div>
                  <button type="button" onClick={() => handleDeleteQuick(item.id, item.shortcut)} style={s.delBtn}>Excluir</button>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === 6 && (
        <section style={s.card}>
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={s.sectionHeading}>Gestao de etiquetas</h3>
            <p style={s.hint}>Defina as etiquetas oficiais que serao usadas para organizar seus contatos.</p>
          </div>

          <form onSubmit={handleAddTag} style={{ ...s.quickAddBox, flexDirection: isMobile ? 'column' : 'row' }}>
            <input
              style={s.input}
              value={newTag.name}
              onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
              placeholder="Nome da etiqueta (ex: Financeiro)"
            />
            <input
              type="color"
              style={{ ...s.input, width: isMobile ? '100%' : '60px', padding: '2px' }}
              value={newTag.color}
              onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
            />
            <button type="submit" style={s.saveBtn} disabled={addingTag}>
              {addingTag ? 'Adicionando...' : 'Adicionar'}
            </button>
          </form>

          <div style={s.quickList}>
            {tags.length === 0 ? (
              <p style={s.hint}>Nenhuma etiqueta cadastrada ainda. Use o formulario acima para criar a primeira.</p>
            ) : (
              tags.map((item) => (
                <div key={item.id} style={s.quickItem}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    <strong style={{ color: item.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</strong>
                  </div>
                  <button type="button" onClick={() => handleDeleteTag(item.id, item.name)} style={s.delBtn}>Excluir</button>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === 7 && (
        <div style={s.sections}>
          <div style={s.card}>
            <h2 style={s.cardTitle}>Configurações de KPIs do iLux Sentinela</h2>
            <form onSubmit={handleSave} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Fallback de contrato sem valor (R$/mês)</label>
                <input
                  style={s.input}
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.kpiContractValue}
                  onChange={(e) => setForm({ ...form, kpiContractValue: e.target.value })}
                  placeholder="1200.00"
                />
                <p style={s.hint}>Usado somente quando Firebird e CRM não informarem a mensalidade real. O valor fica identificado como estimativa.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>Fallback de O.S. sem valor (R$)</label>
                <input
                  style={s.input}
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.kpiServiceValue}
                  onChange={(e) => setForm({ ...form, kpiServiceValue: e.target.value })}
                  placeholder="350.00"
                />
                <p style={s.hint}>Usado somente quando a O.S. não trouxer valor do Firebird. O valor fica identificado como estimativa.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>Tempo Limite de SLA de Chamados (Horas)</label>
                <input
                  style={s.input}
                  type="number"
                  min="0"
                  value={form.kpiSlaLimitHours}
                  onChange={(e) => setForm({ ...form, kpiSlaLimitHours: e.target.value })}
                  placeholder="24"
                />
                <p style={s.hint}>Horas sem atendimento técnico antes do chamado ser classificado em risco de SLA.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>Limite de Reincidência de Equipamento (O.S./mês)</label>
                <input
                  style={s.input}
                  type="number"
                  min="1"
                  value={form.kpiReincidentThreshold}
                  onChange={(e) => setForm({ ...form, kpiReincidentThreshold: e.target.value })}
                  placeholder="2"
                />
                <p style={s.hint}>A partir de quantas O.S. no mês um equipamento é considerado reincidente/com falha recorrente no iLux Sentinela.</p>
              </div>

              <button style={s.saveBtn} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar configurações do iLux Sentinela'}
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === 8 && (
        <section style={s.card}>
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={s.sectionHeading}>Minha conta</h3>
          </div>

          <div style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Seu nome</label>
              <input style={s.input} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </div>

            <div style={s.field}>
              <label style={s.label}>E-mail</label>
              <input style={s.input} type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </div>

            <div style={s.field}>
              <label style={s.label}>Nova senha (opcional)</label>
              <input
                style={s.input}
                type="password"
                value={profile.password}
                onChange={(e) => setProfile({ ...profile, password: e.target.value })}
                placeholder="******"
              />
            </div>

                <div style={s.saveRow}>
                  {profileSaved && <span style={s.savedMsg}>Perfil atualizado</span>}
                  <button style={s.saveBtn} type="button" onClick={handleProfileSave} disabled={saving}>Salvar perfil</button>
                </div>
              </div>
            </section>
          )}

          {tab === 9 && (
            <div style={s.sections}>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h2 style={s.cardTitle}>Agente Local (Integração Firebird & Boletos)</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} title={form.firebirdLastSyncAt ? `Último sinal do agente: ${new Date(form.firebirdLastSyncAt).toLocaleString('pt-BR')}` : 'O agente nunca se conectou'}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: agentIsOnline ? 'var(--success)' : 'var(--danger)' }} />
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
                      {agentIsOnline ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                </div>

                <div style={s.form}>
                  <div style={s.integrationGuide}>
                    <strong style={s.integrationGuideTitle}>Integração com Aplicativo Desktop</strong>
                    <p style={s.hint}>
                      A configuração de banco de dados e pastas locais agora é feita diretamente no Aplicativo Desktop no servidor da empresa. Copie o token abaixo e cole no aplicativo para autenticar a conexão.
                    </p>
                  </div>

                  <div style={s.field}>
                    <label style={s.label}>Token de Autenticação (CRM_SYNC_TOKEN)</label>
                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: isMobile ? 'column' : 'row' }}>
                      <input
                        style={{ ...s.input, flex: 1 }}
                        type={showToken ? "text" : "password"}
                        value={form.firebirdClientToken}
                        onChange={(e) => setForm({ ...form, firebirdClientToken: e.target.value })}
                        placeholder="Gere um token e salve a integração"
                      />
                      <button
                        type="button"
                        style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'nowrap', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                        onClick={() => setShowToken(!showToken)}
                      >
                        {showToken ? 'Ocultar' : 'Mostrar'}
                      </button>
                      <button
                        type="button"
                        style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'nowrap', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                        onClick={handleCopyToken}
                      >
                        Copiar
                      </button>
                      <button type="button" style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'nowrap' }} onClick={generateFirebirdClientToken}>
                        Gerar token
                      </button>
                    </div>
                  </div>

                  <div style={s.field}>
                    <label style={s.label}>Última Comunicação do Agente</label>
                    <div style={{ ...s.input, backgroundColor: 'var(--bg-main)' }}>
                      {form.firebirdLastSyncAt ? new Date(form.firebirdLastSyncAt).toLocaleString('pt-BR') : 'Nunca'}
                    </div>
                  </div>

                  <div style={s.field}>
                    <label style={s.label}>Template da Mensagem de Cobrança</label>
                    <textarea
                      style={{ ...s.input, minHeight: '100px' }}
                      value={form.billingMessageTemplate || ''}
                      onChange={(e) => setForm({ ...form, billingMessageTemplate: e.target.value })}
                      placeholder="Olá! Seguem em anexo sua fatura, boleto e demonstrativo deste mês. Se tiver qualquer dúvida, estamos à disposição."
                    />
                    <p style={s.hint}>Mensagem enviada junto aos PDFs de cobrança.</p>
                  </div>

              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar configurações do agente local'}
              </button>
            </div>
          </div>

          <div style={s.card}>
            <h2 style={s.cardTitle}>Logs de Envio de Faturas (Últimos 100)</h2>
            <div style={s.form}>
              <p style={{ ...s.hint, marginBottom: '1rem' }}>O envio de cobranças agora é automático, a partir da pasta configurada no agente (Documentos financeiros). Este histórico mostra os envios feitos.</p>
              <div style={{ maxHeight: '400px', overflowY: 'auto', overflowX: 'auto' }}>
                {billingLogs.length === 0 ? (
                  <p style={s.hint}>Nenhum log de envio registrado.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>Data</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>Cliente</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>Arquivos</th>
                        <th style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingLogs.map((log) => {
                        let badgeBg, badgeColor, badgeLabel;
                        if (log.status === 'SUCCESS') {
                          badgeBg = 'var(--success-light)'; badgeColor = 'var(--success-text)'; badgeLabel = 'Enviado';
                        } else if (log.status === 'TEST') {
                          badgeBg = 'var(--warning-light)'; badgeColor = 'var(--warning-text)'; badgeLabel = 'Teste';
                        } else if (log.status === 'SKIPPED') {
                          badgeBg = 'rgba(245, 158, 11, 0.12)'; badgeColor = '#d97706'; badgeLabel = 'Ignorado';
                        } else {
                          badgeBg = 'var(--danger-light)'; badgeColor = 'var(--danger-text)'; badgeLabel = 'Erro';
                        }
                        return (
                          <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{new Date(log.sentAt).toLocaleString('pt-BR')}</td>
                            <td style={{ padding: '0.5rem' }}>{log.clientName || 'Desconhecido'} ({log.cpfCnpj})</td>
                            <td style={{ padding: '0.5rem', fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>{log.fileName}</td>
                            <td style={{ padding: '0.5rem' }}>
                              <span
                                title={log.errorMessage || ''}
                                style={{ padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', cursor: log.errorMessage ? 'help' : 'default', backgroundColor: badgeBg, color: badgeColor }}
                              >
                                {badgeLabel}
                              </span>
                              {log.status === 'FAILED' && log.errorMessage && (
                                <div style={{ fontSize: '0.68rem', color: 'var(--danger-text)', marginTop: '2px', maxWidth: '200px' }}>
                                  {log.errorMessage}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {promptPreview && (
        <ModalShell
          kicker="Robô IA"
          title="Prompt completo enviado à IA"
          onClose={() => setPromptPreview(null)}
          maxWidth="42rem"
        >
          <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p style={s.hint}>{promptPreview.note}</p>
            <pre style={s.promptPreviewBox}>{promptPreview.prompt}</pre>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

const settingsResponsiveCss = `
  .settings-container button:focus-visible,
  .settings-container input:focus-visible,
  .settings-container textarea:focus-visible,
  .settings-container select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .settings-nav button:hover:not(:disabled) { background: var(--bg-panel-hover) !important; border-color: var(--border-color) !important; color: var(--text-main) !important; }
  .settings-nav button:focus:not(:focus-visible) { outline: none !important; box-shadow: none !important; }
  .settings-hour-controls input[type='time'] { width: 100%; min-width: 0; }
  .settings-mobile-select { display: none !important; }
  .settings-nav ~ * { margin-left: 244px; }
  @media (max-width: 1050px) {
    .settings-container { padding: 1.5rem !important; }
    .settings-nav { width: 194px !important; }
    .settings-nav ~ * { margin-left: 214px; }
  }
  @media (max-width: 760px) {
    .settings-container { padding: 1rem !important; }
    .settings-header { margin-bottom: 1.25rem !important; }
    .settings-desktop-groups { display: none !important; }
    .settings-mobile-select { display: grid !important; }
    .settings-nav { float: none !important; width: auto !important; padding: .65rem !important; margin: 0 -1rem 1rem !important; border-radius: 0 !important; top: 0 !important; }
    .settings-nav ~ * { margin-left: 0; }
    .settings-container section, .settings-container form { min-width: 0; }
    .settings-container table { min-width: 620px; }
    .settings-hour-row { grid-template-columns: 1fr !important; gap: .55rem !important; align-items: stretch !important; }
    .settings-hour-day { width: auto !important; }
  }
`;

const s = {
  container: { padding: '2rem', flex: 1, overflowY: 'auto', background: 'var(--bg-base)', color: 'var(--text-main)' },
  linkBtn: { background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontSize: 'inherit', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' },
  promptPreviewBox: { background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--text-main)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '55vh', overflowY: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  header: { marginBottom: '1.5rem' },
  kicker: {
    margin: '0 0 0.45rem',
    color: 'var(--accent)',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: { fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.4rem', fontFamily: 'var(--font-display)' },
  subtitle: { fontSize: 'var(--text-md)', color: 'var(--text-muted)', lineHeight: 'var(--leading-normal)' },
  tabs: { position: 'sticky', top: '1rem', zIndex: 20, float: 'left', width: '224px', margin: '0 20px 1.5rem 0', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '16px', background: 'var(--bg-panel)', boxShadow: '0 10px 30px rgba(0,0,0,.12)' },
  tabGroups: { display: 'grid', alignItems: 'stretch', gap: '1rem' },
  tabGroup: { display: 'grid', alignContent: 'start', gap: '0.45rem', minWidth: 0 },
  tabGroupLabel: { paddingLeft: '0.4rem', color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase' },
  tabGroupButtons: { display: 'grid', gap: '0.25rem' },
  tab: {
    padding: '0.58rem 0.72rem',
    border: '1px solid var(--border-color)',
    borderRadius: '9px',
    background: 'var(--bg-surface)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    transition: 'all 0.2s',
    fontWeight: 800,
    whiteSpace: 'normal',
    textAlign: 'left',
    width: '100%',
    outline: 'none',
    boxShadow: 'none',
  },
  tabActive: { color: 'var(--text-main)', borderColor: 'var(--accent-border)', background: 'var(--accent-light)', boxShadow: 'inset 0 0 0 1px var(--accent-border)' },
  mobileSelectWrap: { gap: '0.35rem' },
  mobileSelectLabel: { color: 'var(--text-dim)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' },
  mobileSelect: { width: '100%', padding: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '10px', color: 'var(--text-main)', background: 'var(--bg-surface)', fontWeight: 600 },
  sections: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '1rem', alignItems: 'start' },
  card: { background: 'var(--bg-surface)', padding: '1.35rem', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: '0 10px 28px rgba(0,0,0,.08)' },
  cardTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 800,
    marginBottom: '1.25rem',
    color: 'var(--text-main)',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '1rem',
  },
  sectionHeading: {
    margin: 0,
    fontSize: 'var(--text-lg)',
    fontWeight: 800,
    color: 'var(--text-main)',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  toggleCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    background: 'var(--bg-base)',
    padding: '1.25rem',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
  },
  toggleInfo: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  toggleStatus: { fontWeight: 800, fontSize: 'var(--text-sm)' },
  toggleHint: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', margin: 0, lineHeight: 'var(--leading-normal)' },
  switch: { width: '40px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent)' },
  label: { fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: {
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '0.85rem 1rem',
    color: 'var(--text-main)',
    outline: 'none',
    fontSize: 'var(--text-sm)',
  },
  hint: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: '2px', lineHeight: 'var(--leading-normal)' },
  integrationMeta: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1rem',
    padding: '1rem 1.1rem',
    borderRadius: '14px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
  },
  integrationMetaLabel: {
    fontSize: '0.7rem',
    fontWeight: 800,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '0.35rem',
  },
  integrationMetaValue: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: 'var(--text-main)',
    wordBreak: 'break-word',
  },
  errorBox: {
    padding: '1rem 1.1rem',
    borderRadius: '14px',
    border: '1px solid rgba(220, 38, 38, 0.35)',
    background: 'rgba(220, 38, 38, 0.08)',
    color: '#fecaca',
  },
  errorText: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '0.78rem',
    lineHeight: 1.5,
  },
  integrationActions: {
    display: 'flex',
    gap: '0.85rem',
    flexWrap: 'wrap',
  },
  integrationGuide: {
    padding: '1rem 1.1rem',
    borderRadius: '14px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
  },
  integrationGuideTitle: {
    display: 'block',
    color: 'var(--text-main)',
    fontSize: '0.92rem',
    marginBottom: '0.35rem',
  },
  codeArea: {
    minHeight: '260px',
    fontFamily: 'Consolas, monospace',
    fontSize: '0.82rem',
    lineHeight: 1.55,
    resize: 'vertical',
    whiteSpace: 'pre',
  },
  saveBtn: {
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    border: '1px solid var(--accent)',
    padding: '0.9rem 1rem',
    borderRadius: '12px',
    cursor: 'pointer',
    fontWeight: 800,
    marginTop: '1rem',
  },
  saveRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1.5rem', marginTop: '2rem' },
  savedMsg: { color: 'var(--success-text)', fontSize: 'var(--text-sm)', fontWeight: 700 },
  quickAddBox: {
    display: 'flex',
    gap: '1rem',
    background: 'var(--bg-base)',
    padding: '1.5rem',
    borderRadius: '16px',
    marginBottom: '2rem',
    border: '1px solid var(--border-color)',
  },
  quickList: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  quickItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.25rem',
    background: 'var(--bg-panel)',
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
  },
  quickMessage: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: 'var(--leading-normal)', wordBreak: 'break-word' },
  delBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    borderRadius: '10px',
    padding: '0.55rem 0.85rem',
    fontWeight: 700,
  },
  hourRow: { display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', alignItems: 'center', gap: '0.75rem', padding: '0.9rem 0', borderBottom: '1px solid var(--border-color)' },
  hourDay: { fontWeight: 800, minWidth: 0 },
  hourControls: { display: 'grid', gridTemplateColumns: '24px minmax(80px, 1fr) auto minmax(80px, 1fr)', alignItems: 'center', gap: '0.55rem', minWidth: 0 },
  hourUntil: { color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' },
  hourInput: {
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '0.45rem 0.65rem',
    color: 'var(--text-main)',
    outline: 'none',
  },
  logoPreview: {
    width: '160px',
    height: '160px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-base)',
    borderRadius: '16px',
    border: '1px dashed var(--border-color)',
    overflow: 'hidden',
    marginBottom: '1rem',
  },
  logsContainer: {
    background: 'var(--bg-base)',
    padding: '1.25rem',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    maxHeight: '300px',
    overflowY: 'auto',
    marginTop: '0.5rem'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.85rem',
    textAlign: 'left'
  },
};
