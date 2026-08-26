import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  History,
  Megaphone,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { toast } from '../utils/toast';
import io from 'socket.io-client';
import { SOCKET_URL } from '../services/socket';
import {
  getTags,
  createTag,
  updateContact,
  getContacts,
  sendCampaign,
  getQuickResponses,
  getCampaignInstances,
  getCampaigns,
  getCampaign,
  previewCampaign,
  createCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  retryCampaign,
  exportCampaign,
  sendCampaignTest,
  getCampaignTemplates,
  createCampaignTemplate,
  uploadFile,
} from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import SurfaceCard from '../components/ui/SurfaceCard';
import EmptyState from '../components/ui/EmptyState';
import ModalShell from '../components/ui/ModalShell';

const TYPES = [
  { value: 'PROMOTION', label: 'Promoção', description: 'Ofertas, novidades e campanhas comerciais.', consent: 'marketing' },
  { value: 'ALERT', label: 'Alerta operacional', description: 'Avisos importantes para clientes autorizados.', consent: 'alerts' },
  { value: 'COUNTER', label: 'Solicitação de contadores', description: 'Peça leituras dos equipamentos instalados.', consent: 'counters' },
  { value: 'BILLING', label: 'Cobrança financeira', description: 'Lembretes e comunicados financeiros para clientes autorizados.', consent: 'billing' },
];

const EMPTY_PROGRESS = { status: 'DRAFT', total: 0, sent: 0, delivered: 0, failed: 0, skipped: 0, pending: 0 };
const EXCLUSION_LABELS = {
  noTag: 'Fora da tag selecionada',
  duplicate: 'Número duplicado',
  invalidPhone: 'Telefone inválido ou ausente',
  noConsent: 'Sem aceite para esta finalidade',
  noEquipment: 'Sem equipamento ativo',
  optOut: 'Opt-out registrado',
};

function exclusionLabel(reason) {
  return EXCLUSION_LABELS[reason] || reason;
}

function connected(instance) {
  const status = String(instance?.status || instance?.state || '').toLowerCase();
  return ['connected', 'open', 'online'].includes(status);
}

