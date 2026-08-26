import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Search, Radar, Trash2, Send, CheckSquare, Square, Star,
  Phone, MapPin, Globe, Loader, XCircle, Image, CheckCircle, RotateCcw, UserPlus, Smartphone, Clock, Save,
} from 'lucide-react';
import { searchLeads, getLeads, getLeadInstances, getLeadCampaigns, getQuickResponses, getCampaignTemplates, createCampaignTemplate, createManualLeads, deleteLead, deleteAllLeads, sendToLeads, uploadLeadFile, convertLead } from '../services/api';
import { toast } from '../utils/toast';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import SurfaceCard from '../components/ui/SurfaceCard';
import EmptyState from '../components/ui/EmptyState';
import ModalShell from '../components/ui/ModalShell';

const TEMPLATE_STORAGE_KEY = 'lead-scraper-send-templates-v1';

function readStoredTemplates() {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem'));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl, fileName = 'template.png') {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/png' });
}

function isInstanceConnected(instance) {
  const status = String(instance?.status || '').trim().toLowerCase();
  return ['connected', 'open', 'online'].includes(status);
}

export default function LeadScraper() {
  const [leads, setLeads] = useState([]);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [niche, setNiche] = useState('');
  const [city, setCity] = useState('');
  const [maxResults, setMaxResults] = useState(20);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [showSendModal, setShowSendModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [sendImage, setSendImage] = useState(null);
  const [sendImagePreview, setSendImagePreview] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [delayMinSeconds, setDelayMinSeconds] = useState(8);
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(25);
  const [manualContacts, setManualContacts] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'sent' | 'unsent'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalLeads, setTotalLeads] = useState(0);
  const [skipAlreadySent, setSkipAlreadySent] = useState(true);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [sendSummary, setSendSummary] = useState(null);
  const [campaignHistory, setCampaignHistory] = useState([]);
  const [leadStats, setLeadStats] = useState({ total: 0, withPhone: 0, sent: 0, pending: 0 });
  const leadsRequestRef = useRef(0);
  const leadCacheRef = useRef(new Map());
  const sendIdempotencyRef = useRef(null);

  const loadLeads = useCallback(async () => {
    const requestId = ++leadsRequestRef.current;
    setLoading(true);
    try {
      const { data } = await getLeads({ ...(search ? { q: search } : {}), page, limit: pageSize });
      if (requestId !== leadsRequestRef.current) return;
      const rows = Array.isArray(data) ? data : data?.leads || data?.rows || data?.data || [];
      const safeRows = Array.isArray(rows) ? rows : [];
      safeRows.forEach((lead) => lead?.id && leadCacheRef.current.set(lead.id, lead));
      setLeads(safeRows);
      const pagination = data?.pagination || {};
      setTotalLeads(Number(pagination.total ?? data?.total ?? data?.count ?? safeRows.length) || 0);
      setLeadStats({
        total: Number(pagination.stats?.total ?? pagination.total ?? data?.total ?? safeRows.length) || 0,
        withPhone: Number(pagination.stats?.withPhone ?? safeRows.filter((lead) => lead.phone).length) || 0,
        sent: Number(pagination.stats?.sent ?? safeRows.filter((lead) => lead.sentAt).length) || 0,
        pending: Number(pagination.stats?.pending ?? safeRows.filter((lead) => !lead.sentAt && lead.phone && !lead.optedOutAt).length) || 0,
      });
    } catch (err) {
      console.error('[leads] erro:', err);
    } finally {
      if (requestId === leadsRequestRef.current) setLoading(false);
    }
  }, [search, page, pageSize]);

  const isFirstLoadRef = useRef(true);
  useEffect(() => {
    const firstLoad = isFirstLoadRef.current;
    isFirstLoadRef.current = false;
    // Evita disparar uma busca a cada tecla digitada no filtro
    const timer = setTimeout(() => loadLeads(), firstLoad ? 0 : 350);
    return () => clearTimeout(timer);
  }, [loadLeads]);

  useEffect(() => {
    async function loadInstances() {
      try {
        const { data } = await getLeadInstances();
        const list = Array.isArray(data) ? data : [];
        setInstances(list);
        const connected = list.find(isInstanceConnected) || list[0];
        if (connected) setSelectedInstanceId((current) => current || connected.id);
      } catch (err) {
        console.error('[leads] erro ao carregar instâncias:', err);
      }
    }
    loadInstances();
  }, []);

  const loadCampaignHistory = useCallback(async () => {
    try {
      const { data } = await getLeadCampaigns({ limit: 30 });
      setCampaignHistory(Array.isArray(data) ? data : data?.campaigns || []);
    } catch (err) {
      // Usuários sem a permissão de prospecção histórica continuam usando a
      // tela normalmente; o histórico é apenas um complemento visual.
      console.debug('[leads] histórico indisponível:', err?.response?.status || err?.message);
    }
  }, []);

  useEffect(() => { loadCampaignHistory(); }, [loadCampaignHistory]);

  useEffect(() => {
    if (!campaignHistory.some((campaign) => ['queued', 'running'].includes(String(campaign.status || '').toLowerCase()))) return undefined;
    const timer = setInterval(() => {
      loadCampaignHistory();
      loadLeads();
    }, 10000);
    return () => clearInterval(timer);
  }, [campaignHistory, loadCampaignHistory, loadLeads]);

  useEffect(() => {
    let cancelled = false;
    const local = readStoredTemplates();
    Promise.allSettled([getQuickResponses(), getCampaignTemplates()]).then((results) => {
      if (cancelled) return;
      const shared = [];
      if (results[0].status === 'fulfilled') {
        const rows = Array.isArray(results[0].value.data) ? results[0].value.data : results[0].value.data?.responses || [];
        rows.forEach((row) => shared.push({ id: `quick-${row.id}`, name: row.shortcut || row.name, message: row.message || row.body || '', source: 'Atendimento' }));
      }
      if (results[1].status === 'fulfilled') {
        const rows = Array.isArray(results[1].value.data) ? results[1].value.data : results[1].value.data?.templates || [];
        rows.forEach((row) => shared.push({ id: `campaign-${row.id}`, name: row.name || row.shortcut, message: row.body || row.message || '', source: 'Campanha' }));
      }
      const byMessage = new Map();
      [...shared, ...local].filter((item) => item?.message || item?.imageDataUrl).forEach((item) => byMessage.set(`${item.name || ''}|${item.message || ''}`, item));
      setTemplates(Array.from(byMessage.values()).slice(0, 40));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    } catch (error) {
      // Imagens em modelos locais podem exceder a cota do navegador. Preserve
      // os modelos de texto, que são suficientes para o próximo disparo.
      try {
        localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates.map((item) => ({ ...item, imageDataUrl: '' }))));
      } catch (storageError) {
        console.debug('[leads] não foi possível persistir modelos locais:', storageError?.message || error?.message);
      }
    }
  }, [templates]);

  async function handleSearch() {
    if (searching) return; // evita disparo duplicado (ex: Enter repetido durante a busca)
    if (!niche.trim()) return toast.error('Informe o nicho/tipo de empresa');
    if (!city.trim()) return toast.error('Informe a cidade');

    setSearching(true);
    try {
      const query = `${niche.trim()} em ${city.trim()}`;
      const { data } = await searchLeads({ query, maxResults });
      toast.success(data.message);
      if (page === 1) loadLeads();
      else setPage(1);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível concluir a busca. Verifique sua conexão e tente novamente.');
    } finally {
      setSearching(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteLead(id);
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      toast.success('Lead removido');
    } catch (err) {
      toast.error('Não foi possível remover o lead. Tente novamente.');
    }
  }

  async function handleConvert(id) {
    const lead = leadCacheRef.current.get(id) || leads.find((item) => item.id === id);
    if (!lead) return;
    if (lead.contactId) return toast.info('Este lead já está vinculado ao CRM.');
    const instance = selectedInstance || instances.find(isInstanceConnected);
    if (!instance) return toast.error('Conecte uma instância WhatsApp antes de vincular o lead.');

    try {
      const { data } = await convertLead(id, { instanceId: instance.id });
      const updated = data?.lead;
      if (updated?.id) {
        leadCacheRef.current.set(updated.id, updated);
        setLeads((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      }
      toast.success(data?.alreadyLinked ? 'Lead já estava vinculado ao CRM.' : 'Lead vinculado ao CRM com sucesso.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível vincular o lead ao CRM.');
    }
  }

  async function handleDeleteAll() {
    toast.confirm('Tem certeza que deseja remover TODOS os leads?', async () => {
      try {
        await deleteAllLeads();
        setLeads([]);
        setSelected(new Set());
        toast.success('Todos os leads foram removidos');
      } catch (err) {
        toast.error('Não foi possível remover os leads. Tente novamente.');
      }
    });
  }

  function toggleSelect(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleSelectAll() {
    const selectable = filteredLeads.filter((l) => l.phone && !l.optedOutAt);
    const ids = selectable.map((lead) => lead.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) return toast.error('Selecione uma imagem válida.');
    if (file.size > 25 * 1024 * 1024) return toast.error('A imagem deve ter no máximo 25 MB.');
    if (sendImagePreview?.startsWith('blob:')) URL.revokeObjectURL(sendImagePreview);
    setSendImage(file);
    setSendImagePreview(URL.createObjectURL(file));
    setSelectedTemplateId('');
  }

  function clearComposer() {
    if (sendImagePreview?.startsWith('blob:')) URL.revokeObjectURL(sendImagePreview);
    setSendMessage('');
    setSendImage(null);
    setSendImagePreview('');
    setTemplateName('');
    setSelectedTemplateId('');
  }

  async function handleSaveTemplate() {
    try {
      const name = templateName.trim();
      if (!name) return toast.error('Informe um nome para o template');
      if (!sendMessage.trim() && !sendImage) return toast.error('Escreva uma mensagem ou selecione uma imagem');

      let imageDataUrl = '';
      let imageName = '';
      let imageType = '';

      if (sendImage) {
        imageDataUrl = await fileToDataUrl(sendImage);
        imageName = sendImage.name || 'template.png';
        imageType = sendImage.type || '';
      }

      let sharedTemplate = null;
      try {
        const { data } = await createCampaignTemplate({ name, body: sendMessage.trim(), category: 'MARKETING' });
        if (data?.id) sharedTemplate = { id: `campaign-${data.id}`, name: data.name || name, message: data.body || sendMessage, source: 'Campanha' };
      } catch (error) {
        // A página pode ser usada por um perfil que possui leads.manage, mas
        // não campaigns.manage. Nesse caso, mantém o modelo local como
        // fallback, sem bloquear o disparo.
        console.debug('[leads] modelo compartilhado indisponível:', error?.response?.status || error?.message);
      }

      const nextTemplate = sharedTemplate || {
        id: selectedTemplateId || `${Date.now()}`,
        name,
        message: sendMessage,
        imageDataUrl,
        imageName,
        imageType,
        updatedAt: new Date().toISOString(),
      };

      setTemplates((prev) => {
        const filtered = prev.filter((item) => item.id !== nextTemplate.id && item.name !== name);
        return [nextTemplate, ...filtered].slice(0, 20);
      });
      setSelectedTemplateId(nextTemplate.id);
      toast.success(sharedTemplate ? 'Template salvo para a equipe' : 'Template salvo neste navegador');
    } catch (err) {
      toast.error(err.message || 'Erro ao salvar o template. Tente novamente.');
    }
  }

  async function handleApplyTemplate(templateId) {
    try {
      const template = templates.find((item) => item.id === templateId);
      if (!template) return;

      setSelectedTemplateId(template.id);
      setTemplateName(template.name || '');
      setSendMessage(template.message || '');

      if (template.imageDataUrl) {
        const file = await dataUrlToFile(template.imageDataUrl, template.imageName || 'template.png');
        setSendImage(file);
        setSendImagePreview(template.imageDataUrl);
      } else {
        setSendImage(null);
        setSendImagePreview('');
      }
    } catch (err) {
      toast.error(err.message || 'Erro ao carregar o template. Tente novamente.');
    }
  }

  function handleDeleteTemplate(templateId) {
    setTemplates((prev) => prev.filter((item) => item.id !== templateId));
    if (selectedTemplateId === templateId) {
      setSelectedTemplateId('');
      setTemplateName('');
    }
    toast.success('Template removido');
  }

  function parseManualContacts(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[;\t,]/).map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) return { name: parts[0], phone: parts[1], category: parts[2] || 'Manual' };
        return { name: parts[0], phone: parts[0], category: 'Manual' };
      });
  }

  async function handleAddManualContacts() {
    if (savingManual) return; // evita disparo duplicado
    const contacts = parseManualContacts(manualContacts);
    if (contacts.length === 0) return toast.error('Informe pelo menos um contato');

    setSavingManual(true);
    try {
      const { data } = await createManualLeads({ leads: contacts });
      toast.success(data.message || 'Contatos adicionados');
      setManualContacts('');
      setShowManualModal(false);
      loadLeads();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao adicionar contatos. Tente novamente.');
    } finally {
      setSavingManual(false);
    }
  }

  async function handleSend() {
    if (sending) return; // evita disparo duplicado enquanto um envio já está em andamento
    if (selected.size === 0) return toast.error('Selecione pelo menos um lead');
    const selectedLeads = Array.from(selected).map((id) => leadCacheRef.current.get(id) || leads.find((lead) => lead.id === id)).filter(Boolean);
    const optedOutCount = selectedLeads.filter((lead) => lead.optedOutAt).length;
    const leadsWithoutOptOut = selectedLeads.filter((lead) => !lead.optedOutAt);
    const leadsToSend = (skipAlreadySent ? leadsWithoutOptOut.filter((lead) => !lead.sentAt) : leadsWithoutOptOut).filter((lead) => lead.phone);
    if (optedOutCount > 0 && leadsToSend.length === 0) return toast.info('Os leads selecionados estão sem telefone ou optaram por não receber mensagens.');
    if (optedOutCount > 0) toast.info(`${optedOutCount} lead(s) com opt-out foram ignorados.`);
    if (skipAlreadySent && leadsToSend.length === 0) return toast.info('Todos os leads selecionados já receberam uma mensagem. Desative “não reenviar” para enviar novamente.');
    if (!sendMessage.trim() && !sendImage) return toast.error('Escreva uma mensagem ou selecione uma imagem');
    if (!selectedInstanceId) return toast.error('Escolha uma instância conectada para o envio');
    if (!isInstanceConnected(selectedInstance)) return toast.error('A instância escolhida não está conectada. Atualize a lista e tente novamente.');
    if (Number(delayMaxSeconds) < Number(delayMinSeconds)) return toast.error('O intervalo máximo precisa ser maior ou igual ao mínimo');

    const payload = {
      leadIds: leadsToSend.map((lead) => lead.id),
      message: sendMessage.trim(),
      mediaUrl: null,
      mediaType: null,
      instanceId: selectedInstanceId,
      delayMinSeconds: Number(delayMinSeconds),
      delayMaxSeconds: Number(delayMaxSeconds),
      skipAlreadySent,
      consentConfirmed,
    };

    let previewImage = sendImage;

    setSending(true);
    // A mesma chave é reutilizada se a resposta da API for perdida. Assim o
    // operador pode tentar novamente sem criar uma segunda campanha.
    if (!sendIdempotencyRef.current) {
      sendIdempotencyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    if (sendIdempotencyRef.current) payload.idempotencyKey = sendIdempotencyRef.current;

    try {
      if (previewImage) {
        const uploadRes = await uploadLeadFile(previewImage);
        payload.mediaUrl = uploadRes.data.url;
        payload.mediaType = 'image';
      }

      const { data } = await sendToLeads(payload);

      toast.success(data.message);
      setSendSummary({ ...data, sentAt: new Date().toISOString(), selected: leadsToSend.length });
      setSelected(new Set());
      loadCampaignHistory();
      setShowSendModal(false);
      setSendMessage('');
      setSendImage(null);
      if (sendImagePreview?.startsWith('blob:')) URL.revokeObjectURL(sendImagePreview);
      setSendImagePreview('');
      setTemplateName('');
      setSelectedTemplateId('');
      sendIdempotencyRef.current = null;
      loadLeads(); // Recarrega para mostrar status atualizado
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível enviar as mensagens. Tente novamente.');
    } finally {
      setSending(false);
    }
  }

  function closeSendModal() {
    if (sending) return;
    sendIdempotencyRef.current = null;
    setShowSendModal(false);
  }

  // Filtragem (memorizado para não recalcular a cada renderização, ex: ao digitar no composer)
  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter === 'sent' && !l.sentAt) return false;
      if (statusFilter === 'unsent' && l.sentAt) return false;
      if (!query) return true;
      return [l.name, l.phone, l.category, l.address, l.query]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [leads, search, statusFilter]);

  const leadsWithPhone = useMemo(() => filteredLeads.filter((l) => l.phone && !l.optedOutAt), [filteredLeads]);
  const allCurrentSelected = useMemo(() => leadsWithPhone.length > 0 && leadsWithPhone.every((lead) => selected.has(lead.id)), [leadsWithPhone, selected]);
  const totalSent = useMemo(() => leads.filter((l) => l.sentAt).length, [leads]);
  const totalUnsent = useMemo(() => leads.filter((l) => !l.sentAt && l.phone).length, [leads]);

  // Contagem de selecionados que já foram enviados (para label de reenvio)
  const selectedAlreadySent = useMemo(() => Array.from(selected).filter((id) => {
    const lead = leadCacheRef.current.get(id) || leads.find((l) => l.id === id);
    return lead?.sentAt;
  }).length, [selected, leads]);
  const selectedInstance = instances.find((inst) => inst.id === selectedInstanceId);
  const selectedInstanceLabel = selectedInstance?.instanceName?.split('_').pop()?.toUpperCase() || selectedInstance?.instanceName || 'INSTANCIA';
  const selectedInstanceStatus = isInstanceConnected(selectedInstance) ? 'conectada' : 'desconectada';

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Prospecção"
        title="Buscar Leads"
        subtitle={
          leads.length > 0
            ? `${leadStats.total ?? leads.length} leads • ${leadStats.withPhone ?? leadsWithPhone.length} com telefone • ${leadStats.sent ?? totalSent} enviados • ${leadStats.pending ?? totalUnsent} pendentes`
            : 'Encontre novos clientes buscando empresas no Google Maps.'
        }
      />

      {/* SEARCH BAR */}
      <SurfaceCard style={s.searchCard}>
        <div style={s.searchRow}>
          <div style={s.searchField}>
            <label style={s.fieldLabel}>Nicho / Tipo de empresa</label>
            <input
              style={s.input}
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Ex: dentistas, restaurantes, advogados..."
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              disabled={searching}
            />
          </div>
          <div style={s.searchField}>
            <label style={s.fieldLabel}>Cidade</label>
            <input
              style={s.input}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Ex: São Paulo, Curitiba..."
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              disabled={searching}
            />
          </div>
          <div style={s.searchField}>
            <label style={s.fieldLabel}>Máx. resultados</label>
            <select
              style={s.input}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              disabled={searching}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
            </select>
          </div>
          <ActionButton
            onClick={handleSearch}
            disabled={searching}
            style={s.searchBtn}
          >
            {searching ? <Loader size={18} className="spin" /> : <Radar size={18} />}
            {searching ? 'Buscando...' : 'Buscar'}
          </ActionButton>
        </div>
        {searching ? (
          <div style={s.searchingInfo}>
            <Loader size={16} className="spin" />
            <span>Buscando empresas no Google Maps... Isso pode levar até 30 segundos.</span>
          </div>
        ) : null}
      </SurfaceCard>

      {leads.length > 0 ? (
        <div className="lead-pipeline" style={s.pipeline} aria-label="Resumo do funil de prospecção">
          <div style={s.pipelineCard}><span style={s.pipelineLabel}>Captados</span><strong>{leadStats.total ?? totalLeads ?? leads.length}</strong><small>base disponível</small></div>
          <div style={s.pipelineCard}><span style={s.pipelineLabel}>Com telefone</span><strong>{leadStats.withPhone ?? leadsWithPhone.length}</strong><small>prontos para contato</small></div>
          <div style={s.pipelineCard}><span style={s.pipelineLabel}>Enviados</span><strong>{leadStats.sent ?? totalSent}</strong><small>com registro de envio</small></div>
          <div style={s.pipelineCard}><span style={s.pipelineLabel}>Pendentes</span><strong>{leadStats.pending ?? totalUnsent}</strong><small>aguardando campanha</small></div>
        </div>
      ) : null}

      {/* TOOLBAR */}
      {leads.length > 0 ? (
        <div style={s.toolbar}>
          <div style={s.toolbarLeft}>
            <div style={s.searchWrap}>
              <Search size={16} style={s.searchIcon} />
              <input
                style={s.filterInput}
                placeholder="Filtrar leads..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                aria-label="Filtrar leads por nome, telefone ou categoria"
              />
            </div>

            {/* STATUS FILTER PILLS */}
            <div style={s.filterPills}>
              {[
                { key: 'all', label: `Todos (${leadStats.total ?? leads.length})` },
                { key: 'unsent', label: `Pendentes (${leadStats.pending ?? totalUnsent})` },
                { key: 'sent', label: `Enviados (${leadStats.sent ?? totalSent})` },
              ].map((f) => (
                <button
                  key={f.key}
                  style={{
                    ...s.filterPill,
                    ...(statusFilter === f.key ? s.filterPillActive : {}),
                  }}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <span style={s.selectedCount}>
              {selected.size > 0 ? `${selected.size} selecionados` : ''}
            </span>
          </div>
          <div style={s.toolbarRight}>
            <ActionButton variant="secondary" onClick={() => setShowManualModal(true)} style={s.toolBtn}>
              <UserPlus size={16} />
              Adicionar manual
            </ActionButton>
            {leadsWithPhone.length > 0 ? (
              <ActionButton variant="secondary" onClick={toggleSelectAll} style={s.toolBtn}>
                {allCurrentSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                {allCurrentSelected ? 'Desmarcar página' : 'Selecionar página'}
              </ActionButton>
            ) : null}
            {selected.size > 0 ? (
              <ActionButton onClick={() => { setConsentConfirmed(false); setShowSendModal(true); }} disabled={sending} style={s.toolBtn}>
                {sending ? <Loader size={16} className="spin" /> : selectedAlreadySent > 0 ? <RotateCcw size={16} /> : <Send size={16} />}
                {sending
                  ? 'Enviando...'
                  : selectedAlreadySent > 0
                    ? `Reenviar (${selected.size})`
                    : `Enviar WhatsApp (${selected.size})`}
              </ActionButton>
            ) : null}
            <ActionButton variant="danger" onClick={handleDeleteAll} style={s.toolBtn}>
              <Trash2 size={16} />
              Limpar tudo
            </ActionButton>
          </div>
        </div>
      ) : null}

      {sendSummary ? (
        <div style={s.sendSummary} role="status">
          <div><CheckCircle size={16} /> <strong>Último disparo</strong> · {sendSummary.instance || 'instância'} · {formatDate(sendSummary.sentAt)}</div>
          <div style={s.summaryCounts}><span style={{ color: 'var(--success)' }}>{sendSummary.sent || 0} enviados</span><span style={{ color: 'var(--danger-text)' }}>{sendSummary.failed || 0} falhas</span></div>
          {sendSummary.errors?.length ? <details><summary>Ver falhas recentes</summary><ul>{sendSummary.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></details> : null}
        </div>
      ) : null}

      {campaignHistory.length > 0 ? (
        <SurfaceCard style={s.historyCard}>
          <div style={s.historyHeader}>
            <div>
              <div style={s.fieldLabel}>Acompanhamento</div>
              <h3 style={s.historyTitle}>Histórico de disparos</h3>
            </div>
            <ActionButton variant="secondary" size="sm" onClick={loadCampaignHistory}>Atualizar</ActionButton>
          </div>
          <div style={s.historyList}>
            {campaignHistory.slice(0, 8).map((campaign) => {
              const status = String(campaign.status || '').toLowerCase();
              const statusLabel = ({ queued: 'na fila', running: 'enviando', completed: 'concluída', failed: 'falhou', paused: 'pausada', cancelled: 'cancelada' })[status] || status || 'na fila';
              const sent = Number(campaign.sent || 0) + Number(campaign.delivered || 0);
              return (
                <div key={campaign.id} style={s.historyItem}>
                  <div style={s.historyMain}>
                    <strong>{campaign.name || 'Prospecção'}</strong>
                    <span>{campaign.instance?.instanceName || 'Instância'} · {formatDate(campaign.createdAt)}</span>
                  </div>
                  <div style={s.historyStats}>
                    <span style={status === 'completed' ? s.historySuccess : s.historyStatus}>{statusLabel}</span>
                    <span>{sent}/{campaign.total || 0} enviados</span>
                    {campaign.failed > 0 ? <span style={s.historyFailure}>{campaign.failed} falhas</span> : null}
                  </div>
                  <details style={s.historyAudit}>
                    <summary>Auditoria do disparo</summary>
                    <span>{campaign.audit?.authorizationRecorded ? 'Autorização registrada pelo operador' : 'Seleção manual ou por tag (sem declaração adicional)'}</span>
                    <span>{campaign.audit?.consentRequired ? 'Filtro de consentimento aplicado' : 'Filtro de consentimento não solicitado'}</span>
                    <span>{campaign.audit?.selectedLeads ?? campaign.total ?? 0} lead(s) na seleção inicial</span>
                  </details>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      ) : null}

      {/* TABLE */}
      {loading ? (
        <div style={s.loadingWrap}>Carregando leads...</div>
      ) : filteredLeads.length > 0 ? (
        <>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}></th>
                <th style={s.th}>Nome</th>
                <th style={s.th}>Telefone</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Endereço</th>
                <th style={s.th}>Categoria</th>
                <th style={s.th}>Avaliação</th>
                <th style={s.th}>Website</th>
                <th style={s.th}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => {
                const isSelected = selected.has(lead.id);
                const hasPhone = !!lead.phone;
                const hasOptedOut = !!lead.optedOutAt;
                const isSent = !!lead.sentAt;
                return (
                  <tr key={lead.id} style={{ ...s.tr, ...(isSelected ? s.trSelected : {}) }}>
                    <td style={s.td}>
                      {hasPhone && !hasOptedOut ? (
                        <button
                          style={s.checkBtn}
                          onClick={() => toggleSelect(lead.id)}
                          aria-label={`${isSelected ? 'Desmarcar' : 'Selecionar'} ${lead.name}`}
                        >
                          {isSelected ? <CheckSquare size={18} color="var(--accent)" /> : <Square size={18} />}
                        </button>
                      ) : (
                        <span style={{ opacity: 0.3 }} title={hasOptedOut ? 'Este lead optou por não receber mensagens' : 'Lead sem telefone'}><Square size={18} /></span>
                      )}
                    </td>
                    <td style={s.td}>
                      <div style={s.leadName}>{lead.name}</div>
                      <div style={s.leadQuery}>{lead.query}</div>
                    </td>
                    <td style={s.td}>
                      {lead.phone ? (
                        <a href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" style={s.phoneLink}>
                          <Phone size={14} />
                          {lead.phone}
                        </a>
                      ) : (
                        <span style={s.noData}>—</span>
                      )}
                    </td>
                    <td style={s.td}>
                      {isSent ? (
                        <div style={s.sentBadge}>
                          <CheckCircle size={14} />
                          <div>
                            <div style={{ fontWeight: 700 }}>Enviado{lead.sentCount > 1 ? ` (${lead.sentCount}x)` : ''}</div>
                            <div style={{ fontSize: '0.68rem', opacity: 0.8 }}>{formatDate(lead.sentAt)}</div>
                          </div>
                        </div>
                      ) : hasOptedOut ? (
                        <span style={s.optedOutBadge}>Opt-out</span>
                      ) : hasPhone ? (
                        <span style={s.pendingBadge}>Pendente</span>
                      ) : (
                        <span style={s.noPhoneBadge}>Sem telefone</span>
                      )}
                    </td>
                    <td style={s.td}>
                      {lead.address ? (
                        <div style={s.addressText}>
                          <MapPin size={14} style={{ flexShrink: 0 }} />
                          <span style={s.addressLine}>{lead.address}</span>
                        </div>
                      ) : (
                        <span style={s.noData}>—</span>
                      )}
                    </td>
                    <td style={s.td}>
                      {lead.category ? <span style={s.categoryPill}>{lead.category}</span> : <span style={s.noData}>—</span>}
                    </td>
                    <td style={s.td}>
                      {lead.rating ? (
                        <div style={s.ratingWrap}>
                          <Star size={14} fill="var(--warning)" color="var(--warning)" />
                          <span>{lead.rating.toFixed(1)}</span>
                        </div>
                      ) : (
                        <span style={s.noData}>—</span>
                      )}
                    </td>
                    <td style={s.td}>
                      {lead.website ? (
                        <a href={lead.website} target="_blank" rel="noopener noreferrer" style={s.websiteLink}>
                          <Globe size={14} />
                        </a>
                      ) : (
                        <span style={s.noData}>—</span>
                      )}
                    </td>
                    <td style={s.td}>
                      <div style={s.actionButtons}>
                        <button
                          style={{ ...s.convertBtn, ...(lead.contactId ? s.convertBtnDisabled : {}) }}
                          onClick={() => handleConvert(lead.id)}
                          disabled={Boolean(lead.contactId)}
                          title={lead.contactId ? 'Já vinculado ao CRM' : 'Vincular ao CRM'}
                          aria-label={lead.contactId ? `${lead.name} já vinculado ao CRM` : `Vincular ${lead.name} ao CRM`}
                        >
                          <UserPlus size={15} />
                        </button>
                        <button style={s.deleteBtn} onClick={() => handleDelete(lead.id)} title="Remover lead">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={s.pagination} aria-label="Paginação dos leads">
          <span>{totalLeads || leads.length} lead(s) encontrados</span>
          <div style={s.paginationControls}>
            <button type="button" style={s.pageButton} disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
            <span>Página {page}</span>
            <button type="button" style={s.pageButton} disabled={loading || leads.length < pageSize || (totalLeads > 0 && page * pageSize >= totalLeads)} onClick={() => setPage((value) => value + 1)}>Próxima</button>
            <select aria-label="Leads por página" style={s.pageSizeSelect} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select>
          </div>
        </div>
        </>
      ) : leads.length > 0 ? (
        <EmptyState
          icon={<Search size={24} />}
          title="Nenhum lead corresponde ao filtro"
          description="Ajuste o termo de busca ou o filtro de status para ver os demais leads."
          action={
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => { setSearch(''); setStatusFilter('all'); }}
            >
              Limpar filtros
            </ActionButton>
          }
        />
      ) : (
        <EmptyState
          icon={<Radar size={24} />}
          title="Nenhum lead encontrado"
          description="Use a barra de busca acima para encontrar empresas no Google Maps e capturar leads."
        />
      )}

      {/* SEND MODAL */}
      {showSendModal ? (
        <ModalShell
          kicker={selectedAlreadySent > 0 ? 'Reenvio' : 'Envio em massa'}
          title={`${selectedAlreadySent > 0 ? 'Reenviar' : 'Enviar'} WhatsApp para ${selected.size} lead(s)`}
          onClose={closeSendModal}
          maxWidth="76rem"
          contentStyle={s.sendModalContent}
        >
          <div className="lead-send-grid" style={s.sendGrid}>
            {selectedAlreadySent > 0 ? (
              <div style={{ ...s.resendAlert, gridColumn: '1 / -1' }}>
                <RotateCcw size={16} />
                <span>
                  <strong>{selectedAlreadySent}</strong> dos {selected.size} leads selecionados já receberam mensagem anteriormente.
                  {skipAlreadySent ? 'Eles serão ignorados para evitar duplicidade.' : 'Eles também receberão a nova mensagem.'}
                </span>
              </div>
            ) : null}

            <div style={{ ...s.selectedPreview, gridColumn: '1 / -1' }}>
              <div style={s.previewHeader}>
                <span style={s.fieldLabel}>Leads selecionados</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                  {selected.size} leads
                </span>
              </div>
              <div style={s.previewList}>
                {Array.from(selected).slice(0, 8).map((id) => {
                  const lead = leadCacheRef.current.get(id) || leads.find((l) => l.id === id);
                  if (!lead) return null;
                  return (
                    <div key={id} style={s.previewItem}>
                      <span style={s.previewName}>{lead.name}</span>
                      <span style={s.previewPhone}>{lead.phone}</span>
                      {lead.sentAt ? (
                        <span style={s.previewSent}>
                          <CheckCircle size={12} /> Já enviado
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {selected.size > 8 ? (
                  <div style={{ ...s.previewItem, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                    +{selected.size - 8} leads...
                  </div>
                ) : null}
              </div>
            </div>

            <div style={s.sendFormColumn}>
              <div style={s.sendConfigGrid}>
                <div style={s.field}>
                  <label style={s.fieldLabel}>Instância de envio</label>
                  <div style={s.selectIconWrap}>
                    <Smartphone size={16} style={s.selectIcon} />
                    <select
                      style={{ ...s.input, paddingLeft: '2.5rem' }}
                      value={selectedInstanceId}
                      onChange={(e) => setSelectedInstanceId(e.target.value)}
                    >
                      <option value="">Selecione uma instância</option>
                      {instances.map((inst) => {
                        const label = inst.instanceName?.split('_').pop()?.toUpperCase() || inst.instanceName;
                        return (
                          <option key={inst.id} value={inst.id} disabled={!isInstanceConnected(inst)}>
                            {label} {isInstanceConnected(inst) ? 'conectada' : 'desconectada'}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div style={s.field}>
                  <label style={s.fieldLabel}>Intervalo entre envios (segundos)</label>
                  <div style={s.delayInputs}>
                    <div style={s.numberInputWrap}>
                      <Clock size={15} style={s.numberInputIcon} />
                      <input
                        style={{ ...s.input, paddingLeft: '2.3rem', paddingRight: '4.25rem' }}
                        type="number"
                        min={0}
                        max={300}
                        value={delayMinSeconds}
                        onChange={(e) => setDelayMinSeconds(e.target.value)}
                      />
                      <span style={s.numberSuffix}>min seg</span>
                    </div>
                    <div style={s.numberInputWrap}>
                      <Clock size={15} style={s.numberInputIcon} />
                      <input
                        style={{ ...s.input, paddingLeft: '2.3rem', paddingRight: '4.25rem' }}
                        type="number"
                        min={0}
                        max={300}
                        value={delayMaxSeconds}
                        onChange={(e) => setDelayMaxSeconds(e.target.value)}
                      />
                      <span style={s.numberSuffix}>max seg</span>
                    </div>
                  </div>
                </div>
              </div>

              <div style={s.field}>
                <div style={s.templateRow}>
                  <div style={s.templateField}>
                    <label style={s.fieldLabel}>Template salvo</label>
                    <select
                      style={s.input}
                      value={selectedTemplateId}
                      onChange={(e) => { void handleApplyTemplate(e.target.value); }}
                    >
                      <option value="">Escolha um template</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={s.templateField}>
                    <label style={s.fieldLabel}>Nome do template</label>
                    <input
                      style={s.input}
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Ex: promoção de mídia"
                    />
                  </div>
                </div>
                <div style={s.templateActions}>
                  <ActionButton variant="secondary" onClick={() => void handleSaveTemplate()} style={s.templateActionBtn}>
                    <Save size={16} />
                    Salvar template
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    onClick={() => handleDeleteTemplate(selectedTemplateId)}
                    disabled={!selectedTemplateId}
                    style={s.templateActionBtn}
                  >
                    <Trash2 size={16} />
                    Remover
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    onClick={clearComposer}
                    style={s.templateActionBtn}
                  >
                    <XCircle size={16} />
                    Limpar
                  </ActionButton>
                </div>
              </div>

              <div style={s.safetyOptions}>
                <label style={s.checkRow}>
                  <input type="checkbox" checked={skipAlreadySent} onChange={(e) => setSkipAlreadySent(e.target.checked)} />
                  <span>Não reenviar para leads já enviados</span>
                </label>
                <label style={s.checkRow}>
                  <input type="checkbox" checked={consentConfirmed} onChange={(e) => setConsentConfirmed(e.target.checked)} />
                  <span>Registrar que possuo autorização para contatar estes leads (opcional)</span>
                </label>
                <small style={s.helpText}>Leads selecionados manualmente ou por busca podem ser enviados. O sistema bloqueia opt-outs, telefones inválidos e duplicidades; esta confirmação fica registrada para auditoria.</small>
              </div>

              <div style={s.field}>
                <label style={s.fieldLabel}>Mensagem</label>
                <textarea
                  style={s.textarea}
                  rows={6}
                  maxLength={2000}
                  value={sendMessage}
                  onChange={(e) => {
                    setSelectedTemplateId('');
                    setSendMessage(e.target.value);
                  }}
                  placeholder="Escreva a mensagem que será enviada para todos os leads selecionados..."
                />
                <div style={s.charCount}>{sendMessage.length} caracteres</div>
              </div>

              <div style={s.field}>
                <label style={s.fieldLabel}>Imagem / Promoção (opcional)</label>
                <div style={s.imageUploadArea}>
                  {sendImagePreview ? (
                    <div style={s.imagePreviewWrap}>
                      <img src={sendImagePreview} alt="Preview" style={s.imagePreview} />
                      <button
                        style={s.removeImageBtn}
                        onClick={() => {
                          setSendImage(null);
                          if (sendImagePreview?.startsWith('blob:')) URL.revokeObjectURL(sendImagePreview);
                          setSendImagePreview('');
                          setSelectedTemplateId('');
                        }}
                      >
                        <XCircle size={20} />
                      </button>
                      <div style={s.imageFileName}>
                        <Image size={14} />
                        <span style={s.imageFileNameText}>{sendImage?.name || 'Imagem selecionada'}</span>
                      </div>
                    </div>
                  ) : (
                    <label style={s.imageUploadLabel}>
                      <Image size={22} />
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Clique para anexar imagem</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '2px' }}>PNG, JPG ou WEBP — ideal para flyers e promoções</div>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={handleImageChange}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div style={s.modalFooter}>
                <ActionButton variant="secondary" onClick={closeSendModal} disabled={sending} style={{ flex: 1 }}>
                  Cancelar
                </ActionButton>
                <ActionButton onClick={handleSend} disabled={sending} style={{ flex: 2 }}>
                  {sending ? <Loader size={16} className="spin" /> : <Send size={16} />}
                  {sending
                    ? 'Enviando...'
                    : selectedAlreadySent > 0
                      ? `Reenviar para ${selected.size} leads`
                      : `Enviar para ${selected.size} leads`}
                </ActionButton>
              </div>

              <div style={s.delayNotice}>
                O envio aguardará entre {delayMinSeconds || 0} e {delayMaxSeconds || 0} segundos, sorteando um tempo diferente antes de cada próxima mensagem.
              </div>
            </div>

            <div style={s.sendPreviewColumn}>
              <div style={s.whatsappPreview}>
                <div style={s.whatsappPreviewHeader}>
                  <div style={s.whatsappIdentity}>
                    <div style={s.whatsappAvatar}>{selectedInstanceLabel.slice(0, 2)}</div>
                    <div>
                      <div style={s.whatsappTitle}>Prévia do WhatsApp</div>
                      <div style={s.whatsappSubtitle}>{selectedInstanceLabel} {selectedInstanceStatus}</div>
                    </div>
                  </div>
                  <div style={s.whatsappMeta}>
                    <span style={s.whatsappMetaDot} />
                    <span>Pronta para envio</span>
                  </div>
                </div>
                <div style={s.phonePreviewStage}>
                  <div style={s.chatStageWrap}>
                    <div style={s.chatStageHint}>Como a mensagem deve aparecer no celular</div>
                    {sendMessage.trim() ? (
                      <div style={s.messageBubbleTextPreview}>
                        <div style={s.messageTextPreview}>{sendMessage}</div>
                        <div style={s.messageTimePreview}>agora</div>
                      </div>
                    ) : null}
                    {sendImagePreview ? (
                      <div style={s.messageBubbleMediaPreview}>
                        <img src={sendImagePreview} alt="Prévia do anexo" style={s.messageImagePreview} />
                        <div style={s.messageTimePreview}>agora</div>
                      </div>
                    ) : null}
                    {!sendMessage.trim() && !sendImagePreview ? (
                      <div style={s.messageBubbleEmptyPreview}>
                        <div style={s.messageEmptyPreview}>Digite uma mensagem ou anexe uma imagem para visualizar a prévia.</div>
                        <div style={s.messageTimePreview}>agora</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {showManualModal ? (
        <ModalShell
          kicker="Contatos manuais"
          title="Adicionar contatos para prospecção"
          onClose={() => setShowManualModal(false)}
          maxWidth="34rem"
        >
          <div style={s.modalBody}>
            <div style={s.field}>
              <label style={s.fieldLabel}>Lista de contatos</label>
              <textarea
                style={s.textarea}
                rows={9}
                value={manualContacts}
                onChange={(e) => setManualContacts(e.target.value)}
                placeholder={'Um por linha. Ex:\nMaria Silva, 51999999999\nEmpresa X; 1133334444; Restaurante\n5591988887777'}
              />
              <div style={s.helpText}>Formatos aceitos: nome, telefone; nome; telefone; categoria; ou apenas telefone.</div>
            </div>
            <div style={s.modalFooter}>
              <ActionButton variant="secondary" onClick={() => setShowManualModal(false)} style={{ flex: 1 }}>
                Cancelar
              </ActionButton>
              <ActionButton onClick={handleAddManualContacts} disabled={savingManual} style={{ flex: 2 }}>
                {savingManual ? <Loader size={16} className="spin" /> : <UserPlus size={16} />}
                {savingManual ? 'Salvando...' : 'Adicionar contatos'}
              </ActionButton>
            </div>
          </div>
        </ModalShell>
      ) : null}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        .lead-send-grid { min-width: 0; }
        @media (max-width: 760px) {
          .lead-pipeline { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .lead-send-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

const s = {
  container: {
    padding: '2.5rem',
    background: 'var(--bg-base)',
    height: '100%',
    overflowY: 'auto',
    flex: 1,
    color: 'var(--text-main)',
  },
  searchCard: { padding: '1.5rem', marginBottom: '1.5rem' },
  searchRow: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  searchField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    flex: '1 1 200px',
  },
  fieldLabel: {
    fontSize: '0.72rem',
    fontWeight: 800,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '0.85rem 1rem',
    color: 'var(--text-main)',
    outline: 'none',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
  },
  searchBtn: {
    padding: '0.85rem 1.5rem',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  searchingInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.65rem',
    marginTop: '1rem',
    padding: '0.85rem 1rem',
    background: 'var(--accent-light)',
    borderRadius: '12px',
    fontSize: '0.85rem',
    color: 'var(--accent)',
    fontWeight: 700,
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  pipeline: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '0.75rem',
    marginBottom: '1rem',
  },
  pipelineCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
    padding: '0.85rem 1rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    minWidth: 0,
  },
  pipelineLabel: { fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  toolbarLeft: { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  toolbarRight: { display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' },
  sendSummary: { display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '0.8rem 1rem', background: 'var(--success-light)', border: '1px solid var(--success-border)', borderRadius: '12px', color: 'var(--text-main)', fontSize: '0.8rem' },
  summaryCounts: { display: 'flex', gap: '0.7rem', fontWeight: 800 },
  historyCard: { marginBottom: '1rem', padding: '1rem 1.15rem' },
  historyHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.8rem' },
  historyTitle: { margin: '0.2rem 0 0', fontSize: '1rem', color: 'var(--text-main)' },
  historyList: { display: 'grid', gap: '0.5rem' },
  historyItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.7rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-panel)', flexWrap: 'wrap' },
  historyMain: { display: 'grid', gap: '0.2rem', minWidth: 0 },
  historyStats: { display: 'flex', alignItems: 'center', gap: '0.65rem', color: 'var(--text-muted)', fontSize: '0.75rem', flexWrap: 'wrap' },
  historyAudit: { display: 'grid', gap: '0.2rem', flex: '1 1 100%', paddingTop: '0.45rem', borderTop: '1px dashed var(--border-color)', color: 'var(--text-dim)', fontSize: '0.72rem' },
  historyStatus: { color: 'var(--accent)', fontWeight: 800, textTransform: 'uppercase' },
  historySuccess: { color: 'var(--success)', fontWeight: 800, textTransform: 'uppercase' },
  historyFailure: { color: 'var(--danger-text)', fontWeight: 800 },
  pagination: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.75rem 0.2rem', color: 'var(--text-muted)', fontSize: '0.78rem', flexWrap: 'wrap' },
  paginationControls: { display: 'flex', alignItems: 'center', gap: '0.55rem' },
  pageButton: { border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-panel)', color: 'var(--text-main)', padding: '0.45rem 0.65rem', cursor: 'pointer', fontSize: '0.75rem' },
  pageSizeSelect: { border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-panel)', color: 'var(--text-main)', padding: '0.45rem' },
  searchWrap: { position: 'relative' },
  searchIcon: {
    position: 'absolute',
    left: '0.85rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-dim)',
  },
  filterInput: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    padding: '0.7rem 1rem 0.7rem 2.5rem',
    borderRadius: '12px',
    color: 'var(--text-main)',
    width: '200px',
    outline: 'none',
    fontSize: '0.88rem',
  },
  filterPills: {
    display: 'flex',
    gap: '0.35rem',
    background: 'var(--bg-panel)',
    borderRadius: '12px',
    padding: '3px',
    border: '1px solid var(--border-color)',
  },
  filterPill: {
    padding: '0.4rem 0.75rem',
    borderRadius: '10px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  filterPillActive: {
    background: 'var(--accent)',
    color: '#fff',
  },
  selectedCount: { fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)' },
  toolBtn: { fontSize: '0.82rem', padding: '0.6rem 1rem', whiteSpace: 'nowrap' },
  loadingWrap: { textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontWeight: 700 },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-surface)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  th: {
    textAlign: 'left',
    padding: '0.85rem 1rem',
    fontWeight: 800,
    fontSize: '0.72rem',
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--border-color)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-panel)',
  },
  tr: { borderBottom: '1px solid var(--border-color)', transition: 'background 0.15s ease' },
  trSelected: { background: 'var(--accent-light)' },
  td: { padding: '0.75rem 1rem', verticalAlign: 'middle' },
  checkBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    padding: '2px',
    display: 'flex',
  },
  leadName: {
    fontWeight: 700,
    color: 'var(--text-main)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '220px',
  },
  leadQuery: { fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '2px', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' },
  phoneLink: {
    color: 'var(--success)',
    fontWeight: 700,
    textDecoration: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    whiteSpace: 'nowrap',
    fontSize: '0.85rem',
  },
  sentBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    color: 'var(--success)',
    fontSize: '0.78rem',
  },
  pendingBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '6px',
    fontSize: '0.72rem',
    fontWeight: 700,
    background: 'rgba(214, 175, 55, 0.12)',
    color: 'var(--warning)',
    border: '1px solid rgba(214, 175, 55, 0.25)',
  },
  noPhoneBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '6px',
    fontSize: '0.72rem',
    fontWeight: 700,
    background: 'rgba(160, 160, 160, 0.1)',
    color: 'var(--text-dim)',
    border: '1px solid var(--border-color)',
  },
  optedOutBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '6px',
    fontSize: '0.72rem',
    fontWeight: 700,
    background: 'var(--danger-light, rgba(220, 68, 68, 0.1))',
    color: 'var(--danger-text, #e56b6f)',
    border: '1px solid var(--danger-border, rgba(220, 68, 68, 0.25))',
  },
  addressText: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.35rem',
    color: 'var(--text-muted)',
    maxWidth: '240px',
    fontSize: '0.82rem',
    lineHeight: 1.4,
  },
  categoryPill: {
    fontSize: '0.7rem',
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    padding: '3px 10px',
    borderRadius: '8px',
    fontWeight: 700,
    border: '1px solid var(--accent-border)',
    whiteSpace: 'nowrap',
  },
  ratingWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontWeight: 700,
    color: 'var(--warning)',
    fontSize: '0.88rem',
  },
  websiteLink: { color: 'var(--accent)', display: 'flex', alignItems: 'center' },
  noData: { color: 'var(--text-dim)', fontSize: '0.82rem' },
  actionButtons: { display: 'flex', alignItems: 'center', gap: '0.35rem' },
  convertBtn: {
    background: 'var(--accent-light)',
    border: '1px solid var(--accent-border)',
    color: 'var(--accent)',
    cursor: 'pointer',
    padding: '5px',
    borderRadius: '8px',
    display: 'flex',
    transition: 'all 0.2s',
  },
  convertBtnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '8px',
    display: 'flex',
    transition: 'color 0.2s',
  },
  modalBody: {
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
    overflowX: 'hidden',
  },
  sendModalContent: {
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
  },
  resendAlert: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.6rem',
    padding: '0.85rem 1rem',
    background: 'rgba(214, 175, 55, 0.08)',
    border: '1px solid rgba(214, 175, 55, 0.25)',
    borderRadius: '12px',
    fontSize: '0.82rem',
    color: 'var(--warning)',
    fontWeight: 600,
    lineHeight: 1.5,
  },
  selectedPreview: {
    background: 'var(--bg-base)',
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
    width: '100%',
    boxSizing: 'border-box',
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.65rem 1rem',
    borderBottom: '1px solid var(--border-color)',
  },
  previewList: {
    maxHeight: '160px',
    overflowY: 'auto',
  },
  previewItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem 1rem',
    borderBottom: '1px solid var(--border-color)',
    fontSize: '0.82rem',
  },
  previewName: { fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  previewPhone: { color: 'var(--success)', fontWeight: 600, fontSize: '0.78rem' },
  previewSent: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    color: 'var(--success)',
    fontSize: '0.7rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  templateRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem' },
  templateField: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  templateActions: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  templateActionBtn: { flex: '1 1 160px' },
  sendGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.12fr) minmax(300px, 0.88fr)',
    gap: '1rem',
    alignItems: 'start',
    minWidth: 0,
    padding: 'clamp(0.85rem, 2vw, 1.5rem)',
    boxSizing: 'border-box',
  },
  sendFormColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
    padding: '1rem',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    background: 'var(--lead-form-bg)',
  },
  sendPreviewColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
  },
  sendConfigGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '1rem',
  },
  selectIconWrap: { position: 'relative' },
  selectIcon: {
    position: 'absolute',
    left: '0.9rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-dim)',
    pointerEvents: 'none',
  },
  delayInputs: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' },
  numberInputWrap: { position: 'relative' },
  numberInputIcon: {
    position: 'absolute',
    left: '0.85rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-dim)',
    pointerEvents: 'none',
  },
  numberSuffix: {
    position: 'absolute',
    right: '0.7rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-dim)',
    fontSize: '0.66rem',
    fontWeight: 800,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  textarea: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '0.85rem 1rem',
    color: 'var(--text-main)',
    outline: 'none',
    fontSize: '0.95rem',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
  },
  charCount: {
    textAlign: 'right',
    fontSize: '0.72rem',
    color: 'var(--text-dim)',
    fontWeight: 600,
  },
  helpText: {
    fontSize: '0.74rem',
    color: 'var(--text-dim)',
    lineHeight: 1.45,
    fontWeight: 600,
  },
  imageUploadArea: {
    border: '2px dashed var(--border-color)',
    borderRadius: '12px',
    overflow: 'hidden',
    minHeight: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'border-color 0.2s',
  },
  imageUploadLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    cursor: 'pointer',
    padding: '1.5rem',
    color: 'var(--text-muted)',
    fontWeight: 700,
    fontSize: '0.88rem',
    width: '100%',
  },
  imagePreviewWrap: { position: 'relative', width: '100%' },
  imagePreview: { width: '100%', maxHeight: '220px', objectFit: 'cover', display: 'block' },
  removeImageBtn: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    background: 'rgba(0,0,0,0.65)',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    borderRadius: '50%',
    padding: '4px',
    display: 'flex',
  },
  imageFileName: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 1rem',
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
    background: 'var(--bg-panel)',
    borderTop: '1px solid var(--border-color)',
  },
  imageFileNameText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
    flex: 1,
  },
  whatsappPreview: {
    background: 'var(--lead-preview-bg)',
    borderRadius: '16px',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
    minHeight: '100%',
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  },
  whatsappPreviewHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.95rem 1rem',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--lead-preview-header-bg)',
  },
  whatsappIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    minWidth: 0,
  },
  whatsappAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #25D366, #1a8f56)',
    display: 'grid',
    placeItems: 'center',
    fontSize: '0.72rem',
    fontWeight: 900,
    color: '#07120d',
    letterSpacing: '0.02em',
    flexShrink: 0,
  },
  whatsappTitle: {
    fontSize: '0.95rem',
    fontWeight: 800,
    color: 'var(--text-main)',
    lineHeight: 1.2,
  },
  whatsappSubtitle: {
    fontSize: '0.74rem',
    color: 'var(--text-dim)',
    fontWeight: 600,
    marginTop: '0.15rem',
  },
  whatsappMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    color: 'var(--text-dim)',
    fontSize: '0.74rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  whatsappMetaDot: {
    width: '8px',
    height: '8px',
    borderRadius: '999px',
    background: '#25D366',
    boxShadow: '0 0 0 3px rgba(37, 211, 102, 0.14)',
  },
  phonePreviewStage: {
    padding: '1rem',
    background: 'var(--lead-preview-stage-bg)',
    backgroundSize: 'auto, 28px 28px, 28px 28px',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    minHeight: '420px',
    flex: 1,
  },
  chatStageWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.65rem',
    width: '100%',
    alignItems: 'flex-end',
  },
  chatStageHint: {
    alignSelf: 'flex-start',
    color: 'var(--lead-preview-hint)',
    fontSize: '0.73rem',
    fontWeight: 600,
    paddingLeft: '0.2rem',
  },
  messageBubbleTextPreview: {
    width: '100%',
    maxWidth: '430px',
    background: 'var(--lead-preview-bubble-bg)',
    color: 'var(--lead-preview-bubble-text)',
    borderRadius: '16px 16px 4px 16px',
    padding: '0.7rem',
    boxShadow: '0 14px 30px rgba(0,0,0,0.25)',
    border: '1px solid var(--lead-preview-bubble-border)',
    alignSelf: 'flex-end',
  },
  messageBubbleMediaPreview: {
    width: '100%',
    maxWidth: '430px',
    background: 'var(--lead-preview-bubble-media-bg)',
    color: 'var(--lead-preview-bubble-text)',
    borderRadius: '16px 16px 4px 16px',
    padding: '0.7rem',
    boxShadow: '0 14px 30px rgba(0,0,0,0.22)',
    border: '1px solid var(--lead-preview-media-border)',
    alignSelf: 'flex-end',
  },
  messageBubbleEmptyPreview: {
    width: '100%',
    maxWidth: '430px',
    background: 'var(--lead-preview-bubble-empty-bg)',
    color: 'var(--lead-preview-bubble-text)',
    borderRadius: '16px 16px 4px 16px',
    padding: '0.7rem',
    boxShadow: '0 14px 30px rgba(0,0,0,0.22)',
    border: '1px dashed var(--lead-preview-empty-border)',
    alignSelf: 'flex-end',
  },
  messageImagePreview: {
    width: '100%',
    aspectRatio: '4 / 3',
    maxHeight: '310px',
    objectFit: 'contain',
    display: 'block',
    borderRadius: '12px',
    background: 'var(--lead-preview-image-bg)',
    marginBottom: '0.45rem',
  },
  messageTextPreview: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    fontSize: '0.9rem',
    lineHeight: 1.45,
    padding: '0.1rem 0.2rem 0',
  },
  messageEmptyPreview: {
    color: 'var(--lead-preview-hint)',
    fontSize: '0.84rem',
    lineHeight: 1.4,
    padding: '0.35rem 0.2rem',
    fontStyle: 'italic',
  },
  messageTimePreview: {
    textAlign: 'right',
    color: 'var(--lead-preview-time)',
    fontSize: '0.68rem',
    marginTop: '0.25rem',
    paddingRight: '0.15rem',
  },
  modalFooter: {
    display: 'flex',
    gap: '0.85rem',
    paddingTop: '0.75rem',
    borderTop: '1px solid var(--border-color)',
  },
  delayNotice: {
    fontSize: '0.75rem',
    color: 'var(--text-dim)',
    textAlign: 'center',
    fontWeight: 600,
    padding: '0.35rem 0',
    lineHeight: 1.5,
  },
  safetyOptions: { display: 'grid', gap: '0.6rem', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.8rem' },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: '0.55rem', color: 'var(--text-main)', fontSize: '0.8rem', lineHeight: 1.4, cursor: 'pointer' },
};
