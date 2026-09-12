import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../utils/toast';
import {
  getSettings,
  getInstances,
  saveSettings,
  testAiProvider,
  updateProfile,
  uploadProfileAvatar,
  removeProfileAvatar,
  getMe,
  getQuickResponses,
  createQuickResponse,
  deleteQuickResponse,
  getBusinessHours,
  saveBusinessHours,
  getTags,
  getTagUsage,
  createTag,
  updateTag,
  deleteTag,
  uploadLogo,
  getMediaUrl,
  testFirebirdConnection,
  syncFirebirdContacts,
  getAgentInfo,
  getAgentStatus,
  downloadAgent,
  getSystemPromptPreview,
  syncCompanyFromFirebird,
  getTechnicalContacts,
  createTechnicalContact,
  updateTechnicalContact,
  deleteTechnicalContact,
} from '../services/api';
import Users from './Users';
import Teams from './Teams';
import ModalShell from '../components/ui/ModalShell';
import { usePermissions } from '../auth/PermissionContext';
import UserAvatar from '../components/ui/UserAvatar';
import PrintGuardSettings from './PrintGuardSettings';
import AttendanceOperations from '../components/AttendanceOperations';

const TABS = ['Robô IA', 'Atendimento', 'Atendentes', 'Equipes', 'Empresa', 'Respostas rápidas', 'Etiquetas', 'iLux Sentinela', 'Minha conta', 'Agente Local', 'PrintGuard'];
const TAB_PERMISSIONS = [
  'settings.bot.manage', 'settings.attendance.manage', 'users.manage', 'teams.manage',
  'settings.company.manage', 'quick_responses.manage', 'tags.manage', 'revenue.view',
  null, 'settings.agent.manage', 'connections.manage',
];
const TAB_GROUPS = [
  { label: 'Automação', indexes: [0, 1, 6] },
  { label: 'Equipe', indexes: [2, 3] },
  { label: 'Negócio', indexes: [4, 7] },
  { label: 'Sistema', indexes: [8, 9, 10] },
];
// Respostas rápidas possui uma área própria em Operação. Mantemos o índice
// interno 5 para compatibilidade com links antigos, mas não o exibimos no
// menu de Configurações para evitar duas entradas para a mesma função.
const HIDDEN_TAB_INDEXES = new Set([5]);
const SUPPORT_ONLY_TAB_INDEXES = new Set([7, 9, 10]);
const SUPPORT_ONLY_FORM_FIELDS = [
  'aiProvider', 'aiModel', 'aiAuxProvider', 'aiModelCatalog', 'geminiKey', 'openaiKey', 'anthropicKey',
  'evolutionUrl', 'evolutionKey', 'webhookUrl', 'serpApiKey',
  'firebirdClientToken', 'firebirdApiUrl', 'firebirdApiKey', 'firebirdAuthMode', 'firebirdHealthPath',
  'firebirdContactsPath', 'firebirdSyncEnabled', 'firebirdLastSyncAt', 'firebirdLastSyncStatus', 'firebirdLastSyncError',
  'plugBoletoEnabled', 'plugBoletoBaseUrl', 'plugBoletoPrintPath', 'plugBoletoCedenteCnpj', 'plugBoletoToken',
  'plugBoletoTokenSet', 'plugBoletoConfigSyncedAt', 'statementRerenderEnabled',
  'kpiContractValue', 'kpiServiceValue', 'kpiSlaLimitHours', 'kpiReincidentThreshold',
];
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MASKED_SECRET_PATTERN = /^\*{4,}$/;

function isMaskedSecret(value) {
  return MASKED_SECRET_PATTERN.test(String(value || '').trim());
}

function normalizeTagName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function canonicalTagName(value) {
  return normalizeTagName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function isValidTagColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
}

function tagTextColor(value) {
  const hex = String(value || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#101418';
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const relativeLuminance = 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2];
  return relativeLuminance > 0.55 ? '#101418' : '#ffffff';
}