function instanceLabel(instance) {
  if (!instance) return 'Instância não encontrada';
  const suffix = instance.instanceName?.split('_').pop();
  return `${suffix || instance.instanceName}${instance.phone ? ` — ${instance.phone}` : ''}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function normalizeCampaign(item) {
  const source = item || {};
  const progress = source.progress || {};
  return {
    ...source,
    status: source.status ? String(source.status).toUpperCase() : 'DRAFT',
    progress: {
      ...EMPTY_PROGRESS,
      ...progress,
      total: source.total ?? progress.total ?? 0,
      sent: source.sent ?? progress.sent ?? 0,
      delivered: source.delivered ?? progress.delivered ?? 0,
      failed: source.failed ?? source.errors ?? progress.failed ?? 0,
      skipped: source.skipped ?? progress.skipped ?? 0,
      pending: source.pending ?? progress.pending ?? 0,
    },
  };
}

function mergeCampaignEvent(campaign, event) {
  const currentProgress = campaign?.progress || EMPTY_PROGRESS;
  const incomingProgress = event?.progress || {};
  // O evento legado bulk_progress chama o total de SENT de "sent" (inclui
  // DELIVERED) e só informa falhas como "errors". Preserve a separação usada
  // na tela para não contar entregas duas vezes.
  const isLegacyProgress = event?.errors !== undefined && event?.failed === undefined && event?.delivered === undefined;
  const combinedSent = Number(event?.sent);
  const knownDelivered = Number(currentProgress.delivered) || 0;
  const eventSent = isLegacyProgress && Number.isFinite(combinedSent)
    ? Math.max(0, combinedSent - knownDelivered)
    : event?.sent;
  return normalizeCampaign({
    ...campaign,
    ...event,
    ...(isLegacyProgress ? { sent: eventSent } : {}),
    status: event?.status ? String(event.status).toUpperCase() : campaign?.status,
    failed: event?.failed ?? event?.errors ?? campaign?.failed,
    progress: {
      ...currentProgress,
      ...incomingProgress,
      total: event?.total ?? currentProgress.total,
      sent: eventSent ?? incomingProgress.sent ?? currentProgress.sent,
      delivered: event?.delivered ?? currentProgress.delivered,
      failed: event?.failed ?? event?.errors ?? currentProgress.failed,
      skipped: event?.skipped ?? currentProgress.skipped,
      pending: event?.pending ?? currentProgress.pending,
    },
  });
}

export default function Campaigns() {
  const [tab, setTab] = useState('compose');
  const [campaigns, setCampaigns] = useState([]);
  const [instances, setInstances] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [tag, setTag] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState('PROMOTION');
  const [instanceId, setInstanceId] = useState('');
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [delay, setDelay] = useState(5);
  const [scheduledAt, setScheduledAt] = useState('');
  const [quietStart, setQuietStart] = useState('20:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [respectQuietHours, setRespectQuietHours] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [showSaveTag, setShowSaveTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [showTest, setShowTest] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [campaignDetails, setCampaignDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState({ name: '', body: '' });
  const [savingTemplate, setSavingTemplate] = useState(false);

  const typeInfo = TYPES.find((item) => item.value === campaignType) || TYPES[0];
  const selectedInstance = instances.find((item) => item.id === instanceId);
  const currentProgress = activeCampaign?.progress || EMPTY_PROGRESS;
  const processed = (currentProgress.sent || 0) + (currentProgress.delivered || 0) + (currentProgress.failed || 0) + (currentProgress.skipped || 0);
  const percentage = currentProgress.total > 0 ? Math.min(100, (processed / currentProgress.total) * 100) : 0;
  const canEdit = !activeCampaign || ['DRAFT', 'CANCELLED', 'FAILED', 'COMPLETED'].includes(activeCampaign.status);

  const visibleCampaigns = useMemo(() => campaigns.filter((item) => {
    if (historyFilter === 'all') return true;
    return String(item.status || '').toUpperCase() === historyFilter;
  }), [campaigns, historyFilter]);

  useEffect(() => {
    loadInitial();
    const token = localStorage.getItem('token');
    const socket = io(SOCKET_URL, { auth: { token } });
    const onProgress = (data) => {
      if (data?.campaignId) {
        setCampaigns((items) => {
          const index = items.findIndex((item) => item.id === data.campaignId);
          if (index === -1) return [normalizeCampaign(data), ...items];
          return items.map((item) => item.id === data.campaignId ? mergeCampaignEvent(item, data) : item);
        });
        setActiveCampaign((item) => item?.id === data.campaignId ? mergeCampaignEvent(item, data) : item);
      }
    };
    socket.on('campaign_progress', onProgress);
    socket.on('bulk_progress', onProgress);
    socket.on('connect_error', (error) => console.warn('[campaign] websocket indisponível; atualização periódica será usada.', error.message));

    // O socket atualiza imediatamente, mas a consulta periódica cobre
    // campanhas iniciadas em outra aba, reconexões e proxies sem WebSocket.
    const refreshTimer = window.setInterval(async () => {
      try {
        const { data } = await getCampaigns();
        const next = (Array.isArray(data) ? data : data?.campaigns || []).map(normalizeCampaign);
        setCampaigns(next);
        setActiveCampaign((current) => current ? next.find((item) => item.id === current.id) || current : current);
      } catch {
        // A próxima rodada ou o socket mantém a tela atualizada.
      }
    }, 10000);

    return () => {
      window.clearInterval(refreshTimer);
      socket.disconnect();
    };
  }, []);

  async function loadInitial() {
    const results = await Promise.allSettled([getTags(), getCampaignTemplates(), getQuickResponses(), getCampaignInstances(), getCampaigns()]);
    if (results[0].status === 'fulfilled') setAvailableTags((results[0].value.data || []).map((item) => item.name));
    // Os catálogos têm finalidades diferentes: CampaignTemplate é gerenciado
    // nesta tela; QuickResponse pertence ao atendimento. Ainda assim, uma
    // resposta rápida pode servir de ponto de partida para uma campanha. Ela
    // recebe a origem e fica somente leitura; salvar como modelo cria uma
    // cópia no catálogo de campanhas. Deduplicamos pelo corpo para não exibir
    // duas opções idênticas quando o operador já fez essa cópia.
    const campaignRows = results[1].status === 'fulfilled'
      ? (Array.isArray(results[1].value.data) ? results[1].value.data : results[1].value.data?.templates || [])
      : [];
    const quickRows = results[2].status === 'fulfilled'
      ? (Array.isArray(results[2].value.data) ? results[2].value.data : results[2].value.data?.responses || [])
      : [];
    const normalizedTemplates = [
      ...campaignRows.map((item) => ({ ...item, source: 'campaign', body: item.body || item.message || '', name: item.name || item.shortcut || 'Modelo de campanha' })),
      ...quickRows.map((item) => ({ ...item, source: 'quick_response', body: item.message || item.body || '', name: item.shortcut || item.name || 'Resposta rápida' })),
    ].filter((item) => item.body.trim());
    const uniqueTemplates = [];
    const seenBodies = new Set();
    for (const item of normalizedTemplates) {
      const key = item.body.trim().toLocaleLowerCase();
      if (seenBodies.has(key)) continue;
      seenBodies.add(key);
      uniqueTemplates.push(item);
    }
    setTemplates(uniqueTemplates);
    if (results[3].status === 'fulfilled') {
      const data = results[3].value.data;
      setInstances(Array.isArray(data) ? data : data?.instances || []);
    }
    if (results[4].status === 'fulfilled') {
      const data = results[4].value.data;
      setCampaigns((Array.isArray(data) ? data : data?.campaigns || []).map(normalizeCampaign));
    }
  }

  async function searchContacts(query) {
    setSearch(query);
    if (query.trim().length < 2) return setSearchResults([]);
    try {
      const { data } = await getContacts(query);
      setSearchResults(Array.isArray(data) ? data : data?.contacts || []);
    } catch {
      setSearchResults([]);
    }
  }

  function addContact(contact) {
    if (selectedContacts.some((item) => item.id === contact.id)) return;
    setSelectedContacts((items) => [...items, contact]);
    setSearch('');
    setSearchResults([]);
    setTag('');
  }

  function insertVariable(variable) {
    setMessage((value) => `${value}${value && !value.endsWith(' ') ? ' ' : ''}${variable}`);
  }

  function payload() {
    const effectiveMessage = message.trim() || (campaignType === 'COUNTER'
      ? 'Olá, [nome]. Poderia nos enviar os contadores dos seus equipamentos?'
      : '');
    return {
      name: campaignName || `${typeInfo.label} — ${new Date().toLocaleDateString('pt-BR')}`,
      type: campaignType,
      category: campaignType === 'PROMOTION' ? 'MARKETING' : campaignType,
      instanceId,
      tag: tag || null,
      contactIds: selectedContacts.length ? selectedContacts.map((item) => item.id) : null,
      message: effectiveMessage,
      ...(attachment ? { mediaUrl: attachment.url, mediaType: attachment.mediaType, mediaMimeType: attachment.mimeType, mediaFilename: attachment.name } : {}),
      delay: Math.max(3, Number(delay) || 5),
      scheduledAt: scheduledAt || null,
      respectQuietHours,
      quietHours: respectQuietHours ? { start: quietStart, end: quietEnd } : null,
      quietHoursStart: respectQuietHours ? quietStart : null,
      quietHoursEnd: respectQuietHours ? quietEnd : null,
      consent: typeInfo.consent,
    };
  }

  async function handlePreview() {
    if (!instanceId) { toast.info('Selecione a instância de saída.'); return null; }
    if (!tag && selectedContacts.length === 0) { toast.info('Selecione uma tag ou adicione contatos.'); return null; }
    setPreviewLoading(true);
    try {
      const { data } = await previewCampaign(payload());
      const source = data?.preview || data || {};
      const summary = source.summary || {};
      const exclusions = source.exclusions || {};
      const normalized = {
        ...source,
        total: source.total ?? summary.total ?? summary.found ?? 0,
        eligible: source.eligible ?? summary.eligible ?? summary.toSend ?? summary.valid ?? summary.pending ?? 0,
        skipped: source.skipped ?? summary.skipped ?? summary.excluded ?? Object.values(exclusions).reduce((sum, value) => sum + Number(value || 0), 0),
        reasons: source.reasons || exclusions,
      };
      setPreview(normalized);
      return normalized;
    } catch (error) {
      // Compatibilidade com servidores anteriores: ainda apresenta prévia local dos contatos selecionados.
      if (selectedContacts.length) {
        const normalized = { total: selectedContacts.length, eligible: selectedContacts.length, skipped: 0, reasons: {}, recipients: selectedContacts.slice(0, 10) };
        setPreview(normalized);
        return normalized;
      } else {
      toast.error(error.response?.data?.error || 'Não foi possível calcular a prévia do público.');
      return null;
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSaveTag() {
    if (!newTagName.trim()) return toast.info('Dê um nome para a tag.');
    try {
      const { data: officialTags } = await getTags();
      let tagExists = (officialTags || []).find((item) => item.name.toLowerCase() === newTagName.trim().toLowerCase());
      if (!tagExists) {
        const { data: createdTag } = await createTag({ name: newTagName.trim(), color: '#D4AF37' });
        tagExists = createdTag;
      }
      await Promise.all(selectedContacts.map((contact) => {
        let currentTags = [];
        try { currentTags = JSON.parse(contact.tags || '[]'); } catch { currentTags = []; }
        return currentTags.includes(tagExists.name) ? null : updateContact(contact.id, { tags: [...currentTags, tagExists.name] });
      }));
      toast.success(`Grupo "${tagExists.name}" salvo.`);
      setShowSaveTag(false);
      setNewTagName('');
      setTag(tagExists.name);
      setSelectedContacts([]);
      loadInitial();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar o grupo.');
    }
  }

  function openSaveTemplate() {
    setTemplateDraft({ name: '', body: message });
    setShowSaveTemplate(true);
  }

  async function handleSaveTemplate() {
    const name = templateDraft.name.trim();
    const body = templateDraft.body.trim();
    if (!name) return toast.info('Dê um nome para o modelo.');
    if (!body) return toast.info('Escreva o conteúdo do modelo.');
    if (savingTemplate) return;
    setSavingTemplate(true);
    try {
      const { data } = await createCampaignTemplate({
        name,
        body,
        category: campaignType === 'PROMOTION' ? 'MARKETING' : campaignType,
      });
      setTemplates((items) => [data, ...items.filter((item) => item.id !== data.id)].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')));
      setMessage(body);
      setShowSaveTemplate(false);
      toast.success('Modelo salvo com sucesso.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar o modelo.');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleStart() {
    if (loading) return;
    if (!instanceId) return toast.info('Selecione uma instância de saída conectada.');
    if (!connected(selectedInstance)) return toast.warning('A instância selecionada está desconectada. Escolha uma instância online.');
    if (!tag && selectedContacts.length === 0) return toast.info('Selecione uma tag ou adicione contatos.');
    if (!message.trim() && campaignType !== 'COUNTER') return toast.info('Escreva uma mensagem.');
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) return toast.info('Escolha um horário futuro para o agendamento.');
    const audiencePreview = await handlePreview();
    if (!audiencePreview) return;
    toast.confirm(`Confirmar campanha para ${audiencePreview.eligible || audiencePreview.total || 'o público selecionado'} destinatário(s)? Os já enviados não serão duplicados.`, async () => {
      setLoading(true);
      try {
        let campaign;
        try {
          const { data } = await createCampaign(payload());
          campaign = normalizeCampaign(data?.campaign || data);
          if (campaign?.id) {
            const { data: started } = await startCampaign(campaign.id);
            campaign = normalizeCampaign(started?.campaign || started || campaign);
          }
        } catch (error) {
          // Mantém compatibilidade com a API legada enquanto o novo worker é publicado.
          if (error.response?.status !== 404 && error.response?.status !== 405) throw error;
          await sendCampaign({ ...payload(), delay: Math.max(3, Number(delay) || 5) * 1000 });
          campaign = normalizeCampaign({ id: `legacy-${Date.now()}`, status: 'RUNNING', progress: { ...EMPTY_PROGRESS, total: audiencePreview?.eligible || audiencePreview?.total || 0 } });
        }
        setActiveCampaign(campaign);
        setCampaigns((items) => [campaign, ...items.filter((item) => item.id !== campaign.id)]);
        setTab('history');
        toast.success(scheduledAt ? 'Campanha agendada com sucesso.' : 'Campanha iniciada.');
      } catch (error) {
        toast.error(error.response?.data?.error || 'Erro ao iniciar a campanha.');
      } finally {
        setLoading(false);
      }
    });
  }

  async function campaignAction(action, campaign) {
    if (!campaign?.id || String(campaign.id).startsWith('legacy-')) return toast.info('Esta campanha usa o modo compatível e não possui controles persistentes.');
    try {
      const actions = { pause: pauseCampaign, resume: resumeCampaign, cancel: cancelCampaign, retry: retryCampaign };
      const { data } = await actions[action](campaign.id);
      const next = normalizeCampaign(data?.campaign || data || { ...campaign, status: action === 'pause' ? 'PAUSED' : action === 'cancel' ? 'CANCELLED' : action === 'resume' ? 'RUNNING' : campaign.status });
      setCampaigns((items) => items.map((item) => item.id === campaign.id ? next : item));
      setActiveCampaign(next);
      toast.success(action === 'retry' ? 'Falhas enfileiradas novamente.' : 'Campanha atualizada.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível atualizar a campanha.');
    }
  }

  async function handleExport(campaign) {
    try {
      const { data } = await exportCampaign(campaign.id);
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `campanha-${campaign.name || campaign.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível exportar o histórico.');
    }
  }

  async function handleDetails(campaign) {
    setDetailsLoading(true);
    try {
      const { data } = await getCampaign(campaign.id);
      setCampaignDetails(data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'NÃ£o foi possÃ­vel carregar os detalhes.');
    } finally {
      setDetailsLoading(false);
    }
  }

  async function handleTest() {
    if (!testPhone.trim()) return toast.info('Informe o telefone de teste.');
    if (!instanceId) return toast.info('Selecione a instância de saída.');
    try {
      await sendCampaignTest({ ...payload(), phone: testPhone.trim() });
      toast.success('Mensagem de teste enviada.');
      setShowTest(false);
      setTestPhone('');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Falha no envio de teste.');
    }
  }

  async function handleAttachment(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) return toast.info('O anexo deve ter no mÃ¡ximo 25 MB.');
    setAttachmentLoading(true);
    try {
      const { data } = await uploadFile(file);
      setAttachment({
        url: data.url,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        mediaType: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document',
      });
      toast.success('Anexo carregado e pronto para a campanha.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'NÃ£o foi possÃ­vel carregar o anexo.');
    } finally {
      setAttachmentLoading(false);
    }
  }

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Automação comercial"
        title="Disparo em massa"
        subtitle="Crie campanhas seguras para avisos, promoções e solicitações de contadores, com consentimento, fila e histórico."
        actions={(
          <div style={s.headerActions}>
            <ActionButton variant="secondary" onClick={() => { loadInitial(); setTab('history'); }}><History size={16} /> Histórico</ActionButton>
            <ActionButton onClick={() => { setTab('compose'); setActiveCampaign(null); }}><Plus size={16} /> Nova campanha</ActionButton>
          </div>
        )}
      />

      <div style={s.tabs} role="tablist" aria-label="Campanhas">
        <button type="button" role="tab" aria-selected={tab === 'compose'} style={{ ...s.tab, ...(tab === 'compose' ? s.tabActive : {}) }} onClick={() => setTab('compose')}><Megaphone size={16} /> Criar campanha</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} style={{ ...s.tab, ...(tab === 'history' ? s.tabActive : {}) }} onClick={() => setTab('history')}><History size={16} /> Histórico e acompanhamento <span style={s.countBadge}>{campaigns.length}</span></button>
      </div>

      {tab === 'compose' ? (
        <div style={s.layout} className="campaign-layout">
          <SurfaceCard style={s.card}>
            <div style={s.sectionHeading}><div><span style={s.eyebrow}>1. Configuração</span><h2 style={s.sectionTitle}>Defina o disparo</h2></div><Zap size={20} color="var(--accent)" /></div>

            <label style={s.label} htmlFor="campaign-name">Nome interno da campanha</label>
            <input id="campaign-name" style={s.input} placeholder="Ex.: Aviso de manutenção — setembro" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} disabled={!canEdit} />

            <label style={s.label} htmlFor="campaign-type">Tipo de mensagem</label>
            <select id="campaign-type" style={s.input} value={campaignType} onChange={(e) => setCampaignType(e.target.value)} disabled={!canEdit}>
              {TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <p style={s.hint}>{typeInfo.description} <strong>Selecione uma tag ou contatos para autorizar o disparo; o opt-out sempre bloqueia.</strong></p>

            <label style={s.label} htmlFor="campaign-instance">Número/instância de saída <span style={s.required}>Obrigatório</span></label>
            <select id="campaign-instance" style={s.input} value={instanceId} onChange={(e) => setInstanceId(e.target.value)} disabled={!canEdit}>
              <option value="">Selecione um número conectado...</option>
              {instances.map((instance) => <option key={instance.id} value={instance.id}>{instanceLabel(instance)} — {connected(instance) ? 'Conectada' : 'Desconectada'}</option>)}
            </select>
            {instanceId && !connected(selectedInstance) ? <div style={s.warning}><AlertTriangle size={16} /> A instância selecionada não está conectada.</div> : null}

            <div style={s.divider} />
            <div style={s.sectionHeading}><div><span style={s.eyebrow}>2. Público</span><h2 style={s.sectionTitle}>Escolha quem receberá</h2></div><Users size={20} color="var(--accent)" /></div>
            <div style={s.twoCols}>
              <div>
                <label style={s.label} htmlFor="campaign-tag">Público por tag</label>
                <select id="campaign-tag" style={s.input} value={tag} onChange={(e) => { setTag(e.target.value); setSelectedContacts([]); }} disabled={!canEdit}>
                  <option value="">Selecione uma tag...</option>
                  {availableTags.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div style={{ position: 'relative' }}>
                <label style={s.label} htmlFor="campaign-search">Adicionar individualmente</label>
                <Search size={16} style={s.searchIcon} />
                <input id="campaign-search" style={{ ...s.input, paddingLeft: '2.5rem' }} placeholder="Buscar por nome ou número..." value={search} onChange={(e) => { searchContacts(e.target.value); setTag(''); }} disabled={!canEdit} />
                {search.trim().length >= 2 ? <div style={s.results}>{searchResults.length ? searchResults.map((contact) => <button type="button" key={contact.id} style={s.resultItem} onClick={() => addContact(contact)}><strong>{contact.name || contact.phone}</strong><small>{contact.phone}</small></button>) : <EmptyState title="Nenhum contato encontrado" description="Tente outro nome ou número." style={s.searchEmpty} />}</div> : null}
              </div>
            </div>
            {selectedContacts.length ? <div style={s.selectedPanel}><div style={s.selectedHeader}><strong>Contatos adicionados ({selectedContacts.length})</strong><ActionButton variant="secondary" size="sm" onClick={() => setShowSaveTag(true)}><Plus size={14} /> Salvar como grupo</ActionButton></div><div style={s.chipsWrap}>{selectedContacts.map((contact) => <span style={s.selectedChip} key={contact.id}>{contact.name || contact.phone}<button type="button" aria-label={`Remover ${contact.name || contact.phone}`} style={s.removeChip} onClick={() => setSelectedContacts((items) => items.filter((item) => item.id !== contact.id))}><X size={13} /></button></span>)}</div></div> : null}
            <div style={s.consentNotice}><CheckCircle2 size={17} /><span>A tag ou os contatos selecionados autorizam este disparo de <strong>{typeInfo.label.toLowerCase()}</strong>. O sistema remove duplicados e números inválidos; o opt-out sempre bloqueia.</span></div>
            <ActionButton variant="secondary" onClick={handlePreview} loading={previewLoading} disabled={!canEdit}><Users size={16} /> Calcular prévia do público</ActionButton>

            <div style={s.divider} />
            <div style={s.sectionHeading}><div><span style={s.eyebrow}>3. Mensagem</span><h2 style={s.sectionTitle}>Escreva e revise</h2></div><FileText size={20} color="var(--accent)" /></div>
            <div style={s.templateHeader}>
              <label style={s.label} htmlFor="campaign-template">Modelo pronto</label>
              <ActionButton variant="secondary" size="sm" onClick={openSaveTemplate} disabled={!canEdit}><FileText size={14} /> Salvar como modelo</ActionButton>
            </div>
            <select id="campaign-template" style={s.input} value="" onChange={(e) => { if (e.target.value) setMessage(e.target.value); }} disabled={!canEdit}>
              <option value="">Selecione um modelo...</option>
              {templates.map((template) => <option key={`${template.source || 'campaign'}-${template.id}`} value={template.body || template.message}>{template.source === 'quick_response' ? 'Atendimento' : 'Campanha'} · {template.shortcut || template.name} — {(template.body || template.message || '').slice(0, 55)}</option>)}
            </select>
            <label style={s.label} htmlFor="campaign-message">Mensagem</label>
            <textarea id="campaign-message" style={s.textarea} placeholder={campaignType === 'COUNTER' ? 'Ex.: Olá, [nome]. Poderia enviar os contadores dos seus equipamentos?' : 'Escreva sua mensagem aqui...'} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!canEdit} />
            <div style={s.variableRow}><span>Variáveis:</span>{['[nome]', '[empresa]', '[equipamento]', '[vencimento]'].map((variable) => <button type="button" key={variable} style={s.variableButton} onClick={() => insertVariable(variable)} disabled={!canEdit}>{variable}</button>)}</div>
            <div style={s.attachmentRow}>
              <label style={s.attachmentButton}>
                <Paperclip size={14} /> {attachmentLoading ? 'Carregando...' : 'Anexar arquivo'}
                <input type="file" hidden onChange={handleAttachment} disabled={!canEdit || attachmentLoading} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" />
              </label>
              {attachment ? <span style={s.attachmentChip}>{attachment.name}<button type="button" onClick={() => setAttachment(null)} aria-label="Remover anexo"><X size={13} /></button></span> : <small style={s.hint}>Opcional - atÃ© 25 MB</small>}
            </div>
            <div style={s.editorActions}><ActionButton variant="secondary" size="sm" onClick={() => setShowTest(true)} disabled={(!message.trim() && campaignType !== 'COUNTER') || !instanceId}><Send size={14} /> Enviar teste</ActionButton><span style={s.counter}>{message.length}/2000</span></div>

            <div style={s.divider} />
            <div style={s.twoCols}>
              <div><label style={s.label} htmlFor="campaign-delay">Intervalo entre envios (segundos)</label><input id="campaign-delay" type="number" min="3" max="120" style={s.input} value={delay} onChange={(e) => setDelay(e.target.value)} disabled={!canEdit} /></div>
              <div><label style={s.label} htmlFor="campaign-schedule">Agendar (opcional)</label><input id="campaign-schedule" type="datetime-local" style={s.input} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={!canEdit} /></div>
            </div>
            <div style={s.quietBox}><label style={s.checkRow}><input type="checkbox" checked={respectQuietHours} onChange={(e) => setRespectQuietHours(e.target.checked)} disabled={!canEdit} /><span>Respeitar horário silencioso</span></label>{respectQuietHours ? <div style={s.quietTimes}><input aria-label="Início do horário silencioso" type="time" style={s.timeInput} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /><span>até</span><input aria-label="Fim do horário silencioso" type="time" style={s.timeInput} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></div> : null}<small>Mensagens pendentes aguardam o próximo horário permitido.</small></div>
            <ActionButton onClick={handleStart} loading={loading} disabled={!canEdit || loading} fullWidth><Megaphone size={18} /> {scheduledAt ? 'Agendar campanha' : 'Iniciar campanha agora'}</ActionButton>
          </SurfaceCard>

          <div style={s.sideColumn}>
            <SurfaceCard style={s.card}>
              <div style={s.sectionHeading}><div><span style={s.eyebrow}>Prévia</span><h2 style={s.sectionTitle}>Conferência antes do envio</h2></div><Check size={20} color="var(--success-text)" /></div>
              {preview ? <><div style={s.previewStats}><div><strong>{preview.total ?? 0}</strong><small>Na seleção</small></div><div style={s.statGood}><strong>{preview.eligible ?? preview.valid ?? 0}</strong><small>Receberão</small></div><div style={s.statWarn}><strong>{preview.skipped ?? preview.excluded ?? 0}</strong><small>Não receberão</small></div></div>{preview.reasons ? <div style={s.reasonList}>{Object.entries(preview.reasons).filter(([, count]) => Number(count) > 0).map(([reason, count]) => <span key={reason}>{count} × {exclusionLabel(reason)}</span>)}</div> : null}<p style={s.hint}>Na seleção = contatos da tag/contatos escolhidos. A lista final é congelada no início da campanha e registrada no histórico.</p></> : <div style={s.emptyPreview}><Users size={28} /><p>Selecione o público e clique em <strong>Calcular prévia</strong>.</p></div>}
              <CampaignWhatsAppPreview
                instance={selectedInstance}
                message={message.trim() || (campaignType === 'COUNTER' ? 'Olá, [nome]. Poderia nos enviar os contadores dos seus equipamentos?' : '')}
                attachment={attachment}
                sampleName={selectedContacts[0]?.name || 'Cliente'}
              />
            </SurfaceCard>
            {activeCampaign ? <SurfaceCard style={s.card}><div style={s.sectionHeading}><div><span style={s.eyebrow}>Acompanhamento</span><h2 style={s.sectionTitle}>{activeCampaign.name || 'Campanha atual'}</h2></div><span style={statusStyle(activeCampaign.status)}>{activeCampaign.status}</span></div><div style={s.progressBar}><div style={{ ...s.progressFill, width: `${percentage}%` }} /></div><div style={s.progressMeta}><span>{processed} de {currentProgress.total || 0}</span><span>{Math.round(percentage)}%</span></div><div style={s.stats}><span style={{ color: 'var(--success-text)' }}>Enviadas: {(currentProgress.sent || 0) + (currentProgress.delivered || 0)}</span><span style={{ color: 'var(--danger-text)' }}>Falhas: {currentProgress.failed || 0}</span></div><div style={s.actionRow}>{['RUNNING', 'QUEUED'].includes(activeCampaign.status) ? <ActionButton variant="secondary" size="sm" onClick={() => campaignAction('pause', activeCampaign)}><Pause size={14} /> Pausar</ActionButton> : null}{activeCampaign.status === 'PAUSED' ? <ActionButton size="sm" onClick={() => campaignAction('resume', activeCampaign)}><Play size={14} /> Retomar</ActionButton> : null}{['RUNNING', 'QUEUED', 'PAUSED'].includes(activeCampaign.status) ? <ActionButton variant="danger" size="sm" onClick={() => campaignAction('cancel', activeCampaign)}><Square size={14} /> Cancelar</ActionButton> : null}{['FAILED', 'COMPLETED'].includes(activeCampaign.status) && activeCampaign.progress?.failed ? <ActionButton variant="secondary" size="sm" onClick={() => campaignAction('retry', activeCampaign)}><RotateCcw size={14} /> Reprocessar falhas</ActionButton> : null}</div></SurfaceCard> : null}
          </div>
        </div>
      ) : (
        <SurfaceCard style={s.historyCard}>
          <div style={s.historyHeader}><div><span style={s.eyebrow}>Execuções persistentes</span><h2 style={s.sectionTitle}>Histórico de campanhas</h2></div><select style={s.filterSelect} value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)}><option value="all">Todos os status</option><option value="RUNNING">Em andamento</option><option value="PAUSED">Pausadas</option><option value="COMPLETED">Concluídas</option><option value="FAILED">Com falhas</option><option value="CANCELLED">Canceladas</option></select></div>
          {visibleCampaigns.length ? <div style={s.historyList}>{visibleCampaigns.map((campaign) => { const progress = campaign.progress || EMPTY_PROGRESS; const done = (progress.sent || 0) + (progress.delivered || 0) + (progress.failed || 0) + (progress.skipped || 0); const pct = progress.total ? Math.round(done / progress.total * 100) : 0; const categoryLabel = TYPES.find((type) => type.value === campaign.type)?.label || TYPES.find((type) => type.value === campaign.category)?.label || (campaign.category === 'MARKETING' ? 'Promoção' : campaign.category) || 'Campanha'; return <article key={campaign.id} style={s.historyItem}><div style={s.historyItemMain}><div style={s.historyTitleRow}><strong>{campaign.name || 'Campanha sem nome'}</strong><span style={statusStyle(campaign.status)}>{campaign.status || 'DRAFT'}</span></div><div style={s.historyMeta}>{categoryLabel} · {instanceLabel(instances.find((item) => item.id === campaign.instanceId))} · criada {formatDate(campaign.createdAt)}</div><div style={s.smallProgress}><div style={{ ...s.progressFill, width: `${pct}%` }} /></div><div style={s.historyCounts}><span>{done}/{progress.total || 0} processados</span><span style={{ color: 'var(--success-text)' }}>{(progress.sent || 0) + (progress.delivered || 0)} enviados</span><span style={{ color: 'var(--danger-text)' }}>{progress.failed || 0} falhas</span><span>{progress.skipped || 0} excluídos</span></div></div><div style={s.actionRow}>{['RUNNING', 'QUEUED'].includes(campaign.status) ? <ActionButton variant="secondary" size="sm" onClick={() => campaignAction('pause', campaign)}><Pause size={14} /></ActionButton> : null}{campaign.status === 'PAUSED' ? <ActionButton size="sm" onClick={() => campaignAction('resume', campaign)}><Play size={14} /></ActionButton> : null}{campaign.progress?.failed ? <ActionButton variant="secondary" size="sm" onClick={() => campaignAction('retry', campaign)} title="Reprocessar falhas"><RotateCcw size={14} /></ActionButton> : null}<ActionButton variant="secondary" size="sm" onClick={() => handleExport(campaign)} title="Exportar CSV"><Download size={14} /></ActionButton></div></article>; })}</div> : <EmptyState title="Nenhuma campanha encontrada" description="As campanhas criadas aparecerão aqui com andamento e resultado por destinatário." style={s.emptyHistory} />}
        </SurfaceCard>
      )}

      {showSaveTag ? <ModalShell kicker="Salvar grupo" title="Criar grupo de contatos" onClose={() => setShowSaveTag(false)} maxWidth="28rem"><div style={s.modalBody}><p style={s.modalText}>Dê um nome para este grupo de {selectedContacts.length} contatos.</p><input autoFocus style={s.input} placeholder="Ex.: CLIENTES_MANUTENCAO" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} /><div style={s.modalFooter}><ActionButton variant="secondary" onClick={() => setShowSaveTag(false)}>Cancelar</ActionButton><ActionButton onClick={handleSaveTag}>Salvar grupo</ActionButton></div></div></ModalShell> : null}
      {showTest ? <ModalShell kicker="Mensagem de teste" title="Enviar para um número de teste" onClose={() => setShowTest(false)} maxWidth="28rem"><div style={s.modalBody}><p style={s.modalText}>A mensagem será enviada somente para este número usando a instância selecionada.</p><input autoFocus style={s.input} placeholder="5551999999999" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} /><div style={s.modalFooter}><ActionButton variant="secondary" onClick={() => setShowTest(false)}>Cancelar</ActionButton><ActionButton onClick={handleTest}>Enviar teste</ActionButton></div></div></ModalShell> : null}
      {showSaveTemplate ? <ModalShell kicker="Modelos de mensagem" title="Salvar modelo" onClose={() => setShowSaveTemplate(false)} maxWidth="34rem"><div style={s.modalBody}><p style={s.modalText}>Salve uma mensagem reutilizável para as próximas campanhas de <strong>{typeInfo.label}</strong>. As variáveis como [nome] serão preenchidas no envio.</p><label style={s.label} htmlFor="template-name">Nome do modelo</label><input id="template-name" autoFocus style={s.input} placeholder="Ex.: Aviso de manutenção" value={templateDraft.name} onChange={(e) => setTemplateDraft((draft) => ({ ...draft, name: e.target.value }))} /><label style={s.label} htmlFor="template-body">Mensagem do modelo</label><textarea id="template-body" style={{ ...s.textarea, minHeight: '130px' }} placeholder="Escreva a mensagem que será reutilizada..." value={templateDraft.body} onChange={(e) => setTemplateDraft((draft) => ({ ...draft, body: e.target.value }))} /><div style={s.modalFooter}><ActionButton variant="secondary" onClick={() => setShowSaveTemplate(false)}>Cancelar</ActionButton><ActionButton onClick={handleSaveTemplate} loading={savingTemplate}>Salvar modelo</ActionButton></div></div></ModalShell> : null}
    </div>
  );
}

function CampaignWhatsAppPreview({ instance, message, attachment, sampleName = 'Cliente' }) {
  const instanceName = instance?.instanceName?.split('_').pop()?.toUpperCase() || instance?.instanceName || 'INSTÂNCIA';
  const isConnected = connected(instance);
  const previewMessage = String(message || '')
    .replaceAll('[nome]', sampleName)
    .replaceAll('[empresa]', 'Empresa exemplo')
    .replaceAll('[equipamento]', 'Equipamento exemplo')
    .replaceAll('[vencimento]', '30/09/2026');
  const mediaType = String(attachment?.mediaType || '').toLowerCase();
  const isImage = mediaType === 'image' || String(attachment?.mimeType || '').startsWith('image/');

  return (
    <div style={s.whatsappPreview} aria-label="Prévia da mensagem no WhatsApp">
      <div style={s.whatsappPreviewHeader}>
        <div style={s.whatsappIdentity}>
          <div style={s.whatsappAvatar}>{instanceName.slice(0, 2)}</div>
          <div style={{ minWidth: 0 }}>
            <div style={s.whatsappTitle}>Prévia do WhatsApp</div>
            <div style={s.whatsappSubtitle}>{instanceName} · {isConnected ? 'conectada' : 'selecione uma instância conectada'}</div>
          </div>
        </div>
        <div style={s.whatsappMeta}>
          <span style={{ ...s.whatsappMetaDot, background: isConnected ? '#25D366' : 'var(--text-dim)' }} />
          <span style={s.whatsappMetaText}>{isConnected ? 'Pronta para envio' : 'Aguardando conexão'}</span>
        </div>
      </div>
      <div style={s.phonePreviewStage}>
        <div style={s.chatStageWrap}>
          <div style={s.chatStageHint}>Como a mensagem deve aparecer no celular</div>
          {previewMessage.trim() ? (
            <div style={s.messageBubbleTextPreview}>
              <div style={s.messageTextPreview}>{previewMessage}</div>
              <div style={s.messageTimePreview}>agora</div>
            </div>
          ) : null}
          {attachment ? (
            <div style={s.messageBubbleMediaPreview}>
              {isImage && attachment.url ? <img src={attachment.url} alt="Prévia do anexo" style={s.messageImagePreview} /> : (
                <div style={s.documentPreview}>
                  <Paperclip size={22} />
                  <span>{attachment.name || 'Arquivo anexado'}</span>
                </div>
              )}
              <div style={s.messageTimePreview}>agora</div>
            </div>
          ) : null}
          {!previewMessage.trim() && !attachment ? (
            <div style={s.messageBubbleEmptyPreview}>
              <div style={s.messageEmptyPreview}>Escreva uma mensagem ou anexe um arquivo para visualizar a prévia.</div>
              <div style={s.messageTimePreview}>agora</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function statusStyle(status) {
  const value = String(status || 'DRAFT').toUpperCase();
  const colors = { COMPLETED: ['var(--success-text)', 'var(--success-light)'], SENT: ['var(--success-text)', 'var(--success-light)'], RUNNING: ['var(--accent)', 'var(--accent-light)'], QUEUED: ['var(--accent)', 'var(--accent-light)'], PAUSED: ['var(--warning-text)', 'var(--warning-light)'], FAILED: ['var(--danger-text)', 'var(--danger-light)'], CANCELLED: ['var(--text-muted)', 'var(--bg-panel)'] };
  const [color, background] = colors[value] || colors.CANCELLED;
  return { color, background, border: `1px solid ${color}`, borderRadius: '999px', padding: '0.22rem 0.55rem', fontSize: '0.68rem', fontWeight: 800, whiteSpace: 'nowrap' };
}

const s = {
  container: { padding: 'var(--space-10)', maxWidth: '1440px', margin: '0 auto', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' },
  headerActions: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' },
  tabs: { display: 'flex', gap: '0.35rem', borderBottom: '1px solid var(--border-color)', marginBottom: 'var(--space-6)', overflowX: 'auto' },
  tab: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--text-muted)', padding: '0.85rem 1rem', cursor: 'pointer', fontWeight: 750, whiteSpace: 'nowrap' },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  countBadge: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '0.1rem 0.4rem', fontSize: '0.7rem' },
  layout: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 0.8fr)', gap: 'var(--space-6)', alignItems: 'start', width: '100%', minWidth: 0 },
  sideColumn: { display: 'grid', gap: 'var(--space-6)', minWidth: 0 },
  card: { padding: 'var(--space-6)', minWidth: 0, width: '100%', boxSizing: 'border-box' },
  sectionHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' },
  templateHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' },
  eyebrow: { display: 'block', color: 'var(--accent)', fontSize: '0.68rem', fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' },
  sectionTitle: { margin: 0, fontSize: '1.15rem', fontWeight: 850 },
  label: { display: 'block', marginBottom: '0.45rem', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  required: { color: 'var(--danger-text)', fontSize: '0.65rem', marginLeft: '0.3rem' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem 0.9rem', color: 'var(--text-main)', marginBottom: '1rem', fontSize: 'var(--text-sm)', outline: 'none' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: '145px', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.9rem', color: 'var(--text-main)', marginBottom: '0.4rem', fontSize: 'var(--text-sm)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 },
  hint: { color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.45, margin: '-0.45rem 0 1rem' },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-4)' },
  warning: { display: 'flex', alignItems: 'center', gap: '0.45rem', background: 'var(--warning-light)', color: 'var(--warning-text)', border: '1px solid var(--warning-border)', borderRadius: 'var(--radius-md)', padding: '0.7rem 0.8rem', fontSize: '0.78rem', margin: '-0.5rem 0 1rem' },
  divider: { height: 1, background: 'var(--border-color)', margin: 'var(--space-6) 0' },
  searchIcon: { position: 'absolute', top: '2.4rem', left: '0.9rem', color: 'var(--text-dim)', zIndex: 1 },
  results: { position: 'absolute', top: 'calc(100% - 1rem)', left: 0, right: 0, zIndex: 20, maxHeight: '230px', overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)' },
  resultItem: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', border: 0, borderBottom: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-main)', padding: '0.75rem 0.85rem', textAlign: 'left', cursor: 'pointer' },
  searchEmpty: { border: 0, background: 'transparent', padding: '1rem' },
  selectedPanel: { background: 'var(--bg-panel)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.8rem', marginBottom: '1rem' },
  selectedHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '0.7rem', flexWrap: 'wrap', fontSize: '0.8rem' },
  chipsWrap: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  selectedChip: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', maxWidth: '100%', background: 'var(--accent-light)', border: '1px solid var(--accent-border)', borderRadius: '999px', color: 'var(--accent)', fontSize: '0.72rem', padding: '0.35rem 0.55rem' },
  removeChip: { display: 'inline-flex', alignItems: 'center', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 },
  consentNotice: { display: 'flex', gap: '0.55rem', alignItems: 'flex-start', color: 'var(--text-muted)', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem 0.85rem', margin: '0 0 1rem', fontSize: '0.76rem', lineHeight: 1.45 },
  variableRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.8rem' },
  variableButton: { border: '1px solid var(--border-color)', borderRadius: '999px', color: 'var(--accent)', background: 'var(--bg-panel)', cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.7rem' },
  attachmentRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', margin: '0.1rem 0 0.7rem' },
  attachmentButton: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', color: 'var(--text-main)', padding: '0.5rem 0.7rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 },
  attachmentChip: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', maxWidth: '100%', border: '1px solid var(--accent-border)', borderRadius: '999px', background: 'var(--accent-light)', color: 'var(--accent)', padding: '0.35rem 0.6rem', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis' },
  editorActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '1rem' },
  counter: { fontSize: '0.72rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.82rem', fontWeight: 700 },
  quietTimes: { display: 'flex', alignItems: 'center', gap: '0.55rem', color: 'var(--text-muted)', fontSize: '0.78rem' },
  timeInput: { background: 'var(--bg-base)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.45rem' },
  quietBox: { display: 'grid', gap: '0.65rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', padding: '0.85rem', marginBottom: '1rem' },
  previewStats: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' },
  statGood: { color: 'var(--success-text)' }, statWarn: { color: 'var(--warning-text)' },
  emptyPreview: { display: 'grid', justifyItems: 'center', textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 1rem', background: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' },
  messagePreview: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.8rem', marginTop: '1rem' },
  whatsappPreview: { background: 'var(--lead-preview-bg)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', minHeight: '420px', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', marginTop: '1rem' },
  whatsappPreviewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.85rem 0.9rem', borderBottom: '1px solid var(--border-color)', background: 'var(--lead-preview-header-bg)', minWidth: 0 },
  whatsappIdentity: { display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 },
  whatsappAvatar: { width: '38px', height: '38px', borderRadius: '12px', background: 'linear-gradient(135deg, #25D366, #1a8f56)', display: 'grid', placeItems: 'center', fontSize: '0.7rem', fontWeight: 900, color: '#07120d', letterSpacing: '0.02em', flexShrink: 0 },
  whatsappTitle: { fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.2 },
  whatsappSubtitle: { fontSize: '0.68rem', color: 'var(--text-dim)', fontWeight: 600, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '190px' },
  whatsappMeta: { display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  whatsappMetaText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  whatsappMetaDot: { width: '7px', height: '7px', borderRadius: '999px', background: '#25D366', boxShadow: '0 0 0 3px rgba(37, 211, 102, 0.14)' },
  phonePreviewStage: { padding: '0.9rem', background: 'var(--lead-preview-stage-bg)', backgroundSize: 'auto, 28px 28px, 28px 28px', display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', minHeight: '325px', flex: 1 },
  chatStageWrap: { display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%', alignItems: 'flex-end' },
  chatStageHint: { alignSelf: 'flex-start', color: 'var(--lead-preview-hint)', fontSize: '0.68rem', fontWeight: 600, paddingLeft: '0.15rem' },
  messageBubbleTextPreview: { width: '100%', maxWidth: '360px', background: 'var(--lead-preview-bubble-bg)', color: 'var(--lead-preview-bubble-text)', borderRadius: '15px 15px 4px 15px', padding: '0.65rem', boxShadow: '0 12px 24px rgba(0,0,0,0.2)', border: '1px solid var(--lead-preview-bubble-border)', alignSelf: 'flex-end' },
  messageBubbleMediaPreview: { width: '100%', maxWidth: '360px', background: 'var(--lead-preview-bubble-media-bg)', color: 'var(--lead-preview-bubble-text)', borderRadius: '15px 15px 4px 15px', padding: '0.65rem', boxShadow: '0 12px 24px rgba(0,0,0,0.18)', border: '1px solid var(--lead-preview-media-border)', alignSelf: 'flex-end' },
  messageBubbleEmptyPreview: { width: '100%', maxWidth: '360px', background: 'var(--lead-preview-bubble-empty-bg)', color: 'var(--lead-preview-bubble-text)', borderRadius: '15px 15px 4px 15px', padding: '0.65rem', boxShadow: '0 12px 24px rgba(0,0,0,0.18)', border: '1px dashed var(--lead-preview-empty-border)', alignSelf: 'flex-end' },
  messageImagePreview: { width: '100%', aspectRatio: '4 / 3', maxHeight: '230px', objectFit: 'contain', display: 'block', borderRadius: '11px', background: 'var(--lead-preview-image-bg)', marginBottom: '0.35rem' },
  documentPreview: { display: 'flex', alignItems: 'center', gap: '0.55rem', minHeight: '64px', padding: '0.7rem', borderRadius: '10px', background: 'var(--lead-preview-image-bg)', color: 'var(--lead-preview-bubble-text)', fontSize: '0.75rem', fontWeight: 700, overflowWrap: 'anywhere' },
  messageTextPreview: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', fontSize: '0.82rem', lineHeight: 1.45, padding: '0.1rem 0.15rem 0' },
  messageEmptyPreview: { color: 'var(--lead-preview-hint)', fontSize: '0.78rem', lineHeight: 1.4, padding: '0.3rem 0.15rem', fontStyle: 'italic' },
  messageTimePreview: { textAlign: 'right', color: 'var(--lead-preview-time)', fontSize: '0.64rem', marginTop: '0.2rem', paddingRight: '0.1rem' },
  reasonList: { display: 'grid', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.73rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' },
  progressBar: { height: 9, overflow: 'hidden', borderRadius: 999, background: 'var(--border-color)' },
  progressFill: { height: '100%', borderRadius: 999, background: 'var(--accent)', transition: 'width 0.3s ease' },
  progressMeta: { display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.4rem' },
  stats: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', margin: '0.8rem 0', fontSize: '0.75rem', fontWeight: 700, flexWrap: 'wrap' },
  actionRow: { display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', flexWrap: 'wrap' },
  historyCard: { padding: 'var(--space-6)' },
  historyHeader: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' },
  filterSelect: { background: 'var(--bg-base)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.7rem 0.8rem' },
  historyList: { display: 'grid', gap: '0.65rem' },
  historyItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', background: 'var(--bg-panel)' },
  historyItemMain: { minWidth: 0, flex: 1 },
  historyTitleRow: { display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', marginBottom: '0.35rem' },
  historyMeta: { color: 'var(--text-muted)', fontSize: '0.73rem', marginBottom: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  smallProgress: { height: 6, background: 'var(--border-color)', overflow: 'hidden', borderRadius: 999 },
  historyCounts: { display: 'flex', gap: '0.8rem', color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.45rem', flexWrap: 'wrap' },
  emptyHistory: { padding: '3rem 1rem', border: 0, background: 'transparent' },
  modalBody: { padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' },
  modalText: { color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.4rem' },
};