export default function Settings() {
  const { can } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = window.innerWidth <= 768;
  const [currentUser, setCurrentUser] = useState(null);
  const isSupport = (currentUser?.role || localStorage.getItem('role')) === 'superadmin';
  const [tab, setTab] = useState(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'account') return 8;
    if (requestedTab === 'printguard') return 10;
    const firstAllowed = TAB_PERMISSIONS.findIndex((permission, index) => !HIDDEN_TAB_INDEXES.has(index) && (!permission || can(permission)));
    return firstAllowed >= 0 ? firstAllowed : 8;
  });
  const [form, setForm] = useState({
    botEnabled: false,
    aiProvider: 'gemini',
    aiModel: '',
    aiAuxProvider: null,
    aiModelCatalog: null,
    botName: '',
    geminiKey: '',
    openaiKey: '',
    anthropicKey: '',
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
    osAccentColor: '#D62828',
    osBarcodeEnabled: true,
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
    plugBoletoEnabled: false,
    plugBoletoBaseUrl: 'https://plugboleto.com.br/api/v1',
    plugBoletoPrintPath: '/boletos/impressao/lote',
    plugBoletoCedenteCnpj: '',
    plugBoletoToken: '',
    plugBoletoTokenSet: false,
    plugBoletoConfigSyncedAt: '',
    statementRerenderEnabled: false,
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
    billingInstanceId: '',
  });
  const [agentInfo, setAgentInfo] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [agentInfoLoading, setAgentInfoLoading] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [hours, setHours] = useState([]);
  const [instances, setInstances] = useState([]);
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [, setSaved] = useState(false);
  const [, setSaveError] = useState('');
  const [profile, setProfile] = useState({ name: '', email: '', password: '', avatarUrl: '' });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [quickResponses, setQuickResponses] = useState([]);
  const [newQuick, setNewQuick] = useState({ shortcut: '', message: '' });
  const [addingQuick, setAddingQuick] = useState(false);
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState({ name: '', color: '#D4AF37' });
  const [addingTag, setAddingTag] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [tagUsage, setTagUsage] = useState({});
  const [tagUsageLoading, setTagUsageLoading] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [tagEditForm, setTagEditForm] = useState({ name: '', color: '#D4AF37' });
  const [savingTagEdit, setSavingTagEdit] = useState(false);
  const [promptPreview, setPromptPreview] = useState(null);
  const [loadingPromptPreview, setLoadingPromptPreview] = useState(false);
  const [testingIntegration, setTestingIntegration] = useState(false);
  const [syncingIntegration, setSyncingIntegration] = useState(false);
  const [syncingCompany, setSyncingCompany] = useState(false);
  const [technicalContacts, setTechnicalContacts] = useState([]);
  const [technicalContactForm, setTechnicalContactForm] = useState({ name: '', phone: '', firebirdSupportName: '' });
  const [editingTechnicalContact, setEditingTechnicalContact] = useState(null);
  const [technicalContactBusy, setTechnicalContactBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showAgentStartupGuide, setShowAgentStartupGuide] = useState(false);
  const visibleTabIndexes = TABS.map((_, index) => index).filter((index) => (
    !HIDDEN_TAB_INDEXES.has(index)
    && (isSupport || !SUPPORT_ONLY_TAB_INDEXES.has(index))
    && (!TAB_PERMISSIONS[index] || can(TAB_PERMISSIONS[index]))
  ));

  useEffect(() => {
    if (!visibleTabIndexes.includes(tab)) setTab(visibleTabIndexes[0] ?? 8);
  }, [tab, visibleTabIndexes.join(',')]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'account') setTab(8);
  }, [location.search]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab === 6) loadTagUsage();
  }, [tab]);

  async function loadTagUsage() {
    setTagUsageLoading(true);
    try {
      const { data } = await getTagUsage();
      setTagUsage(data?.counts || {});
    } catch {
      // Usage is an enhancement; a missing contacts permission must not hide the
      // official tag list from an administrator.
      setTagUsage({});
    } finally {
      setTagUsageLoading(false);
    }
  }

  async function load() {
    // As 7 chamadas eram feitas uma depois da outra (await em sequência), então
    // o tempo total era a SOMA de todas -- por isso a tela demorava ~15s. Elas
    // não dependem uma da outra, então rodam em paralelo agora: o tempo total
    // passa a ser o da mais lenta, não a soma de todas.
    const [settingsResult, meResult, instancesResult, quickResponsesResult, tagsResult, hoursResult, agentInfoResult, agentStatusResult, technicalContactsResult] = await Promise.allSettled([
      getSettings(),
      getMe(),
      getInstances(),
      getQuickResponses(),
      getTags(),
      getBusinessHours(),
      can('settings.agent.manage') ? getAgentInfo() : Promise.resolve({ data: null }),
      can('settings.agent.manage') ? getAgentStatus() : Promise.resolve({ data: null }),
      can('settings.bot.manage') ? getTechnicalContacts() : Promise.resolve({ data: [] }),
    ]);

    if (settingsResult.status === 'fulfilled') {
      setForm((current) => ({ ...current, ...settingsResult.value.data }));
    }

    if (meResult.status === 'fulfilled') {
      setCurrentUser(meResult.value.data);
      setProfile({ name: meResult.value.data.name, email: meResult.value.data.email, password: '', avatarUrl: meResult.value.data.avatarUrl || '' });
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

    if (agentInfoResult.status === 'fulfilled') {
      setAgentInfo(agentInfoResult.value.data);
    }
    if (agentStatusResult.status === 'fulfilled') {
      setAgentStatus(agentStatusResult.value.data);
    }
    if (technicalContactsResult.status === 'fulfilled') {
      setTechnicalContacts(Array.isArray(technicalContactsResult.value.data) ? technicalContactsResult.value.data : []);
    }
  }

  async function handleSave(e) {
    if (e?.preventDefault) e.preventDefault();
    setSaving(true);
    setSaveError('');

    try {
      const settingsToSave = { ...form };
      if (!isSupport) SUPPORT_ONLY_FORM_FIELDS.forEach((field) => delete settingsToSave[field]);
      // The API masks stored secrets in read responses. Never send that visual
      // placeholder back as if it were a real agent token.
      if (isMaskedSecret(settingsToSave.firebirdClientToken)) {
        delete settingsToSave.firebirdClientToken;
      }
      // O token do PlugBoleto só é enviado quando digitado; vazio = manter o atual.
      delete settingsToSave.plugBoletoTokenSet;
      delete settingsToSave.plugBoletoConfigSyncedAt;
      if (!String(settingsToSave.plugBoletoToken || '').trim()) {
        delete settingsToSave.plugBoletoToken;
      }
      await saveSettings(settingsToSave);
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
        const company = next.firebirdCompany;
        setForm((current) => ({
          ...current,
          ...next,
          ...(company ? {
            companyName: company.name || current.companyName,
            companyCnpj: company.cnpj || current.companyCnpj,
            companyIE: company.stateRegistration || current.companyIE,
            companyAddress: company.addressFull || company.address || current.companyAddress,
            companyBairro: company.neighborhood || current.companyBairro,
            companyCep: company.zipCode || current.companyCep,
            companyPhone: company.phone || current.companyPhone,
            companyCity: company.city || current.companyCity,
            companyState: company.state || current.companyState,
          } : {}),
        }));
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
      const { data } = await updateProfile(profile);
      setProfile((current) => ({ ...current, ...data, password: '' }));
      window.dispatchEvent(new CustomEvent('user-profile-updated', { detail: data }));
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar perfil');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestAi() {
    if (testingAi) return;
    setTestingAi(true);
    try {
      const { data } = await testAiProvider({
        aiProvider: form.aiProvider,
        aiModel: form.aiModel,
        aiAuxProvider: form.aiAuxProvider,
        geminiKey: form.geminiKey,
        openaiKey: form.openaiKey,
        anthropicKey: form.anthropicKey,
      });
      setForm((current) => {
        const next = { ...current };
        if (Array.isArray(data.models) && data.models.length) {
          next.aiModelCatalog = {
            ...(current.aiModelCatalog && typeof current.aiModelCatalog === 'object' ? current.aiModelCatalog : {}),
            [data.provider]: { models: data.models, at: new Date().toISOString() },
          };
          // Sem escolha manual ainda: adota o modelo recomendado.
          if (!current.aiModel && data.recommended) next.aiModel = data.recommended;
        }
        return next;
      });
      const count = Array.isArray(data.models) ? data.models.length : 0;
      toast.success(`${data.provider} validado em ${data.latencyMs} ms${count ? ` · ${count} modelo(s) disponível(is)` : ''}.`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível validar o provedor de IA.');
    } finally {
      setTestingAi(false);
    }
  }

  async function handleTechnicalContactSave(event) {
    event.preventDefault();
    if (technicalContactBusy) return;
    const name = technicalContactForm.name.trim();
    const phone = technicalContactForm.phone.trim();
    if (name.length < 2) {
      toast.error('Informe o nome do técnico.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 10) {
      toast.error('Informe um WhatsApp válido com DDD e número.');
      return;
    }
    setTechnicalContactBusy(true);
    try {
      const payload = { ...technicalContactForm, name, phone };
      const response = editingTechnicalContact
        ? await updateTechnicalContact(editingTechnicalContact.id, payload)
        : await createTechnicalContact(payload);
      if (editingTechnicalContact) {
        setTechnicalContacts((current) => current.map((item) => item.id === editingTechnicalContact.id ? response.data : item));
        toast.success('Autorização do técnico atualizada.');
      } else {
        setTechnicalContacts((current) => [...current, response.data]);
        toast.success('Técnico autorizado para o assistente via WhatsApp.');
      }
      setTechnicalContactForm({ name: '', phone: '', firebirdSupportName: '' });
      setEditingTechnicalContact(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível salvar o técnico autorizado.');
    } finally {
      setTechnicalContactBusy(false);
    }
  }

  function editTechnicalContact(item) {
    setEditingTechnicalContact(item);
    setTechnicalContactForm({ name: item.name || '', phone: item.phone || '', firebirdSupportName: item.firebirdSupportName || '' });
  }

  async function toggleTechnicalContact(item) {
    try {
      const response = await updateTechnicalContact(item.id, { active: !item.active });
      setTechnicalContacts((current) => current.map((contact) => contact.id === item.id ? response.data : contact));
      toast.success(response.data.active ? 'Técnico reativado.' : 'Técnico desativado.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível alterar o status.');
    }
  }

  function removeTechnicalContact(item) {
    toast.confirm(`Remover a autorização de ${item.name}? O contato não será apagado do WhatsApp.`, async () => {
      try {
        await deleteTechnicalContact(item.id);
        setTechnicalContacts((current) => current.filter((contact) => contact.id !== item.id));
        if (editingTechnicalContact?.id === item.id) {
          setEditingTechnicalContact(null);
          setTechnicalContactForm({ name: '', phone: '', firebirdSupportName: '' });
        }
        toast.success('Autorização removida.');
      } catch (err) {
        toast.error(err.response?.data?.error || 'Não foi possível remover a autorização.');
      }
    });
  }

  async function handleProfileAvatarUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarUploading(true);
    try {
      const { data } = await uploadProfileAvatar(file);
      setProfile((current) => ({ ...current, avatarUrl: data.avatarUrl || '' }));
      window.dispatchEvent(new CustomEvent('user-profile-updated', { detail: data }));
      toast.success('Foto do perfil atualizada.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível atualizar a foto do perfil.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleProfileAvatarRemove() {
    if (avatarUploading) return;
    setAvatarUploading(true);
    try {
      const { data } = await removeProfileAvatar();
      setProfile((current) => ({ ...current, avatarUrl: '' }));
      window.dispatchEvent(new CustomEvent('user-profile-updated', { detail: data }));
      toast.success('Foto do perfil removida.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível remover a foto do perfil.');
    } finally {
      setAvatarUploading(false);
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
    if (addingTag) return;
    const name = normalizeTagName(newTag.name);
    if (name.length < 2 || name.length > 80) {
      toast.error('Informe um nome de etiqueta entre 2 e 80 caracteres.');
      return;
    }
    if (!isValidTagColor(newTag.color)) {
      toast.error('Escolha uma cor válida para a etiqueta.');
      return;
    }
    if (tags.some((item) => canonicalTagName(item.name) === canonicalTagName(name))) {
      toast.error('Já existe uma etiqueta com esse nome.');
      return;
    }
    setAddingTag(true);
    try {
      const { data } = await createTag({ name, color: newTag.color.toUpperCase() });
      setTags((current) => [...current, data]);
      setNewTag({ name: '', color: '#D4AF37' });
      toast.success('Etiqueta criada.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao adicionar etiqueta');
    } finally {
      setAddingTag(false);
    }
  }

  function openTagEditor(item) {
    setEditingTag(item);
    setTagEditForm({ name: item.name || '', color: isValidTagColor(item.color) ? item.color : '#D4AF37' });
  }

  async function handleUpdateTag(e) {
    e.preventDefault();
    if (!editingTag || savingTagEdit) return;
    const name = normalizeTagName(tagEditForm.name);
    if (name.length < 2 || name.length > 80) {
      toast.error('Informe um nome de etiqueta entre 2 e 80 caracteres.');
      return;
    }
    if (!isValidTagColor(tagEditForm.color)) {
      toast.error('Escolha uma cor válida para a etiqueta.');
      return;
    }
    if (tags.some((item) => item.id !== editingTag.id && canonicalTagName(item.name) === canonicalTagName(name))) {
      toast.error('Já existe uma etiqueta com esse nome.');
      return;
    }
    setSavingTagEdit(true);
    try {
      const { data } = await updateTag(editingTag.id, { name, color: tagEditForm.color.toUpperCase() });
      setTags((current) => current.map((item) => (item.id === editingTag.id ? { ...item, ...data } : item)));
      setEditingTag(null);
      toast.success('Etiqueta atualizada.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao atualizar etiqueta');
    } finally {
      setSavingTagEdit(false);
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
    if (isMaskedSecret(form.firebirdClientToken)) {
      toast.info('O token já está configurado e protegido. Mantenha o token atual no agente ou gere e salve um novo.');
      return;
    }
    navigator.clipboard.writeText(form.firebirdClientToken);
    toast.success('Token copiado para a área de transferência!');
  }

  async function handleCopyAgentCommand(command, label = 'Comando') {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error('Não foi possível copiar o comando.');
    }
  }

  async function handleRefreshAgentInfo() {
    setAgentInfoLoading(true);
    try {
      const [infoResult, statusResult] = await Promise.allSettled([getAgentInfo(), getAgentStatus()]);
      if (infoResult.status === 'fulfilled') setAgentInfo(infoResult.value.data);
      if (statusResult.status === 'fulfilled') setAgentStatus(statusResult.value.data);
      if (infoResult.status === 'rejected' && statusResult.status === 'rejected') {
        throw infoResult.reason;
      }
      toast.success('Informações do agente atualizadas.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível carregar as informações do agente.');
    } finally {
      setAgentInfoLoading(false);
    }
  }

  async function handleDownloadAgent() {
    if (!agentInfo?.downloadAvailable) {
      if (agentInfo?.externalDownloadUrl) window.open(agentInfo.externalDownloadUrl, '_blank', 'noopener,noreferrer');
      else toast.info('O pacote do agente ainda não foi publicado.');
      return;
    }

    try {
      const { data } = await downloadAgent();
      const url = window.URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = agentInfo.fileName || 'FirebirdCRMClient.exe';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Download do agente iniciado.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível baixar o agente.');
    }
  }

  async function handleDeleteTag(id, name) {
    const usageCount = tagUsage[canonicalTagName(name)] || 0;
    const warning = usageCount > 0
      ? `A etiqueta "${name || ''}" está associada a ${usageCount} contato(s). Excluir remove apenas a etiqueta oficial; os contatos e o histórico não serão apagados. Continuar?`
      : `Excluir a etiqueta "${name || ''}"?`;
    toast.confirm(warning, async () => {
      try {
        await deleteTag(id);
        setTags((current) => current.filter((item) => item.id !== id));
        toast.success('Etiqueta excluída');
      } catch {
        toast.error('Erro ao excluir etiqueta');
      }
    });
  }

  // O que prova que o agente está vivo é a idade do último contato, não o
  // texto do status: o /ping grava "online", mas cada /push grava "ok"/"partial"
  // e é a última coisa que roda se o ciclo morre antes do ping. Então: contato
  // recente + status que não seja erro explícito = conectado. (Antes exigia
  // status === "online" e um agente sincronizando aparecia "Desconectado".)
  const AGENT_STALE_AFTER_MS = 10 * 60 * 1000; // 2x o intervalo padrão de sync (5 min)
  const agentLastSeenMs = form.firebirdLastSyncAt ? Date.now() - new Date(form.firebirdLastSyncAt).getTime() : null;
  const agentSyncState = String(form.firebirdLastSyncStatus || '').toLowerCase();
  const agentIsOnline = agentLastSeenMs != null
    && agentLastSeenMs < AGENT_STALE_AFTER_MS
    && !['error', 'offline'].includes(agentSyncState);
  const agentInstalls = Array.isArray(agentStatus?.agents) ? agentStatus.agents : [];
  const agentPublishedVersion = agentStatus?.latestVersion || agentInfo?.version || null;
  const agentOutdatedCount = agentStatus?.outdatedCount || 0;
  const firebirdTokenIsMasked = isMaskedSecret(form.firebirdClientToken);
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
    ...(firebirdTokenIsMasked
      ? [
          '# CRM_SYNC_TOKEN já configurado e protegido pelo CRM.',
          '# Mantenha no agente o token atual ou gere e salve um novo nesta tela.',
        ]
      : [`CRM_SYNC_TOKEN=${form.firebirdClientToken || 'gere_um_token_no_crm_e_salve'}`]),
    'SYNC_INTERVAL_SECONDS=300',
    'BATCH_SIZE=250',
    'STATE_FILE=state.json',
    'LOG_DIR=logs',
    'LOG_FILE=logs/client.log',
  ].join('\n');

  const normalizedTagSearch = canonicalTagName(tagSearch);
  const visibleTags = tags.filter((item) => {
    const normalizedName = canonicalTagName(item.name);
    const usageCount = tagUsage[normalizedName] || 0;
    const matchesSearch = !normalizedTagSearch || normalizedName.includes(normalizedTagSearch);
    const matchesFilter = tagFilter === 'all' || (tagFilter === 'used' ? usageCount > 0 : usageCount === 0);
    return matchesSearch && matchesFilter;
  });
  const usedTagCount = tags.filter((item) => (tagUsage[canonicalTagName(item.name)] || 0) > 0).length;
  const totalTaggedContacts = Object.values(tagUsage).reduce((total, value) => total + value, 0);

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
              {isSupport && (
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

              <div style={isSupport ? s.field : { display: 'none' }}>
                <label style={s.label}>Provedor da IA de atendimento</label>
                <select style={s.input} value={form.aiProvider || 'gemini'} onChange={(e) => setForm({ ...form, aiProvider: e.target.value })}>
                  <option value="gemini">Google Gemini (padrão atual)</option>
                  <option value="openai">OpenAI / GPT</option>
                  <option value="anthropic">Anthropic / Claude</option>
                </select>
                <p style={s.hint}>A escolha vale para respostas, resumos e classificações. Pode ser alterada sem afetar o histórico.</p>
              </div>

              <div style={isSupport ? s.field : { display: 'none' }}>
                <label style={s.label}>{form.aiProvider === 'openai' ? 'Chave da OpenAI' : form.aiProvider === 'anthropic' ? 'Chave da Anthropic' : 'Chave Gemini'}</label>
                <input
                  style={s.input}
                  type="password"
                  autoComplete="new-password"
                  value={form.aiProvider === 'openai' ? (form.openaiKey || '') : form.aiProvider === 'anthropic' ? (form.anthropicKey || '') : (form.geminiKey || '')}
                  onChange={(e) => setForm({ ...form, [form.aiProvider === 'openai' ? 'openaiKey' : form.aiProvider === 'anthropic' ? 'anthropicKey' : 'geminiKey']: e.target.value })}
                  placeholder={form.aiProvider === 'openai' ? 'sk-...' : form.aiProvider === 'anthropic' ? 'sk-ant-...' : 'AIza...'}
                />
                <p style={s.hint}>Cole a chave e clique em <strong>Validar e listar modelos</strong> abaixo.</p>
              </div>

              {isSupport && <button type="button" style={{ ...s.saveBtn, background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }} onClick={handleTestAi} disabled={testingAi}>
                {testingAi ? 'Validando...' : 'Validar e listar modelos'}
              </button>}

              {isSupport && form.aiProvider !== 'gemini' && (() => {
                const catalog = form.aiModelCatalog?.[form.aiProvider]?.models || [];
                const known = catalog.some((m) => (typeof m === 'string' ? m : m.id) === form.aiModel);
                return (
                  <div style={s.field}>
                    <label style={s.label}>Modelo</label>
                    {catalog.length > 0 ? (
                      <>
                        <select style={s.input} value={known ? form.aiModel : (form.aiModel ? '__custom__' : '')} onChange={(e) => setForm({ ...form, aiModel: e.target.value === '__custom__' ? (form.aiModel || '') : e.target.value })}>
                          <option value="">Automático (recomendado)</option>
                          {catalog.map((m) => {
                            const id = typeof m === 'string' ? m : m.id;
                            const label = typeof m === 'string' ? m : (m.label || m.id);
                            return <option key={id} value={id}>{label}</option>;
                          })}
                          <option value="__custom__">Outro (digitar manualmente)…</option>
                        </select>
                        {(!known && form.aiModel) && (
                          <input style={{ ...s.input, marginTop: 8 }} value={form.aiModel} onChange={(e) => setForm({ ...form, aiModel: e.target.value })} placeholder="ID exato do modelo" />
                        )}
                        <p style={s.hint}>"Automático" usa o modelo mais capaz que a sua conta liberou. {form.aiModelCatalog?.[form.aiProvider]?.at ? `Lista atualizada em ${new Date(form.aiModelCatalog[form.aiProvider].at).toLocaleString('pt-BR')}.` : ''}</p>
                      </>
                    ) : (
                      <>
                        <input style={s.input} value={form.aiModel || ''} onChange={(e) => setForm({ ...form, aiModel: e.target.value })} placeholder="Deixe vazio para automático, ou o ID exato do modelo" />
                        <p style={s.hint}>Valide a chave acima para escolher o modelo numa lista. Vazio = automático.</p>
                      </>
                    )}
                  </div>
                );
              })()}

              {isSupport && form.aiProvider === 'anthropic' && (
                <div style={s.field}>
                  <label style={s.label}>Motor auxiliar (embeddings e áudio)</label>
                  <select style={s.input} value={form.aiAuxProvider || ''} onChange={(e) => setForm({ ...form, aiAuxProvider: e.target.value || null })}>
                    <option value="">Nenhum — Claude puro</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                  {!form.aiAuxProvider ? (
                    <p style={s.hint}>O Claude não tem API de embeddings nem de transcrição. Sem motor auxiliar, a <strong>base de conhecimento passa a buscar só por palavra-chave</strong> e áudios ficam sem transcrição. Leitura de imagem e PDF continua funcionando pelo próprio Claude.</p>
                  ) : (
                    <>
                      <input
                        style={{ ...s.input, marginTop: 8 }}
                        type="password"
                        autoComplete="new-password"
                        value={form.aiAuxProvider === 'openai' ? (form.openaiKey || '') : (form.geminiKey || '')}
                        onChange={(e) => setForm({ ...form, [form.aiAuxProvider === 'openai' ? 'openaiKey' : 'geminiKey']: e.target.value })}
                        placeholder={form.aiAuxProvider === 'openai' ? 'sk-... (chave OpenAI só para embeddings/áudio)' : 'AIza... (chave Gemini só para embeddings/áudio)'}
                      />
                      <p style={s.hint}>Trocar o motor de embeddings exige re-indexar a base de conhecimento (botão em Base de Conhecimento).</p>
                    </>
                  )}
                </div>
              )}

              <div style={isSupport ? s.field : { display: 'none' }}>
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

              <div style={isSupport ? s.field : { display: 'none' }}>
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

          {can('settings.bot.manage') && (
            <section style={s.card} aria-labelledby="technical-contacts-title">
              <h2 id="technical-contacts-title" style={s.cardTitle}>Assistente técnico via WhatsApp</h2>
              <p style={s.hint}>
                Autorize números de técnicos de campo para consultarem os manuais publicados pelo WhatsApp. Eles não precisam de usuário, senha ou acesso ao chat; Diego continua administrador normalmente.
              </p>
              <form onSubmit={handleTechnicalContactSave} style={{ ...s.form, marginTop: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                  <div style={{ ...s.field, flex: 1 }}>
                    <label style={s.label} htmlFor="technical-contact-name">Nome do técnico</label>
                    <input id="technical-contact-name" style={s.input} value={technicalContactForm.name} onChange={(e) => setTechnicalContactForm({ ...technicalContactForm, name: e.target.value })} placeholder="Ex.: Diego Cabral" maxLength={120} />
                  </div>
                  <div style={{ ...s.field, flex: 1 }}>
                    <label style={s.label} htmlFor="technical-contact-phone">WhatsApp autorizado</label>
                    <input id="technical-contact-phone" type="tel" style={s.input} value={technicalContactForm.phone} onChange={(e) => setTechnicalContactForm({ ...technicalContactForm, phone: e.target.value })} placeholder="5551999999999" maxLength={20} />
                  </div>
                </div>
                <div style={s.field}>
                  <label style={s.label} htmlFor="technical-contact-firebird-name">Nome do técnico no iLux (opcional)</label>
                  <input id="technical-contact-firebird-name" style={s.input} value={technicalContactForm.firebirdSupportName} onChange={(e) => setTechnicalContactForm({ ...technicalContactForm, firebirdSupportName: e.target.value })} placeholder="Ex.: DIEGO" maxLength={80} />
                  <p style={s.hint}>Usado apenas para identificar o técnico ao abrir chamados no iLux.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="submit" style={s.saveBtn} disabled={technicalContactBusy}>
                    {technicalContactBusy ? 'Salvando...' : (editingTechnicalContact ? 'Salvar alteração' : 'Autorizar número')}
                  </button>
                  {editingTechnicalContact && <button type="button" style={s.iconButton} onClick={() => { setEditingTechnicalContact(null); setTechnicalContactForm({ name: '', phone: '', firebirdSupportName: '' }); }}>Cancelar edição</button>}
                </div>
              </form>
              <div style={{ display: 'grid', gap: '0.65rem', marginTop: '1.25rem' }}>
                {technicalContacts.length === 0 ? (
                  <p style={s.hint}>Nenhum número autorizado ainda.</p>
                ) : technicalContacts.map((item) => (
                  <div key={item.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', border: '1px solid var(--border)', borderRadius: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{item.name}</strong>
                      <div style={s.hint}>{item.phone}{item.firebirdSupportName ? ` · iLux: ${item.firebirdSupportName}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button type="button" style={s.iconButton} onClick={() => toggleTechnicalContact(item)}>{item.active ? 'Ativo' : 'Inativo'}</button>
                      <button type="button" style={s.iconButton} onClick={() => editTechnicalContact(item)}>Editar</button>
                      <button type="button" style={s.delBtn} onClick={() => removeTechnicalContact(item)}>Remover</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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
          <AttendanceOperations styles={s} />
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
                <label style={s.label}>WhatsApp para alertas técnicos (fallback)</label>
                <input
                  style={s.input}
                  value={form.notificationPhone}
                  onChange={(e) => setForm({ ...form, notificationPhone: e.target.value })}
                  placeholder="5511999999999"
                />
                <p style={s.hint}>Usado apenas quando não houver um gestor configurado abaixo para receber cópias de O.S.</p>
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
                <p style={s.hint}>Informe país, DDD e número. Este mesmo gestor receberá os alertas enviados pelo botão “Gestor” do Sentinela.</p>
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
                    const connected = instance.status === 'connected' && (instance.state === 'open' || instance.healthStatus === 'healthy' || (!instance.state && !instance.healthStatus));
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
                    A leitura vem da tabela IEMPRESA pelo agente local. Ao sincronizar, os campos abaixo são preenchidos e salvos como fallback.
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

              <div style={s.field}>
                <label style={s.label}>Cor de destaque da O.S.</label>
                <p style={s.hint}>
                  O corpo da O.S. continua preto. Só o cabeçalho e as faixas de seção usam esta cor
                  (padrão vermelho). Use a cor da sua marca.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(form.osAccentColor || '') ? form.osAccentColor : '#D62828'}
                    onChange={(e) => setForm({ ...form, osAccentColor: e.target.value.toUpperCase() })}
                    style={{ width: 52, height: 40, padding: 2, border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-surface)', cursor: 'pointer' }}
                    aria-label="Selecionar cor de destaque da O.S."
                  />
                  <input
                    style={{ ...s.input, flex: '0 1 140px', textTransform: 'uppercase' }}
                    value={form.osAccentColor || ''}
                    onChange={(e) => setForm({ ...form, osAccentColor: e.target.value })}
                    placeholder="#D62828"
                    maxLength={7}
                  />
                  {['#D62828', '#1D4ED8', '#047857', '#7C3AED', '#B45309', '#111827'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setForm({ ...form, osAccentColor: preset })}
                      title={preset}
                      style={{
                        width: 28, height: 28, borderRadius: 6, cursor: 'pointer', padding: 0,
                        background: preset,
                        border: (form.osAccentColor || '').toUpperCase() === preset ? '2px solid var(--text-main)' : '1px solid var(--border-color)',
                      }}
                      aria-label={`Usar cor ${preset}`}
                    />
                  ))}
                </div>
              </div>

              <div style={s.field}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.65rem', cursor: 'pointer', color: 'var(--text-main)', fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={form.osBarcodeEnabled !== false}
                    onChange={(e) => setForm({ ...form, osBarcodeEnabled: e.target.checked })}
                    style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                  />
                  Exibir código de barras na O.S.
                </label>
                <p style={{ ...s.hint, margin: '.4rem 0 0 1.65rem' }}>
                  Gera um Code 128 com o número da ordem de serviço abaixo do título no cabeçalho.
                </p>
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
        <section style={s.card} aria-labelledby="quick-responses-settings-title">
          <div style={s.quickRedirectHeader}>
            <div>
              <p style={s.kicker}>Central de mensagens</p>
              <h3 id="quick-responses-settings-title" style={s.sectionHeading}>Respostas rápidas</h3>
              <p style={s.hint}>A gestão completa foi movida para uma tela própria, com busca, categorias, escopos, favoritos, edição e pré-visualização.</p>
            </div>
            <button type="button" style={s.saveBtn} onClick={() => navigate('/quick-responses')}>
              Abrir respostas rápidas
            </button>
          </div>
          <div style={s.quickRedirectGrid}>
            <div><strong>Atalhos no atendimento</strong><span>Digite “/” no chat para localizar os modelos disponíveis para seu usuário.</span></div>
            <div><strong>Escopos e permissões</strong><span>Publique modelos para toda a empresa, uma equipe ou somente para você.</span></div>
            <div><strong>Compatibilidade</strong><span>Os modelos existentes continuam disponíveis; use a tela dedicada para editar sem perder a configuração.</span></div>
          </div>
        </section>
      )}

      {false && tab === 5 && (
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
        <section style={s.card} aria-labelledby="tags-settings-title">
          <div className="tag-header" style={s.tagHeader}>
            <div>
              <p style={s.kicker}>Organização do atendimento</p>
              <h3 id="tags-settings-title" style={s.sectionHeading}>Gestão de etiquetas</h3>
              <p style={s.hint}>Crie etiquetas consistentes para segmentar contatos e encontrar conversas com rapidez.</p>
            </div>
            <div className="tag-stats" style={s.tagStats} aria-live="polite">
              <div style={s.tagStat}><strong>{tags.length}</strong><span>etiquetas oficiais</span></div>
              <div style={s.tagStat}><strong>{usedTagCount}</strong><span>em uso</span></div>
              <div style={s.tagStat}><strong>{totalTaggedContacts}</strong><span>vínculos identificados</span></div>
            </div>
          </div>

          <form className="tag-create-box" onSubmit={handleAddTag} style={s.tagCreateBox} aria-label="Criar etiqueta">
            <div style={s.tagCreateField}>
              <label style={s.label} htmlFor="new-tag-name">Nova etiqueta</label>
              <input
                id="new-tag-name"
                style={s.input}
                value={newTag.name}
                maxLength={80}
                onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                placeholder="Ex.: Financeiro"
              />
            </div>
            <div style={s.tagColorField}>
              <label style={s.label} htmlFor="new-tag-color">Cor</label>
              <input
                id="new-tag-color"
                type="color"
                style={s.colorInput}
                value={newTag.color}
                onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                aria-label="Cor da nova etiqueta"
              />
            </div>
            <button type="submit" style={{ ...s.saveBtn, marginTop: 0 }} disabled={addingTag}>
              {addingTag ? 'Criando...' : 'Criar etiqueta'}
            </button>
          </form>

          <div style={s.tagToolbar}>
            <label style={s.tagSearchWrap}>
              <span aria-hidden="true">⌕</span>
              <input
                style={s.tagSearchInput}
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="Buscar etiqueta"
                aria-label="Buscar etiqueta"
              />
            </label>
            <select style={s.tagFilterSelect} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filtrar etiquetas">
              <option value="all">Todas</option>
              <option value="used">Em uso</option>
              <option value="unused">Sem uso</option>
            </select>
            <button type="button" style={s.iconButton} onClick={loadTagUsage} disabled={tagUsageLoading}>
              {tagUsageLoading ? 'Atualizando...' : 'Atualizar uso'}
            </button>
          </div>
          <p style={{ ...s.hint, margin: '0 0 1rem' }}>O uso é atualizado a partir dos contatos disponíveis. Excluir uma etiqueta não remove contatos nem histórico.</p>

          <div style={s.tagList}>
            {visibleTags.length === 0 ? (
              <div style={s.tagEmpty}>
                <strong>{tags.length ? 'Nenhuma etiqueta corresponde ao filtro.' : 'Nenhuma etiqueta cadastrada ainda.'}</strong>
                <span>{tags.length ? 'Tente outro termo ou filtro.' : 'Crie a primeira etiqueta acima para organizar seus contatos.'}</span>
              </div>
            ) : visibleTags.map((item) => {
              const usageCount = tagUsage[canonicalTagName(item.name)] || 0;
              const color = isValidTagColor(item.color) ? item.color : '#D4AF37';
              return (
                <div className="tag-row" key={item.id} style={s.tagRow}>
                  <span className="tag-chip" style={{ ...s.tagChip, background: color, color: tagTextColor(color) }}>
                    <span aria-hidden="true" style={s.tagChipDot} />
                    {item.name}
                  </span>
                  <span style={s.tagUsageBadge}>{usageCount} {usageCount === 1 ? 'contato' : 'contatos'}</span>
                  <div style={s.tagRowActions}>
                    <button type="button" onClick={() => openTagEditor(item)} style={s.iconButton} aria-label={`Editar etiqueta ${item.name}`}>Editar</button>
                    <button type="button" onClick={() => handleDeleteTag(item.id, item.name)} style={s.delBtn}>Excluir</button>
                  </div>
                </div>
              );
            })}
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
            <div style={s.profilePhotoCard}>
              <UserAvatar user={profile} name={profile.name} size={76} style={s.profilePhoto} />
              <div style={s.profilePhotoInfo}>
                <strong style={s.profilePhotoTitle}>Foto do perfil</strong>
                <p style={s.hint}>JPG, PNG ou WebP, até 2 MB. Ela será exibida no menu, na equipe e no chat interno.</p>
                <div style={s.profilePhotoActions}>
                  <label htmlFor="profile-avatar-upload" style={{ ...s.iconButton, cursor: avatarUploading ? 'not-allowed' : 'pointer', opacity: avatarUploading ? 0.65 : 1 }}>
                    {avatarUploading ? 'Enviando...' : 'Escolher foto'}
                  </label>
                  <input id="profile-avatar-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleProfileAvatarUpload} disabled={avatarUploading} style={{ display: 'none' }} />
                  {profile.avatarUrl ? <button type="button" style={{ ...s.iconButton, color: 'var(--danger-text)', borderColor: 'var(--danger-border)' }} onClick={handleProfileAvatarRemove} disabled={avatarUploading}>Remover</button> : null}
                </div>
              </div>
            </div>

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap', minWidth: 0 }}>
                  <h2 style={s.cardTitle}>Agente Local (Integração Firebird & Boletos)</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }} title={form.firebirdLastSyncAt ? `Último sinal do agente: ${new Date(form.firebirdLastSyncAt).toLocaleString('pt-BR')}` : 'O agente nunca se conectou'}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: agentIsOnline ? 'var(--success)' : 'var(--danger)' }} />
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
                      {agentIsOnline ? 'Conectado' : 'Desconectado'}
                    </span>
                    {agentOutdatedCount > 0 && (
                      <span style={{
                        fontSize: 'var(--text-xs)', fontWeight: 600, whiteSpace: 'nowrap',
                        padding: '0.2rem 0.5rem', borderRadius: '999px',
                        color: 'var(--danger)', border: '1px solid var(--danger)',
                      }}>
                        ⚠ {agentOutdatedCount} desatualizada(s)
                      </span>
                    )}
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
                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: isMobile ? 'column' : 'row', flexWrap: isMobile ? 'nowrap' : 'wrap', minWidth: 0 }}>
                      <input
                        style={{ ...s.input, flex: '1 1 240px', minWidth: 0 }}
                        type={showToken ? "text" : "password"}
                        value={form.firebirdClientToken}
                        onChange={(e) => setForm({ ...form, firebirdClientToken: e.target.value })}
                        placeholder="Gere um token e salve a integração"
                        readOnly={firebirdTokenIsMasked}
                        title={firebirdTokenIsMasked ? 'Token já configurado e protegido pelo CRM' : undefined}
                      />
                      <button
                        type="button"
                        style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'nowrap', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                        onClick={() => setShowToken(!showToken)}
                        disabled={firebirdTokenIsMasked}
                      >
                        {firebirdTokenIsMasked ? 'Protegido' : showToken ? 'Ocultar' : 'Mostrar'}
                      </button>
                      <button
                        type="button"
                        style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'nowrap', background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                        onClick={handleCopyToken}
                        disabled={firebirdTokenIsMasked}
                      >
                        Copiar
                      </button>
                      <button type="button" style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'nowrap' }} onClick={generateFirebirdClientToken}>
                        Gerar token
                      </button>
                    </div>
                    {firebirdTokenIsMasked && (
                      <p style={s.hint}>
                        O token já está configurado e não pode ser exibido novamente. Mantenha o valor atual no agente instalado ou clique em <strong>Gerar token</strong>, salve as configurações e copie o novo valor.
                      </p>
                    )}
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

                  <div style={s.field}>
                    <label style={s.label}>Instância de saída da cobrança</label>
                    <select
                      style={s.input}
                      value={form.billingInstanceId || ''}
                      onChange={(e) => setForm({ ...form, billingInstanceId: e.target.value })}
                    >
                      <option value="">Selecione uma instância...</option>
                      {instances.map((instance) => {
                        const connected = instance.status === 'connected' && (instance.state === 'open' || instance.healthStatus === 'healthy' || (!instance.state && !instance.healthStatus));
                        const official = instance.provider === 'evolution_official';
                        return (
                          <option key={instance.id} value={instance.id}>
                            {instance.instanceName}{official ? ' · Oficial' : ' · QR'} — {connected ? 'Conectada' : 'Desconectada'}
                          </option>
                        );
                      })}
                    </select>
                    <p style={s.hint}>
                      Selecione obrigatoriamente a instância para as cobranças não saírem por um número errado.
                      Na instância <strong>oficial</strong>, o envio financeiro fica bloqueado fora da janela de 24 horas enquanto não houver um template de utilidade aprovado configurado para essa automação.
                    </p>
                  </div>

                  <div style={{ ...s.integrationGuide, marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <strong style={s.integrationGuideTitle}>Boleto direto (PlugBoleto)</strong>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
                        <input
                          type="checkbox"
                          checked={!!form.plugBoletoEnabled}
                          onChange={(e) => setForm({ ...form, plugBoletoEnabled: e.target.checked })}
                        />
                        Ativado
                      </label>
                    </div>
                    <p style={s.hint}>
                      Com isto ligado, o CRM busca o PDF do boleto direto na API do banco (PlugBoleto), sem depender da pasta monitorada.
                      Sem PlugBoleto ou em caso de erro, o agente continua sendo o fallback.
                    </p>
                    <p style={{ ...s.hint, color: form.plugBoletoConfigSyncedAt ? 'var(--success)' : 'var(--text-dim)' }}>
                      {form.plugBoletoConfigSyncedAt
                        ? `Credencial sincronizada automaticamente do iLux em ${new Date(form.plugBoletoConfigSyncedAt).toLocaleString('pt-BR')}.`
                        : form.plugBoletoTokenSet
                          ? 'Credencial configurada manualmente.'
                          : 'O agente envia CNPJ e token do cedente (CE_CEDENTE / CE_PARAM_CONFIG) a cada sincronização. Os campos abaixo são só para override manual.'}
                    </p>
                  </div>

                  <div style={s.field}>
                    <label style={s.label}>CNPJ do cedente</label>
                    <input
                      style={s.input}
                      value={form.plugBoletoCedenteCnpj || ''}
                      onChange={(e) => setForm({ ...form, plugBoletoCedenteCnpj: e.target.value })}
                      placeholder="Só números — CE_CEDENTE.CEDENTECPFCNPJ no iLux"
                    />
                  </div>

                  <div style={s.field}>
                    <label style={s.label}>Token do cedente (token-cedente)</label>
                    <input
                      style={s.input}
                      type="password"
                      value={form.plugBoletoToken || ''}
                      onChange={(e) => setForm({ ...form, plugBoletoToken: e.target.value })}
                      placeholder={form.plugBoletoTokenSet ? '•••••••• configurado — digite para trocar' : 'CE_CEDENTE.TOKEN_CEDENTE no iLux'}
                    />
                    <p style={s.hint}>Guardado cifrado. Não é exibido depois de salvo.</p>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem', flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ ...s.field, flex: 2 }}>
                      <label style={s.label}>URL base da API</label>
                      <input
                        style={s.input}
                        value={form.plugBoletoBaseUrl || ''}
                        onChange={(e) => setForm({ ...form, plugBoletoBaseUrl: e.target.value })}
                        placeholder="https://plugboleto.com.br/api/v1"
                      />
                    </div>
                    <div style={{ ...s.field, flex: 2 }}>
                      <label style={s.label}>Caminho de impressão</label>
                      <input
                        style={s.input}
                        value={form.plugBoletoPrintPath || ''}
                        onChange={(e) => setForm({ ...form, plugBoletoPrintPath: e.target.value })}
                        placeholder="/boletos/impressao/lote"
                      />
                    </div>
                  </div>

                  <div style={{ ...s.integrationGuide, marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <strong style={s.integrationGuideTitle}>Demonstrativo pelo CRM (sem a pasta)</strong>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)', color: 'var(--text-dim)' }}>
                        <input
                          type="checkbox"
                          checked={!!form.statementRerenderEnabled}
                          onChange={(e) => setForm({ ...form, statementRerenderEnabled: e.target.checked })}
                        />
                        Ativado
                      </label>
                    </div>
                    <p style={s.hint}>
                      Com isto ligado, o CRM gera o PDF do demonstrativo a partir dos valores fechados no iLux
                      (IXLDEMOFAT + IXLCONTRATOSFAT sincronizados pelo agente), sem exigir o PDF oficial na pasta monitorada.
                      Os números vêm do ERP — o CRM não recalcula franquia nem excedente. Se o demonstrativo ainda não
                      tiver sido sincronizado, o agente/pasta continua sendo o fallback.
                    </p>
                  </div>

              <button style={s.saveBtn} onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar configurações do agente local'}
              </button>
            </div>
          </div>

          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ ...s.cardTitle, marginBottom: '0.35rem' }}>Central do Agente Local</h2>
                <p style={{ ...s.hint, margin: 0 }}>Instalação, atualização e suporte do aplicativo que conecta o CRM ao iLux.</p>
              </div>
              <button type="button" style={s.iconButton} onClick={handleRefreshAgentInfo} disabled={agentInfoLoading} title="Atualizar informações">
                {agentInfoLoading ? '...' : 'Atualizar'}
              </button>
            </div>

            <div style={s.agentReleaseCard}>
              <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <span style={s.integrationMetaLabel}>Pacote oficial</span>
                <strong style={s.integrationMetaValue}>{agentInfo?.fileName || 'FirebirdCRMClient.exe'}</strong>
                <p style={{ ...s.hint, margin: '0.35rem 0 0' }}>
                  Versão {agentInfo?.version || 'não informada'}{agentInfo?.releasedAt ? ` · publicado em ${new Date(agentInfo.releasedAt).toLocaleDateString('pt-BR')}` : ''}
                </p>
              </div>
              <button type="button" style={{ ...s.saveBtn, marginTop: 0, whiteSpace: 'normal', flex: '0 1 auto' }} onClick={handleDownloadAgent}>
                {agentInfo?.downloadAvailable ? 'Baixar agente' : 'Abrir download externo'}
              </button>
            </div>

            {!agentInfo?.downloadAvailable && (
              <div style={s.infoBox}>
                <strong>Pacote local ainda não publicado</strong>
                <p style={{ ...s.hint, margin: '0.35rem 0 0' }}>
                  O download protegido fica disponível assim que o executável for colocado no volume persistente do EasyPanel em <code>/data/agent-releases</code>. Enquanto isso, o botão abre a cópia oficial de contingência.
                </p>
              </div>
            )}

            {agentInfo?.sha256 && (
              <div style={s.checksumBox}>
                <span style={s.integrationMetaLabel}>SHA-256</span>
                <code>{agentInfo.sha256}</code>
              </div>
            )}

            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={s.integrationMetaLabel}>Instalações ativas</span>
                {agentStatus && (
                  <span style={{ fontSize: 'var(--text-sm)', color: agentOutdatedCount > 0 ? 'var(--danger)' : 'var(--text-dim)' }}>
                    {agentStatus.agentCount} instalada(s) · {agentStatus.onlineCount} online
                    {agentOutdatedCount > 0 ? ` · ${agentOutdatedCount} desatualizada(s)` : ''}
                  </span>
                )}
              </div>

              {!agentStatus || agentInstalls.length === 0 ? (
                <p style={{ ...s.hint, margin: '0.5rem 0 0' }}>
                  Nenhuma instalação registrou ping ainda. Assim que o agente rodar e se comunicar, cada servidor aparece aqui com a versão que está executando.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.6rem' }}>
                  {agentInstalls.map((install) => (
                    <div
                      key={install.installId}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                        padding: '0.6rem 0.75rem', borderRadius: '10px',
                        border: '1px solid var(--border-color)', background: 'var(--bg-main)',
                      }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, backgroundColor: install.online ? 'var(--success)' : 'var(--danger)' }} />
                      <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text-main)', wordBreak: 'break-word' }}>
                          {install.identified
                            ? (install.hostname || `Instalação ${install.installId.slice(0, 8)}`)
                            : 'Agente sem identificador'}
                        </strong>
                        <p style={{ ...s.hint, margin: '0.15rem 0 0' }}>
                          Rodando {install.version || 'versão desconhecida'}
                          {agentPublishedVersion ? ` · publicado ${agentPublishedVersion}` : ''}
                          {install.runtime === 'python' ? ' · (execução via Python)' : ''}
                        </p>
                        <p style={{ ...s.hint, margin: '0.1rem 0 0' }}>
                          Último ping: {install.lastSeenAt ? new Date(install.lastSeenAt).toLocaleString('pt-BR') : 'nunca'}
                        </p>
                        {!install.identified && (
                          <p style={{ ...s.hint, margin: '0.1rem 0 0', color: 'var(--text-dim)' }}>
                            Atualize o agente para separar cada servidor individualmente.
                          </p>
                        )}
                      </div>
                      {install.updateAvailable && (
                        <span style={{
                          fontSize: 'var(--text-xs)', fontWeight: 600, whiteSpace: 'nowrap',
                          padding: '0.2rem 0.5rem', borderRadius: '999px',
                          color: 'var(--danger)', border: '1px solid var(--danger)',
                        }}>
                          ⚠ desatualizado
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...s.form, marginTop: '1.25rem' }}>
              <div style={s.integrationGuide}>
                <strong style={s.integrationGuideTitle}>Instalação rápida</strong>
                <ol style={s.guideList}>
                  <li>Baixe o executável e salve-o no servidor do iLux.</li>
                  <li>Abra o agente, informe o token salvo nesta tela e configure o Firebird.</li>
                  <li>Defina as pastas de Documentos financeiros e teste a conexão.</li>
                  <li>Configure a tarefa automática do Windows abaixo para o agente iniciar mesmo sem login.</li>
                </ol>
              </div>

              {isSupport && (
                <div style={s.agentStartupGuide}>
                  <div style={s.agentStartupHeader}>
                    <div>
                      <strong style={s.integrationGuideTitle}>Iniciar automaticamente, mesmo sem login</strong>
                      <p style={{ ...s.hint, margin: 0 }}>
                        Configure o agente para iniciar durante o boot do Windows e consulte os comandos de manutenção.
                      </p>
                    </div>
                    <div style={s.agentStartupActions}>
                      <span style={s.adminOnlyBadge}>Somente administradores</span>
                      <button type="button" style={s.iconButton} onClick={() => setShowAgentStartupGuide(true)}>
                        Ver instruções
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div style={s.integrationGuide}>
                <strong style={s.integrationGuideTitle}>Quando o agente travar</strong>
                <p style={{ ...s.hint, margin: '0 0 0.75rem' }}>Abra o PowerShell no servidor e execute os comandos abaixo.</p>
                {[
                  ['Verificar processo', 'Get-Process -Name "FirebirdCRMClient" -ErrorAction SilentlyContinue'],
                  ['Parar o agente', 'Stop-Process -Name "FirebirdCRMClient" -Force'],
                  ['Iniciar o agente', 'Start-Process "C:\\ILUX\\firebird-client-package\\FirebirdCRMClient.exe"'],
                ].map(([label, command]) => (
                  <div key={label} style={s.commandRow}>
                    <code style={s.commandCode}>{command}</code>
                    <button type="button" style={s.copyCommandBtn} onClick={() => handleCopyAgentCommand(command, label)}>Copiar</button>
                  </div>
                ))}
              </div>

              <div style={s.integrationGuide}>
                <strong style={s.integrationGuideTitle}>Diagnóstico e suporte</strong>
                <p style={{ ...s.hint, margin: 0 }}>Os logs ficam na pasta <code>logs\\client.log</code> dentro do diretório do agente. Antes de reiniciar, confirme se existe somente um processo FirebirdCRMClient.exe em execução.</p>
                <p style={{ ...s.hint, margin: '0.6rem 0 0' }}>Última comunicação: {form.firebirdLastSyncAt ? new Date(form.firebirdLastSyncAt).toLocaleString('pt-BR') : 'nunca registrada'}.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 10 && <PrintGuardSettings />}

      {isSupport && showAgentStartupGuide && (
        <ModalShell
          kicker="Agente Local"
          title="Inicialização automática no Windows Server"
          onClose={() => setShowAgentStartupGuide(false)}
          maxWidth="52rem"
          contentStyle={{ overflowY: 'auto' }}
        >
          <div style={s.agentStartupModalBody}>
            <p style={{ ...s.hint, margin: 0 }}>
              Este é o modo recomendado para servidores. O Agendador de Tarefas inicia o agente durante o boot do Windows, sem depender de alguém entrar no servidor.
            </p>

            <div style={s.agentStartupWarning}>
              <strong>Não use os dois modos juntos.</strong>
              <span>
                Depois de criar a tarefa, deixe desmarcada no aplicativo a opção <strong>Iniciar o agente com o Windows</strong>. A tarefa agendada substitui o atalho da pasta Inicializar e evita dois processos concorrentes.
              </span>
            </div>

            <ol style={s.guideList}>
              <li>Abra o PowerShell como Administrador no servidor do iLux.</li>
              <li>Execute a instalação abaixo e informe o mesmo usuário do Windows que acessa o Firebird e as pastas financeiras.</li>
              <li>Inicie a tarefa para testar sem reiniciar o servidor.</li>
              <li>Confirme o processo e acompanhe o arquivo <code>logs\client.log</code>.</li>
            </ol>

            {[
              ['Instalar no boot sem login', 'Set-Location "C:\\ILUX\\firebird-client-package"; powershell.exe -ExecutionPolicy Bypass -File ".\\install-scheduled-task.ps1"'],
              ['Verificar a tarefa', 'Get-ScheduledTask -TaskName "AgenteCRM iLux" -ErrorAction SilentlyContinue | Select-Object TaskName, State'],
              ['Testar agora', 'Start-ScheduledTask -TaskName "AgenteCRM iLux"'],
              ['Conferir a última execução', 'Get-ScheduledTaskInfo -TaskName "AgenteCRM iLux"'],
              ['Acompanhar o log', 'Get-Content "C:\\ILUX\\firebird-client-package\\logs\\client.log" -Tail 50'],
            ].map(([label, command]) => (
              <div key={label} style={s.commandBlock}>
                <span style={s.commandLabel}>{label}</span>
                <div style={s.commandRow}>
                  <code style={s.commandCode}>{command}</code>
                  <button type="button" style={s.copyCommandBtn} onClick={() => handleCopyAgentCommand(command, label)}>Copiar</button>
                </div>
              </div>
            ))}

            <details style={s.agentMaintenanceDetails}>
              <summary style={s.agentMaintenanceSummary}>Manutenção: parar, abrir a interface e reiniciar</summary>
              <p style={{ ...s.hint, margin: '0.75rem 0' }}>
                Nesse modo a janela e o ícone não aparecem, pois o agente roda em uma sessão separada. Antes de abrir a interface manualmente, pare a tarefa e encerre qualquer processo restante.
              </p>
              {[
                ['Parar a tarefa', 'Stop-ScheduledTask -TaskName "AgenteCRM iLux"'],
                ['Encerrar processo restante', 'Get-Process -Name "FirebirdCRMClient" -ErrorAction SilentlyContinue | Stop-Process -Force'],
                ['Abrir a interface', 'Start-Process "C:\\ILUX\\firebird-client-package\\FirebirdCRMClient.exe"'],
                ['Iniciar novamente em segundo plano', 'Start-ScheduledTask -TaskName "AgenteCRM iLux"'],
              ].map(([label, command]) => (
                <div key={label} style={s.commandBlock}>
                  <span style={s.commandLabel}>{label}</span>
                  <div style={s.commandRow}>
                    <code style={s.commandCode}>{command}</code>
                    <button type="button" style={s.copyCommandBtn} onClick={() => handleCopyAgentCommand(command, label)}>Copiar</button>
                  </div>
                </div>
              ))}
            </details>
          </div>
        </ModalShell>
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

      {editingTag && (
        <ModalShell
          kicker="Etiquetas"
          title={`Editar etiqueta: ${editingTag.name || ''}`}
          onClose={() => setEditingTag(null)}
          maxWidth="30rem"
        >
          <form onSubmit={handleUpdateTag} style={{ ...s.form, padding: 'var(--space-6)' }}>
            <div style={s.field}>
              <label style={s.label} htmlFor="edit-tag-name">Nome da etiqueta</label>
              <input
                id="edit-tag-name"
                style={s.input}
                value={tagEditForm.name}
                maxLength={80}
                onChange={(e) => setTagEditForm({ ...tagEditForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="edit-tag-color">Cor da etiqueta</label>
              <div style={s.tagEditColorRow}>
                <input
                  id="edit-tag-color"
                  type="color"
                  style={s.colorInput}
                  value={tagEditForm.color}
                  onChange={(e) => setTagEditForm({ ...tagEditForm, color: e.target.value })}
                />
                <span style={{ ...s.tagChip, background: tagEditForm.color, color: tagTextColor(tagEditForm.color) }}>{normalizeTagName(tagEditForm.name) || 'Prévia'}</span>
              </div>
            </div>
            <div style={s.tagModalActions}>
              <button type="button" style={s.iconButton} onClick={() => setEditingTag(null)}>Cancelar</button>
              <button type="submit" style={{ ...s.saveBtn, marginTop: 0 }} disabled={savingTagEdit}>{savingTagEdit ? 'Salvando...' : 'Salvar alterações'}</button>
            </div>
          </form>
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
    .settings-container .tag-header { flex-direction: column !important; }
    .settings-container .tag-stats { width: 100% !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
    .settings-container .tag-create-box { grid-template-columns: minmax(0, 1fr) 58px !important; }
    .settings-container .tag-create-box > button { grid-column: 1 / -1 !important; width: 100% !important; }
    .settings-container .tag-row { align-items: flex-start !important; flex-wrap: wrap !important; }
    .settings-container .tag-chip { max-width: calc(100% - 5rem) !important; }
    .settings-container .tag-row-actions { width: 100% !important; margin-left: 0 !important; justify-content: flex-end !important; }
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
  sections: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '1rem', alignItems: 'start', minWidth: 0 },
  card: { background: 'var(--bg-surface)', padding: '1.35rem', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: '0 10px 28px rgba(0,0,0,.08)', minWidth: 0, overflow: 'hidden' },
  cardTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 800,
    marginBottom: '1.25rem',
    color: 'var(--text-main)',
    borderBottom: '1px solid var(--border-color)',
    paddingBottom: '1rem',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
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
  hint: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: '2px', lineHeight: 'var(--leading-normal)', overflowWrap: 'anywhere', wordBreak: 'break-word' },
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
    display: 'block',
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
  agentStartupGuide: {
    padding: '1rem 1.1rem',
    borderRadius: '14px',
    background: 'var(--bg-base)',
    border: '1px solid var(--accent-border)',
  },
  agentStartupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  agentStartupActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    flexWrap: 'wrap',
  },
  agentStartupModalBody: {
    padding: 'var(--space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  adminOnlyBadge: {
    padding: '0.3rem 0.55rem',
    borderRadius: '999px',
    color: 'var(--accent)',
    background: 'var(--accent-light)',
    border: '1px solid var(--accent-border)',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  agentStartupWarning: {
    display: 'grid',
    gap: '0.25rem',
    marginTop: '0.9rem',
    padding: '0.8rem 0.9rem',
    borderRadius: '10px',
    color: 'var(--warning-text)',
    background: 'var(--warning-light)',
    border: '1px solid var(--warning-border)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.5,
  },
  commandBlock: {
    marginTop: '0.7rem',
  },
  commandLabel: {
    color: 'var(--text-muted)',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
  },
  agentMaintenanceDetails: {
    marginTop: '1rem',
    paddingTop: '0.85rem',
    borderTop: '1px solid var(--border-color)',
    color: 'var(--text-main)',
  },
  agentMaintenanceSummary: {
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 800,
  },
  iconButton: {
    background: 'var(--bg-surface)',
    color: 'var(--text-main)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '0.65rem 0.8rem',
    cursor: 'pointer',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  agentReleaseCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
    minWidth: 0,
    padding: '1rem 1.1rem',
    borderRadius: '14px',
    background: 'var(--accent-light)',
    border: '1px solid var(--accent-border)',
  },
  infoBox: {
    padding: '1rem 1.1rem',
    borderRadius: '14px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-main)',
  },
  checksumBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    padding: '0.85rem 1rem',
    borderRadius: '12px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-dim)',
    wordBreak: 'break-all',
  },
  guideList: {
    margin: '0.7rem 0 0',
    paddingLeft: '1.2rem',
    color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.7,
  },
  commandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.65rem',
    padding: '0.55rem 0.65rem',
    marginTop: '0.55rem',
    borderRadius: '10px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
  },
  commandCode: {
    minWidth: 0,
    flex: 1,
    overflowX: 'auto',
    whiteSpace: 'nowrap',
    color: 'var(--text-main)',
    fontSize: 'var(--text-xs)',
  },
  copyCommandBtn: {
    marginLeft: 'auto',
    flexShrink: 0,
    padding: '0.4rem 0.6rem',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-panel)',
    color: 'var(--text-main)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
  },
  codeArea: {
    minHeight: '260px',
    fontFamily: 'Consolas, monospace',
    fontSize: '0.82rem',
    lineHeight: 1.55,
    resize: 'vertical',
    whiteSpace: 'pre',
  },
  profilePhotoCard: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.1rem', borderRadius: '14px', background: 'var(--bg-base)', border: '1px solid var(--border-color)' },
  profilePhoto: { background: 'var(--accent)', color: 'var(--text-inverse)', borderRadius: '50%', fontSize: '1.55rem' },
  profilePhotoInfo: { minWidth: 0, display: 'grid', gap: '.35rem' },
  profilePhotoTitle: { color: 'var(--text-main)', fontSize: 'var(--text-md)' },
  profilePhotoActions: { display: 'flex', flexWrap: 'wrap', gap: '.55rem', marginTop: '.25rem' },
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
  quickRedirectHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '1.5rem',
    flexWrap: 'wrap',
    marginBottom: '1.5rem',
  },
  quickRedirectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
    gap: '0.8rem',
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
  tagHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.5rem', marginBottom: '1.5rem' },
  tagStats: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(90px, 1fr))', gap: '.55rem', flexShrink: 0 },
  tagStat: { display: 'grid', gap: '.15rem', minWidth: '90px', padding: '.7rem .8rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-base)' },
  tagCreateBox: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 70px auto', alignItems: 'end', gap: '.75rem', padding: '1rem', marginBottom: '1.25rem', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '14px' },
  tagCreateField: { display: 'grid', gap: '.5rem', minWidth: 0 },
  tagColorField: { display: 'grid', gap: '.5rem' },
  colorInput: { width: '100%', height: '43px', padding: '3px', cursor: 'pointer', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: '10px' },
  tagToolbar: { display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap', marginBottom: '.75rem' },
  tagSearchWrap: { display: 'flex', alignItems: 'center', gap: '.5rem', flex: '1 1 240px', minWidth: 0, padding: '0 .85rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-base)', color: 'var(--text-dim)' },
  tagSearchInput: { width: '100%', minWidth: 0, border: 0, outline: 0, padding: '.75rem 0', background: 'transparent', color: 'var(--text-main)', fontSize: 'var(--text-sm)' },
  tagFilterSelect: { minWidth: '130px', padding: '.75rem .8rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-base)', color: 'var(--text-main)', fontWeight: 700 },
  tagList: { display: 'grid', gap: '.65rem' },
  tagRow: { display: 'flex', alignItems: 'center', gap: '.7rem', minWidth: 0, padding: '.8rem .9rem', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-panel)' },
  tagChip: { display: 'inline-flex', alignItems: 'center', gap: '.4rem', maxWidth: 'min(50%, 320px)', padding: '.35rem .65rem', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tagChipDot: { width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', opacity: .7, flexShrink: 0 },
  tagUsageBadge: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' },
  tagRowActions: { display: 'flex', alignItems: 'center', gap: '.45rem', marginLeft: 'auto', flexShrink: 0 },
  tagEmpty: { display: 'grid', gap: '.3rem', placeItems: 'center', padding: '2rem 1rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' },
  tagEditColorRow: { display: 'flex', alignItems: 'center', gap: '.75rem' },
  tagModalActions: { display: 'flex', justifyContent: 'flex-end', gap: '.65rem', marginTop: '.5rem' },
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
