import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import api, {
  getTickets,
  getMessages,
  sendMessage,
  sendMediaMessage,
  assignTicket,
  resolveTicket,
  getMe,
  getUsers,
  getTeams,
  summarizeTicket,
  reopenTicket,
  getQuickResponses,
  useQuickResponse,
  scheduleMessage,
  sendAudioMessage,
  deleteMessage,
  getSettings,
  forwardMessage,
  createTicketNote,
  updateTicketPreferences,
} from '../services/api';
import { toast } from '../utils/toast';
import { useIsMobile } from '../hooks/useIsMobile';
import CreateOsModal from '../components/CreateOsModal';
import LinkContactModal from '../components/LinkContactModal';
import InstanceSelectionModal from '../components/InstanceSelectionModal';
import { CrmCustomerProfileModal } from './CRM';
import { ChatHeader, ContactPanel, ForwardModal, MessageComposer, MessageList, TicketSidebar, TransferModal } from './inbox/components';
import { Empty } from './inbox/helpers.jsx';
import { useInboxMessages, useInboxRealtime, useInboxTickets } from './inbox/hooks';
import { usePermissions } from '../auth/PermissionContext';

class InboxSectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erro desconhecido',
    };
  }

  componentDidCatch(error) {
    console.error(`[inbox] erro no bloco ${this.props.label}:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            margin: 'var(--space-4) var(--space-8)',
            padding: 'var(--space-4) var(--space-5)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--warning-light)',
            border: '1px solid var(--warning-border)',
            color: 'var(--warning-text)',
            fontWeight: 700,
            lineHeight: 'var(--leading-normal)',
          }}
        >
          Não foi possível exibir a seção "{this.props.label}" desta conversa, mas o restante da tela continua disponível. Tente recarregar a página; se o problema continuar, avise o suporte.
          <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600, opacity: 0.92 }}>
            Detalhes técnicos: {this.state.errorMessage}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function Inbox() {
  const { can } = usePermissions();
  const MESSAGE_PAGE_SIZE = 60;
  const [selectedId, setSelectedId] = useState(null);
  const [text, setText] = useState('');
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [transferModal, setTransferModal] = useState(false);
  const [linkModal, setLinkModal] = useState(false);
  const [showOsModal, setShowOsModal] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState(null);
  const [files, setFiles] = useState([]);
  const [quickResponses, setQuickResponses] = useState([]);
  const [filteredQuick, setFilteredQuick] = useState([]);
  const [showScheduling, setShowScheduling] = useState(false);
  const [scheduleData, setScheduleData] = useState({ body: '', sendAt: '' });
  const [previewImg, setPreviewImg] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [view, setView] = useState('list'); // 'list' or 'chat'
  const [updateTrigger, setUpdateTrigger] = useState(0); // Forca atualizacao de componentes filhos
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [isNote, setIsNote] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [showReopenInstanceModal, setShowReopenInstanceModal] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [crmProfile, setCrmProfile] = useState(null);
  const [crmProfileTab, setCrmProfileTab] = useState('overview');
  const [isCompactDesktop, setIsCompactDesktop] = useState(() => window.innerWidth > 768 && window.innerWidth <= 1440);
  const openOsHandledRef = useRef(false);
  const isMobile = useIsMobile();
  const { instances } = useOutletContext() || { instances: [] };
  const navigate = useNavigate();

  useEffect(() => {
    const updateViewportMode = () => setIsCompactDesktop(window.innerWidth > 768 && window.innerWidth <= 1440);
    window.addEventListener('resize', updateViewportMode);
    return () => window.removeEventListener('resize', updateViewportMode);
  }, []);

  // Volta para a lista quando a janela retorna ao desktop
  useEffect(() => {
    if (!isMobile) setView('list');
  }, [isMobile]);

  const scrollRef = useRef();
  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const shouldScrollToBottomRef = useRef(false);
  const selectedIdRef = React.useRef(selectedId);
  const historySearchRef = React.useRef(historySearch);
  const previewDragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const sendLockRef = useRef(false); // evita duplo envio (duplo clique/duplo Enter) da mesma mensagem

  const {
    counts,
    debouncedLoadTickets,
    filters,
    loadTickets,
    search,
    setFilters,
    setSearch,
    setTab,
    setTickets,
    tab,
    tickets,
    upsertTicket,
  } = useInboxTickets({ me });

  const {
    handleLoadMoreMessages,
    hasMoreMessages,
    loadMessages,
    loading,
    loadingMoreMessages,
    messages,
    setMessages,
  } = useInboxMessages({
      messagePageSize: MESSAGE_PAGE_SIZE,
      historySearch,
      scrollRef,
      selectedId,
    selectedIdRef,
    setSummary,
    shouldScrollToBottomRef,
  });

  function normalizeText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null) return '';

    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { sampleRate: 44100, channelCount: 1 } 
      });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        const mimeType = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus') 
          ? 'audio/ogg; codecs=opus' 
          : MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
            ? 'audio/webm; codecs=opus'
            : 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        try {
          await sendAudioMessage(selectedId, blob);
          loadMessages({ background: true });
        } catch (e) { toast.error('Erro ao enviar áudio: ' + (e.response?.data?.error || e.message)); }
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch (e) { toast.error('Permissao de microfone negada'); }
  }

  function stopRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { historySearchRef.current = historySearch; }, [historySearch]);
  useEffect(() => {
    loadTickets();
    const params = new URLSearchParams(window.location.search);
    const tId = params.get('ticketId');
    if (tId) setSelectedId(tId);
  }, [tab, filters]);

  // A busca so filtrava a lista ja carregada localmente (uma amostra da aba
  // atual) - clientes fora dela nunca apareciam, mesmo existindo. Sem isso,
  // eventos em tempo real tambem podiam remover silenciosamente conversas da
  // lista local enquanto a busca estava ativa, e ao limpar a busca elas nao
  // voltavam sozinhas (so trocando de aba, que forcava um recarregamento).
  useEffect(() => {
    if (!search) {
      loadTickets();
      return;
    }
    const timer = setTimeout(() => {
      loadTickets();
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (selectedId) loadMessages();
  }, [selectedId, historySearch]);

  useEffect(() => {
    if (shouldScrollToBottomRef.current) {
      shouldScrollToBottomRef.current = false;
      scrollToBottom();
    }
  }, [messages]);

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);
  }

  function openPreviewImage(url) {
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
    setPreviewImg(url);
  }

  function closePreviewImage() {
    setPreviewImg(null);
    setPreviewZoom(1);
    setPreviewOffset({ x: 0, y: 0 });
  }

  function handlePreviewWheel(event) {
    event.preventDefault();
    setPreviewZoom((previous) => {
      const next = previous + (event.deltaY < 0 ? 0.12 : -0.12);
      const normalized = Math.min(4, Math.max(0.6, Number(next.toFixed(2))));
      if (normalized <= 1) setPreviewOffset({ x: 0, y: 0 });
      return normalized;
    });
  }

  function handlePreviewPointerDown(event) {
    if (previewZoom <= 1) return;
    event.preventDefault();
    previewDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewOffset.x,
      originY: previewOffset.y,
    };
  }

  function handlePreviewPointerMove(event) {
    if (!previewDragRef.current.active) return;

    const deltaX = event.clientX - previewDragRef.current.startX;
    const deltaY = event.clientY - previewDragRef.current.startY;

    setPreviewOffset({
      x: previewDragRef.current.originX + deltaX,
      y: previewDragRef.current.originY + deltaY,
    });
  }

  function handlePreviewPointerUp() {
    previewDragRef.current.active = false;
  }

  const [botName, setBotName] = useState('Robo');

  const loadInitial = useCallback(async () => {
    try {
      // getMe e o unico critico para sair do loop de sincronizacao
      const { data: meData } = await getMe();
      setMe(meData);

      // Carrega o restante em paralelo sem bloquear se um falhar
      Promise.all([
        getUsers().then(r => setUsers(r.data || [])).catch(e => console.error('getUsers error:', e)),
        getTeams().then(r => setTeams(r.data || [])).catch(e => console.error('getTeams error:', e)),
        getQuickResponses().then(r => setQuickResponses(r.data || [])).catch(e => console.error('getQuickResponses error:', e)),
        getSettings().then(r => {
          if (r.data?.botName) setBotName(r.data.botName);
        }).catch(e => console.error('getSettings error:', e))
      ]);
    } catch (e) {
      console.error('Erro critico ao carregar perfil:', e);
      // Se nem o getMe funcionar, o interceptor 401 do axios provavelmente vai redirecionar para o login
    }
  }, []);

  useInboxRealtime({
    debouncedLoadTickets,
    historySearchRef,
    loadInitial,
    loadMessages,
    loadTickets,
    selectedIdRef,
    setMessages,
    setTickets,
    shouldScrollToBottomRef,
    upsertTicket,
  });

  async function handleDeleteMessage(msgId) {
    toast.confirm(
      'Deseja apagar esta mensagem para o cliente? (Ela continuara visivel e riscada para voce)',
      async () => {
        try {
          const { data: deletedMessage } = await deleteMessage(selectedId, msgId);
          setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...deletedMessage, isDeleted: true } : m));
          toast.success('Mensagem apagada.');
        } catch (e) {
          toast.error('Erro ao apagar mensagem: ' + (e.response?.data?.error || e.message));
        }
      }
    );
  }

  async function handleCopyMessage(message) {
    const parts = [];
    const quotedText = normalizeText(message.quotedMsgBody);
    const bodyText = normalizeText(message.body);
    const transcriptionText = normalizeText(message.transcription);

    if (quotedText) parts.push(`Respondendo: ${quotedText}`);
    if (bodyText) parts.push(bodyText);
    if (transcriptionText) parts.push(`Transcricao: ${transcriptionText}`);
    if (!parts.length) return toast.info('Nada para copiar nesta mensagem');

    try {
      await navigator.clipboard.writeText(parts.join('\n\n'));
      toast.success('Texto copiado');
    } catch (e) {
      toast.error('Nao foi possivel copiar o texto');
    }
  }

  async function handleSend(e) {
    e?.preventDefault();
    if (!text.trim() && files.length === 0) return;
    if (sendLockRef.current) return; // ignora clique/Enter duplicado enquanto o envio anterior ainda esta em andamento
    sendLockRef.current = true;
    setTimeout(() => { sendLockRef.current = false; }, 400);

    if (isNote) {
      const noteBody = text;
      const noteTicketId = selectedId;
      setText('');
      setFiles([]);
      setIsNote(false);
      try {
        await createTicketNote(selectedId, noteBody);
        loadMessages({ background: true });
      } catch (err) {
        // Mantem o texto no campo para o atendente nao perder a nota e poder tentar salvar novamente
        if (selectedIdRef.current === noteTicketId) setText(noteBody);
        toast.error('Falha ao salvar a nota. O texto foi mantido no campo — verifique a conexão e tente novamente. ' + (err.response?.data?.error || err.message));
      }
      return;
    }

    if (files.length > 0) {
      const currentFiles = [...files];
      const currentText = text;
      const qId = replyingTo?.externalId;
      setText('');
      setFiles([]);
      setReplyingTo(null);
      
      toast.info(`Enviando ${currentFiles.length} anexo(s) em segundo plano...`);
      (async () => {
        for (let i = 0; i < currentFiles.length; i++) {
          try {
            await sendMediaMessage(selectedId, currentFiles[i], i === 0 ? currentText : '', qId);
            if (i < currentFiles.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 350));
            }
          } catch (e) {
            console.error('Erro ao enviar arquivo:', currentFiles[i].name, e);
            toast.error(`Falha ao enviar ${currentFiles[i].name}: ` + (e.response?.data?.error || e.message));
          }
        }
        await loadMessages({ background: true });
      })();
      return;
    } else {
      await doSend(text, null);
    }
  }

  async function doSend(body, attachment) {
    const tId = selectedId;
    const qId = replyingTo?.externalId;
    const previousReply = replyingTo;
    setText('');
    setFiles([]);
    setReplyingTo(null);
    try {
      if (attachment) {
        await sendMediaMessage(tId, attachment, body, qId);
      } else {
        await sendMessage(tId, body, qId);
      }
      loadMessages({ background: true });
    } catch (e) {
      // Mantem o texto (e a citacao) no campo para o atendente nao perder a mensagem e poder reenviar
      if (selectedIdRef.current === tId) {
        setText(body);
        setReplyingTo(previousReply);
      }
      toast.error('Falha ao enviar a mensagem. Pode ser instabilidade na conexão ou no WhatsApp — o texto foi mantido no campo, verifique e tente enviar novamente. ' + (e.response?.data?.error || e.message));
    }
  }

  async function handleTransfer(agentId, teamId, note) {
    try {
      await assignTicket(selectedId, agentId, teamId, note);
      setTransferModal(false);
      setSelectedId(null);
      loadTickets();
      toast.success('Atendimento transferido!');
    } catch (e) { toast.error('Erro ao transferir: ' + (e.response?.data?.error || e.message)); }
  }

  async function handleResolve() {
    toast.confirm('Encerrar este atendimento?', async () => {
      try {
        await resolveTicket(selectedId);
        setSelectedId(null);
        loadTickets();
        toast.success('Atendimento encerrado!');
      } catch (e) { toast.error('Erro ao encerrar: ' + (e.response?.data?.error || e.message)); }
    });
  }

  async function handleReopen() {
    setShowReopenInstanceModal(true);
  }

  async function confirmReopen(instanceId) {
    if (!instanceId || !selectedTicket) return;
    setReopening(true);
    try {
      const { data } = await reopenTicket(selectedTicket.contactId, instanceId);
      setShowReopenInstanceModal(false);
      setSelectedId(data.id);
      loadTickets();
      toast.success('Atendimento reaberto na instância selecionada!');
    } catch (e) {
      toast.error('Erro ao reabrir: ' + (e.response?.data?.error || e.message));
    } finally {
      setReopening(false);
    }
  }

  async function handleSummarize() {
    setSummarizing(true);
    try {
      const { data } = await summarizeTicket(selectedId);
      setSummary(data.summary);
    } catch (e) { toast.error('Erro ao gerar resumo IA: ' + (e.response?.data?.error || e.message)); } finally { setSummarizing(false); }
  }

  async function handleUnlinkCRM() {
    toast.confirm('Deseja desvincular o cliente do CRM?', async () => {
      try {
        await api.patch(`/tickets/${selectedId}/link-contact`, { unlinkCrm: true });
        loadTickets();
        setUpdateTrigger(prev => prev + 1);
        toast.success('Cliente desvinculado do CRM com sucesso!');
      } catch (e) {
        toast.error('Erro ao desvincular cliente: ' + (e.response?.data?.error || e.message));
      }
    });
  }

  async function handleSchedule() {
    if (!scheduleData.body || !scheduleData.sendAt) return toast.error('Preencha a mensagem e o horario');
    try {
      const ticket = tickets.find(t => t.id === selectedId);
      await scheduleMessage({ ...scheduleData, contactId: ticket.contactId });
      toast.success('Mensagem agendada com sucesso!');
      setShowScheduling(false);
      setScheduleData({ body: '', sendAt: '' });
    } catch (e) { toast.error('Erro ao agendar: ' + (e.response?.data?.error || e.message)); }
  }

  const handleInput = useCallback((v) => {
    setText(v);
    if (v.startsWith('/')) {
      const q = v.slice(1).toLowerCase();
      setFilteredQuick(quickResponses.filter(r => r.shortcut.toLowerCase().includes(q)));
    } else {
      setFilteredQuick([]);
    }
  }, [quickResponses]);

  // A métrica é somente informativa; um erro de permissão ou de versão antiga
  // do backend nunca pode impedir que o atendente escolha a resposta rápida.
  const registerQuickResponseUse = useCallback((id) => {
    if (!id) return;
    useQuickResponse(id).catch(() => {});
  }, []);

  const selectedTicket = useMemo(
    () => tickets.find(t => t.id === selectedId),
    [tickets, selectedId]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('openOs') !== '1' || !selectedTicket || openOsHandledRef.current) return;
    openOsHandledRef.current = true;
    setShowOsModal(true);
    params.delete('openOs');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [selectedTicket]);

  const selectTicket = useCallback(async (id) => {
    if (selectedId !== id && historySearch) {
      setHistorySearch('');
    }
    setSelectedId(id);
    if (isMobile) setView('chat');
    
    // Zera o contador localmente para feedback imediato
    const ticket = tickets.find((item) => item.id === id);
    setTickets(prev => prev.map(t => t.id === id ? { ...t, unreadCount: 0, isUnread: false } : t));
    if (ticket?.isUnread) updateTicketPreferences(id, { isUnread: false }).catch(() => {});
    
    // O backend ja zera ao chamar getMessages pelo useEffect do selectedId
  }, [selectedId, historySearch, isMobile, tickets, setTickets]);

  const handleTicketPreference = useCallback(async (ticketId, preference) => {
    const previous = tickets.find((ticket) => ticket.id === ticketId);
    if (!previous) return;
    setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, ...preference } : ticket));
    try {
      const { data } = await updateTicketPreferences(ticketId, preference);
      setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, ...data } : ticket));
      toast.success(preference.isPinned !== undefined
        ? (preference.isPinned ? 'Conversa fixada no topo' : 'Conversa desafixada')
        : 'Conversa marcada como não lida');
    } catch (error) {
      setTickets((current) => current.map((ticket) => ticket.id === ticketId ? previous : ticket));
      toast.error(error.response?.data?.error || 'Não foi possível atualizar a conversa.');
    }
  }, [tickets, setTickets]);

  if (!me) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        background: 'var(--bg-surface)',
        color: 'var(--text-muted)',
        gap: 'var(--space-5)'
      }}>
        <div className="loading-spinner" style={{ 
          width: '40px', 
          height: '40px', 
          border: '4px solid var(--border-color)', 
          borderTop: '4px solid var(--accent)', 
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <div style={{ fontWeight: 800, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Sincronizando Inbox...
        </div>
        <style>{`
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={s.layout}>
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
        .inbox-control { transition: background-color .16s ease, border-color .16s ease, color .16s ease, transform .16s ease; }
        .inbox-control:hover:not(:disabled) { border-color: var(--accent-border) !important; color: var(--text-main) !important; }
        .inbox-control:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .inbox-control:active:not(:disabled) { transform: translateY(1px); }
      `}</style>
      <TicketSidebar
        counts={counts}
        filters={filters}
        isMobile={isMobile}
        onTicketPreference={handleTicketPreference}
        search={search}
        selectedId={selectedId}
        selectTicket={selectTicket}
        setFilters={setFilters}
        setSearch={setSearch}
        setTab={setTab}
        styles={s}
        tab={tab}
        teams={teams}
        tickets={tickets}
        users={users}
        view={view}
      />

      {/* Main Chat */}
      <main 
        style={{ 
          ...s.main,
          display: (isMobile && view === 'list') ? 'none' : 'flex'
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
          }
        }}
      >
        {selectedTicket ? (
          <>
            <InboxSectionErrorBoundary key={`header-${selectedTicket.id}`} label="cabecalho da conversa">
              <ChatHeader
                canCreateOs={can('inbox.create_os')}
                canResolve={can('inbox.resolve')}
                canReopen={can('inbox.reopen')}
                canTransfer={can('inbox.assign') || can('inbox.transfer')}
                botName={botName}
                handleReopen={handleReopen}
                handleResolve={handleResolve}
                handleSummarize={handleSummarize}
                isMobile={isMobile}
                isCompactDesktop={isCompactDesktop}
                onImageClick={openPreviewImage}
                selectedTicket={selectedTicket}
                setShowInfo={setShowInfo}
                setShowOsModal={setShowOsModal}
                setTransferModal={setTransferModal}
                setView={setView}
                showInfo={showInfo}
                styles={s}
                summarizing={summarizing}
              />
            </InboxSectionErrorBoundary>

            {summary && (
              <InboxSectionErrorBoundary key={`summary-${selectedTicket.id}`} label="resumo da conversa">
                <div style={s.summaryCard}>
                  <div style={s.summaryHeader}><span>RESUMO DA CONVERSA (IA)</span><button onClick={() => setSummary(null)}>X</button></div>
                  <div style={s.summaryBody}>{normalizeText(summary)}</div>
                </div>
              </InboxSectionErrorBoundary>
            )}

            <InboxSectionErrorBoundary key={`messages-${selectedTicket.id}`} label="historico da conversa">
              <MessageList
                canDeleteMessage={can('inbox.delete_message')}
                botName={botName}
                handleCopyMessage={handleCopyMessage}
                handleDeleteMessage={handleDeleteMessage}
                handleLoadMoreMessages={handleLoadMoreMessages}
                hasMoreMessages={hasMoreMessages}
                historySearch={historySearch}
                isMobile={isMobile}
                loading={loading}
              loadingMoreMessages={loadingMoreMessages}
              messages={messages}
              onImageClick={openPreviewImage}
              onHistorySearch={setHistorySearch}
              scrollRef={scrollRef}
              selectedTicket={selectedTicket}
              setForwardingMessage={setForwardingMessage}
                setReplyingTo={setReplyingTo}
                styles={s}
              />
            </InboxSectionErrorBoundary>

            <InboxSectionErrorBoundary key={`composer-${selectedTicket.id}`} label="campo de envio">
              <MessageComposer
                files={files}
                filteredQuick={filteredQuick}
                fmtTime={fmtTime}
                handleInput={handleInput}
                handleSend={handleSend}
                isMobile={isMobile}
                isRecording={isRecording}
                recordingTime={recordingTime}
                replyingTo={replyingTo}
                selectedTicket={selectedTicket}
                setFiles={setFiles}
                setFilteredQuick={setFilteredQuick}
                setReplyingTo={setReplyingTo}
                setShowScheduling={setShowScheduling}
                startRecording={startRecording}
                stopRecording={stopRecording}
                styles={s}
                setText={setText}
                text={text}
                isNote={isNote}
                setIsNote={setIsNote}
                onQuickResponseUse={registerQuickResponseUse}
              />
            </InboxSectionErrorBoundary>
          </>
        ) : (
            <div style={s.emptyChat}>
            <div style={s.emptyIcon}>Chat</div>
            <h2>Central de Atendimento</h2>
            <p>Selecione uma conversa na lista ao lado para começar a atender</p>
          </div>
        )}
      </main>

      {showInfo && selectedTicket && (
        <>
          {isCompactDesktop ? (
            <button
              type="button"
              aria-label="Fechar ficha do cliente"
              style={s.infoPanelBackdrop}
              onClick={() => setShowInfo(false)}
            />
          ) : null}
          <InboxSectionErrorBoundary key={`info-${selectedTicket.id}`} label="painel do cliente">
            <ContactPanel
              key={(selectedTicket.contact?.id || 'new')}
              ticket={selectedTicket}
              onClose={() => setShowInfo(false)}
              onUpdate={() => { loadTickets(); setUpdateTrigger(prev => prev + 1); }}
              onImageClick={openPreviewImage}
              isMobile={isMobile}
              isCompactDesktop={isCompactDesktop}
              onLinkCRM={() => setLinkModal(true)}
              onUnlinkCRM={handleUnlinkCRM}
              onOpenCRM={(crmCustomer, tab) => { setCrmProfile(crmCustomer); setCrmProfileTab(tab || 'overview'); }}
              styles={s}
            />
          </InboxSectionErrorBoundary>
        </>
      )}

      {/* Modais */}

      {crmProfile ? (
        <CrmCustomerProfileModal
          customerId={crmProfile.id}
          initialCustomer={crmProfile}
          initialTab={crmProfileTab}
          onClose={() => setCrmProfile(null)}
          onOpenConversation={() => setCrmProfile(null)}
          onOpenServiceOrder={() => {
            setCrmProfile(null);
            setShowOsModal(true);
          }}
        />
      ) : null}

      {showReopenInstanceModal && selectedTicket ? (
        <InstanceSelectionModal
          instances={instances}
          title="Reabrir conversa"
          description={`Escolha por qual instância a conversa com ${selectedTicket.contact?.name || selectedTicket.contact?.phone || 'este contato'} sera reaberta.`}
          confirmLabel="Reabrir conversa"
          loading={reopening}
          onClose={() => setShowReopenInstanceModal(false)}
          onConfirm={confirmReopen}
        />
      ) : null}
      
      {showScheduling && (
        <div style={s.overlay} onClick={() => setShowScheduling(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}><h3>Agendar Mensagem</h3><button onClick={() => setShowScheduling(false)}>X</button></div>
            <div style={s.modalBody}>
              <textarea style={s.modalInput} placeholder="Texto da mensagem..." value={scheduleData.body} onChange={e => setScheduleData({...scheduleData, body: e.target.value})} />
              <input style={s.modalInput} type="datetime-local" value={scheduleData.sendAt} onChange={e => setScheduleData({...scheduleData, sendAt: e.target.value})} />
              <button style={s.saveBtn} onClick={handleSchedule}>Confirmar Agendamento</button>
            </div>
          </div>
        </div>
      )}

      {previewImg && (
        <div style={s.overlay}>
          <div style={s.previewToolbar} onClick={(event) => event.stopPropagation()}>
            <span style={s.previewHint}>Scroll para zoom{previewZoom > 1 ? ' e arraste para mover' : ''}</span>
            <button type="button" style={s.previewZoomBtn} onClick={() => {
              setPreviewZoom((previous) => {
                const next = Math.max(0.6, Number((previous - 0.2).toFixed(2)));
                if (next <= 1) setPreviewOffset({ x: 0, y: 0 });
                return next;
              });
            }}>-</button>
            <button type="button" style={s.previewZoomValue} onClick={() => {
              setPreviewZoom(1);
              setPreviewOffset({ x: 0, y: 0 });
            }}>{Math.round(previewZoom * 100)}%</button>
            <button type="button" style={s.previewZoomBtn} onClick={() => setPreviewZoom((previous) => Math.min(4, Number((previous + 0.2).toFixed(2))))}>+</button>
          </div>
          <div
            style={{
              ...s.previewViewport,
              cursor: previewZoom > 1 ? 'grab' : 'zoom-in',
            }}
            onWheel={handlePreviewWheel}
            onMouseDown={handlePreviewPointerDown}
            onMouseMove={handlePreviewPointerMove}
            onMouseUp={handlePreviewPointerUp}
            onMouseLeave={handlePreviewPointerUp}
            onClick={(event) => {
              if (event.target === event.currentTarget) closePreviewImage();
            }}
          >
            <img
              src={previewImg}
              alt="Preview"
              style={{
                ...s.previewImg,
                transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0) scale(${previewZoom})`,
              }}
            />
          </div>
        </div>
      )}


      {transferModal && (can('inbox.assign') || can('inbox.transfer')) && (
        <TransferModal 
          users={users}
          teams={teams}
          onClose={() => setTransferModal(false)}
          onTransfer={handleTransfer}
          styles={s}
        />
      )}

      {forwardingMessage && (
        <ForwardModal 
          onClose={() => setForwardingMessage(null)}
          styles={s}
          onForward={async (contact) => {
            try {
              await forwardMessage(selectedId, forwardingMessage.id, contact.id);
              toast.success('Mensagem encaminhada!');
              setForwardingMessage(null);
              loadTickets();
            } catch (e) {
              toast.error('Erro ao encaminhar mensagem');
            }
          }}
        />
      )}

      {showOsModal && selectedTicket && can('inbox.create_os') && (
        <CreateOsModal
          ticket={selectedTicket}
          onClose={() => setShowOsModal(false)}
          onCreated={async (os, confirmedContext) => {
            const ticketId = confirmedContext?.ticketId;
            const contextIsValid = /^\d+$/.test(String(os?.externalId || ''))
              && ticketId
              && os.ticketId === ticketId
              && os.contactId === confirmedContext.contactId
              && os.equipmentId === confirmedContext.equipmentId;
            if (!contextIsValid) {
              console.error('[Inbox] envio de confirmação de O.S. bloqueado por contexto divergente', {
                orderId: os?.id,
                ticketId: os?.ticketId,
              });
              toast.error('A confirmação da O.S. não foi enviada porque os dados não correspondem a esta conversa.');
              return;
            }
            toast.success(`O.S. ${os.externalId} criada no iLux!`);
            try {
              await sendMessage(
                ticketId,
                `Sua O.S. foi aberta com sucesso.\n*Número da O.S.: ${os.externalId}*`
              );
              toast.success('Mensagem com o número da O.S. enviada ao cliente!');
            } catch (e) {
              toast.error(`A O.S. foi criada, mas a mensagem não foi enviada: ${e.response?.data?.error || e.message}`);
            } finally {
              loadMessages({ ticketId, replace: true, background: true });
            }
          }}
        />
      )}

      {linkModal && (
        <LinkContactModal 
          onClose={() => setLinkModal(false)}
          onLink={async (targetId) => {
            try {
              const res = await api.patch(`/tickets/${selectedTicket.id}/link-contact`, { crmCustomerId: targetId });
              loadTickets(); 
              setUpdateTrigger(prev => prev + 1);
              setLinkModal(false);
              toast.success('Cliente vinculado com sucesso!');
            } catch (e) {
              toast.error('Erro ao vincular cliente: ' + (e.response?.data?.error || e.message));
            }
          }}
        />
      )}

    </div>
  );
}

export const inboxStyles = {
  layout: { display: 'flex', height: '100%', width: '100%', background: 'var(--bg-base)', color: 'var(--text-main)', overflow: 'hidden', fontFamily: 'var(--font-main)', position: 'relative' },
  sidebar: { width: '348px', minWidth: '348px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)' },
  sidebarHeader: { padding: '1.25rem 1rem 0.9rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  sidebarEyebrow: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', fontWeight: 600, marginBottom: '0.45rem' },
  sidebarTitle: { fontSize: '1.2rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-main)' },
  sidebarSubtitle: { fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' },
  sidebarCounter: { minWidth: '42px', height: '42px', borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-main)', fontWeight: 600, fontSize: '0.9rem' },
  tabsWrap: { padding: '0.9rem 1rem 0.8rem', borderBottom: '1px solid var(--border-color)' },
  tabs: { display: 'flex', gap: '4px', background: 'var(--bg-panel)', padding: '4px', borderRadius: 'var(--radius-md)' },
  tab: { 
    flex: 1, 
    padding: '0.55rem 0.4rem', 
    border: 'none', 
    background: 'none', 
    cursor: 'pointer', 
    color: 'var(--text-muted)', 
    fontSize: '0.75rem',
    fontWeight: 600, 
    borderRadius: 'var(--radius-sm)', 
    transition: 'all 0.2s', 
    textTransform: 'uppercase', 
    letterSpacing: '0.01em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    whiteSpace: 'nowrap'
  },
  tabActive: { background: 'var(--bg-surface)', color: 'var(--accent)', border: '1px solid var(--accent-border)', boxShadow: 'var(--shadow-sm)' },
  badge: { 
    background: 'var(--accent)', 
    color: 'var(--text-inverse)', 
    borderRadius: 'var(--radius-sm)', 
    padding: '1px 6px', 
    fontSize: '0.72rem',
    fontWeight: 700,
    minWidth: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  searchWrap: { padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', borderBottom: '1px solid var(--border-color)' },
  searchRow: { display: 'flex', gap: '8px', marginBottom: '4px' },
  searchShell: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.7rem', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0 0.95rem' },
  searchIcon: { color: 'var(--text-dim)', flexShrink: 0 },
  search: { flex: 1, minWidth: 0, width: '100%', background: 'transparent', border: 'none', padding: '0.85rem 0', color: 'var(--text-main)', outline: 'none', fontSize: '0.9rem', transition: 'border-color 0.2s' },
  searchClearIcon: { width: '28px', height: '28px', flexShrink: 0, borderRadius: '50%', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  clearBtn: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', padding: '0 1rem', cursor: 'pointer', fontWeight: 600, flexShrink: 0 },
  filterToggleBtn: { minWidth: '42px', minHeight: '42px', padding: '0 0.7rem', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 650, fontSize: '0.78rem' },
  filterToggleActive: { color: 'var(--accent)', borderColor: 'var(--accent-border)', background: 'var(--accent-light)' },
  filterBar: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  inboxOperationalBar: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.55rem 0.1rem 0', color: 'var(--text-muted)', fontSize: '0.68rem', flexWrap: 'wrap' },
  sortBar: { display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.55rem' },
  sortSelect: { flex: 1, minWidth: 0, background: 'var(--bg-panel)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', minHeight: '34px', padding: '0 0.45rem', fontSize: '0.7rem', fontWeight: 600 },
  saveFilterBtn: { minHeight: '34px', padding: '0 0.65rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 },
  filterSelect: { flex: '1 1 84px', minWidth: 0, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '8px 9px', color: 'var(--text-muted)', fontSize: '0.75rem', outline: 'none', fontWeight: 600 },
  filtersClearBtn: { flex: '1 0 100%', minHeight: '34px', background: 'transparent', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' },
  list: { flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem 0.75rem' },
  row: { display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.78rem 0.8rem', cursor: 'pointer', borderRadius: 'var(--radius-md)', marginBottom: '0.3rem', transition: 'all 0.18s ease', border: '1px solid transparent' },
  rowActive: { background: 'var(--accent-light)', border: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent)' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', marginBottom: 2 },
  rowName: { fontWeight: 650, fontSize: '0.9rem', color: 'var(--text-main)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 5 },
  rowTime: { fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
  rowPreview: { fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowSub: { display: 'flex', alignItems: 'center', gap: '0.45rem', position: 'relative', flexWrap: 'wrap' },
  rowStatusPill: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-lg)', fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.2 },
  priorityPill: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-lg)', fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.2 },
  rowMetaLine: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.65rem', marginTop: '0.4rem' },
  ticketQuickAction: { width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, flexShrink: 0 },
  rowOperationalLine: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' },
  awaitingCustomerPill: { color: 'var(--info)', background: 'var(--info-light)', border: '1px solid var(--info-border)', borderRadius: 'var(--radius-lg)', padding: '0.12rem 0.4rem', fontSize: '0.65rem', fontWeight: 700 },
  slaPill: { borderRadius: 'var(--radius-lg)', padding: '0.12rem 0.4rem', fontSize: '0.65rem', fontWeight: 700, border: '1px solid transparent' },
  slaDanger: { color: 'var(--danger)', background: 'var(--danger-light)', borderColor: 'var(--danger)' },
  slaWarning: { color: 'var(--warning)', background: 'var(--warning-light)', borderColor: 'var(--warning)' },
  slaOk: { color: 'var(--success)', background: 'var(--success-light)', borderColor: 'var(--success-border)' },
  loadMoreTicketsBtn: { width: '100%', padding: '0.75rem', marginTop: '0.5rem', background: 'var(--bg-panel)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem' },
  rowOwner: { fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  rowTags: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' },
  rowTag: { fontSize: '0.75rem', background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', padding: '0.15rem 0.4rem', borderRadius: 'var(--radius-sm)', fontWeight: 600, border: '1px solid rgba(255,255,255,0.08)' },
  rowMetaSpacer: { display: 'inline-block', minWidth: '1px', minHeight: '1px' },
  unreadBadge: { 
    background: 'var(--danger)', 
    color: '#fff', 
    borderRadius: '50%', 
    minWidth: '20px', 
    height: '20px', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    fontSize: '0.72rem',
    fontWeight: 700, 
    boxShadow: 'none',
    border: '1.5px solid var(--bg-surface)'
  },
  dot: { width: 6, height: 6, borderRadius: '50%', boxShadow: '0 0 6px currentColor' },
  miniBadge: { fontSize: '0.72rem', padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' },

  main: { flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-base)', position: 'relative', minWidth: 0, overflow: 'hidden' },
  chatHeader: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.5rem', background: 'var(--chat-header-bg)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--border-color)', zIndex: 10, width: '100%', boxSizing: 'border-box', minHeight: '76px' },
  backBtn: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-main)', width: '38px', height: '38px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chatIdentity: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  chatTitleRow: { display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flexWrap: 'wrap' },
  chatName: { fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-main)', letterSpacing: '-0.02em', minWidth: 0, overflowWrap: 'break-word', wordBreak: 'break-word' },
  chatStatusPill: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '26px', padding: '0 0.7rem', borderRadius: 'var(--radius-lg)', fontSize: '0.7rem', fontWeight: 600, flexShrink: 0 },
  chatMetaRow: { display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' },
  chatMetaText: { fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600, padding: '0.2rem 0.55rem', background: 'var(--chat-meta-bg)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--chat-meta-border)' },
  chatAwaitingCustomer: { fontSize: '0.72rem', color: 'var(--info)', fontWeight: 700, padding: '0.2rem 0.55rem', background: 'var(--info-light)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--info-border)' },
  chatSlaText: { fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 'var(--radius-lg)', border: '1px solid transparent' },
  headerActions: { marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 },
  headerGhostBtn: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', minHeight: '40px', padding: '0 0.9rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontWeight: 600, fontSize: '0.76rem' },
  headerPrimaryOutlineBtn: { background: 'var(--accent-light)', border: '1px solid var(--accent-border)', color: 'var(--accent)', minHeight: '40px', padding: '0 0.9rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontWeight: 650, fontSize: '0.8rem' },
  headerGhostIconBtn: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', width: '40px', height: '40px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  headerMenuPanel: { position: 'absolute', top: 'calc(100% + 0.45rem)', right: 0, minWidth: '220px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', padding: '0.4rem', zIndex: 20 },
  headerMenuItem: { width: '100%', border: 'none', background: 'transparent', color: 'var(--text-main)', textAlign: 'left', padding: '0.8rem 0.9rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.55rem' },
  resolveBtn: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', padding: '0.72rem 1rem', boxShadow: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' },
  
  messages: { flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', boxSizing: 'border-box' },
  loadMoreWrap: { display: 'flex', justifyContent: 'center', marginBottom: '0.15rem' },
  loadMoreBtn: { background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.76rem' },
  historySearchSticky: { position: 'sticky', top: '-1.25rem', zIndex: 2, marginBottom: '0.15rem', paddingTop: '1.25rem', background: 'linear-gradient(180deg, var(--bg-base) 0%, var(--bg-base) 82%, rgba(255,255,255,0) 100%)' },
  historySearchToggleRow: { display: 'flex', justifyContent: 'flex-end' },
  historySearchToggle: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minHeight: '36px', padding: '0 0.8rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, boxShadow: 'var(--shadow-sm)' },
  historySearchWrap: { display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.65rem' },
  historySearchField: { flex: '1 1 260px', minWidth: '220px', display: 'flex', alignItems: 'center', gap: '0.65rem', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0 0.9rem' },
  historySearchInput: { flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: '0.78rem 0', color: 'var(--text-main)', outline: 'none', fontSize: '0.88rem' },
  historySearchBtn: { background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.78rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' },
  historySearchClearBtn: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.78rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem' },
  historySearchMeta: { fontSize: '0.76rem', color: 'var(--text-dim)', fontWeight: 600, marginTop: '0.55rem' },
  bubbleWrap: { display: 'flex', width: '100%' },
  bubble: { 
    padding: '0.85rem 0.95rem', 
    borderRadius: 'var(--radius-md)', 
    maxWidth: 'min(78%, 560px)', 
    fontSize: '0.92rem', 
    display: 'flex', 
    flexDirection: 'column', 
    position: 'relative', 
    boxShadow: 'var(--shadow-sm)',
    lineHeight: 1.55,
    userSelect: 'text',
    WebkitUserSelect: 'text'
  },
  messageHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.55rem', width: '100%' },
  messageSender: { fontSize: '0.74rem', fontWeight: 600, letterSpacing: '-0.01em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  messageHeaderSide: { display: 'flex', alignItems: 'center', gap: '0.15rem', marginLeft: 'auto', flexShrink: 0 },
  messageHeaderTime: { fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' },
  messageMenuRoot: { position: 'relative' },
  messageMenuTrigger: { width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  messageMenuPanel: { position: 'fixed', width: '230px', maxWidth: 'calc(100vw - 16px)', overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: '0 16px 36px rgba(0,0,0,0.34)', padding: '0.35rem', zIndex: 100000, boxSizing: 'border-box' },
  messageMenuItem: { width: '100%', border: 'none', background: 'transparent', color: 'var(--text-main)', textAlign: 'left', padding: '0.75rem 0.85rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.92rem', fontWeight: 500 },
  messageMenuItemDanger: { color: '#e86a6a' },
  messageText: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    userSelect: 'text',
    WebkitUserSelect: 'text'
  },
  quotedBlock: { padding: '0.5rem 0.7rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.55rem', fontSize: '0.78rem', fontStyle: 'italic', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  time: { fontSize: '0.74rem', marginTop: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.92 },
  imgMedia: { maxWidth: '320px', maxHeight: '400px', borderRadius: 'var(--radius-md)', cursor: 'pointer', objectFit: 'cover', border: '1px solid var(--border-color)' },
  pdfCard: { display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.8rem 0.95rem', background: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'var(--text-main)', border: '1px solid var(--border-color)', maxWidth: 'min(100%, 290px)', boxShadow: 'var(--shadow-sm)' },
  pdfIcon: { minWidth: '54px', height: '54px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 900, letterSpacing: '0.08em' },
  pdfInfo: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  pdfName: { fontSize: '0.92rem', fontWeight: 800, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  pdfSize: { fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.15rem' },
  attachmentCard: { width: '100%', maxWidth: '360px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' },
  attachmentPreviewWrap: { background: 'var(--bg-panel)', padding: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  attachmentPreviewImage: { width: '100%', maxHeight: '250px', objectFit: 'contain', borderRadius: 'var(--radius-sm)', cursor: 'zoom-in' },
  attachmentFooterBtn: { width: '100%', border: 'none', borderTop: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.7rem 0.8rem', cursor: 'pointer', fontSize: '0.86rem', textAlign: 'left' },
  attachmentFooterText: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 },
  documentPreview: { minHeight: '170px', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.9rem', padding: '1.25rem' },
  documentPreviewBadge: { minWidth: '84px', minHeight: '84px', borderRadius: 'var(--radius-lg)', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontSize: '0.88rem', fontWeight: 800, letterSpacing: '0.06em' },
  documentPreviewLabel: { fontSize: '0.88rem', color: 'var(--text-muted)', fontWeight: 500, textAlign: 'center' },
  transcription: { fontSize: '0.85rem', fontStyle: 'italic', padding: '10px 14px', marginTop: 10, background: 'var(--border-light)', borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)', userSelect: 'text', WebkitUserSelect: 'text' },
  
  inputArea: { padding: '1rem 1.5rem', background: 'rgba(255,255,255,0.01)', borderTop: '1px solid var(--border-color)', width: '100%', boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  textInput: { flex: '0 0 auto', width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.8rem 1rem', color: 'var(--text-main)', outline: 'none', resize: 'none', minHeight: '52px', maxHeight: '240px', overflowY: 'hidden', lineHeight: 1.45, fontSize: '0.97rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' },
  sendBtn: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', width: '48px', height: '48px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 900, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', boxShadow: '0 8px 18px rgba(212,175,55,0.16)', transition: 'transform 0.1s' },
  attachBtn: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', width: '46px', height: '46px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  composerMetaRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' },
  composerShell: { display: 'flex', flex: 1, minWidth: 0, alignItems: 'flex-end', gap: '0.75rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.65rem' },
  composerCenter: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  composerToolbar: { display: 'flex', flexDirection: 'column', gap: '0.6rem', alignSelf: 'flex-end', flexShrink: 0 },
  composerActionBtn: { background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent-border)', minHeight: '44px', padding: '0 1rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 800, fontSize: '0.82rem', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 0 1px rgba(212,175,55,0.04)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' },
  composerActionBtnMuted: { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', minHeight: '36px', padding: '0 0.85rem', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' },
  composerHint: { minHeight: '36px', padding: '0 0.8rem', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--accent-border)', background: 'var(--accent-light)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' },
  composerInputRow: { display: 'flex', alignItems: 'flex-end', gap: '0.75rem', minWidth: 0 },
  emojiPicker: { position: 'absolute', left: 0, bottom: 'calc(100% + 10px)', zIndex: 80, width: 'min(310px, calc(100vw - 32px))', padding: '0.75rem', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', boxShadow: '0 18px 44px rgba(0,0,0,.32)' },
  emojiPickerTitle: { color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.55rem' },
  emojiGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 },
  emojiButton: { width: 38, height: 38, border: '1px solid transparent', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: '1.25rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  filePreview: { fontSize: '0.8rem', color: 'var(--accent)', padding: '8px 16px', background: 'var(--accent-light)', borderRadius: 'var(--radius-lg)', alignSelf: 'flex-start', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 },
  draftAttachmentList: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' },
  draftAttachmentCard: { display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0, maxWidth: '260px', padding: '0.55rem 0.7rem', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' },
  draftAttachmentThumb: { width: '48px', height: '48px', borderRadius: 'var(--radius-sm)', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 },
  draftAttachmentBadge: { width: '48px', height: '48px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem', fontWeight: 900, letterSpacing: '0.08em', flexShrink: 0 },
  draftAttachmentInfo: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.18rem', flex: 1 },
  draftAttachmentName: { fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  draftAttachmentMeta: { fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  draftAttachmentRemove: { width: '30px', height: '30px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  replyBanner: { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderLeft: '2px solid var(--accent)', padding: '0.75rem 0.9rem', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' },
  replyLabel: { fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2, letterSpacing: '0.08em' },
  replyPreview: { fontSize: '0.84rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  replyDismiss: { background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-dim)', cursor: 'pointer', width: '30px', height: '30px', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  recordingWrap: { flex: 1, display: 'flex', alignItems: 'center', gap: '1.5rem', background: 'var(--danger-light)', padding: '0.85rem 1.1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' },
  recordingDot: { width: 12, height: 12, borderRadius: '50%', background: 'var(--danger)', animation: 'pulse 1.5s infinite' },
  recordingTime: { color: 'var(--text-main)', fontWeight: 900, fontSize: '1.1rem', fontFamily: 'monospace' },
  stopBtn: { marginLeft: 'auto', background: 'var(--danger)', color: '#fff', border: 'none', padding: '0.6rem 1rem', borderRadius: 'var(--radius-sm)', fontWeight: 700, cursor: 'pointer' },
  
  emptyChat: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)' },
  emptyIcon: { fontSize: '4rem', marginBottom: '1.5rem', opacity: 0.15, background: 'rgba(255,255,255,0.05)', padding: '2rem', borderRadius: '50%' },

  overlay: { position: 'fixed', inset: 0, background: 'var(--overlay-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' },
  modal: { background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '440px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' },
  modalHeader: { padding: '2rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalBody: { padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  modalInput: { width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', color: 'var(--text-main)', fontSize: '1rem', outline: 'none' },  saveBtn: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', padding: '1rem', borderRadius: 'var(--radius-sm)', fontWeight: 700, cursor: 'pointer', fontSize: '1rem' },

  previewViewport: { width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5.5rem 2rem 2rem', boxSizing: 'border-box', touchAction: 'none' },
  previewToolbar: { position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--overlay-bg)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', padding: '0.45rem 0.55rem', zIndex: 2, backdropFilter: 'blur(8px)' },
  previewHint: { color: '#fff', fontSize: '0.8rem', fontWeight: 600, padding: '0 0.35rem' },
  previewZoomBtn: { width: '34px', height: '34px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer', fontSize: '1rem', fontWeight: 700 },
  previewZoomValue: { minWidth: '58px', height: '34px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, padding: '0 0.75rem' },
  previewImg: { maxWidth: '92vw', maxHeight: '88vh', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', transition: 'transform 0.12s ease-out', transformOrigin: 'center center', userSelect: 'none', WebkitUserSelect: 'none', display: 'block', willChange: 'transform' },
  summaryCard: { margin: '0 1.5rem 1rem', background: 'var(--bg-msg-ai)', border: '1px solid var(--border-msg-ai)', borderRadius: 'var(--radius-md)', padding: '1rem 1.15rem' },
  summaryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-msg-ai)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' },
  summaryBody: { fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: '1.6' },
  
  separator: { display: 'flex', alignItems: 'center', gap: '0.9rem', margin: '1.25rem 0 0.35rem' },
  sepLine: { flex: 1, height: '1px', background: 'var(--border-color)' },
  sepLabel: { fontSize: '0.72rem', fontWeight: 600, padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)', background: 'var(--bg-panel)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', border: '1px solid var(--border-color)' },
  eventWrap: { display: 'flex', justifyContent: 'center', margin: '0.15rem 0 0.35rem' },
  eventBadge: { background: 'var(--border-light)', color: 'var(--text-muted)', fontSize: '0.78rem', padding: '0.55rem 0.9rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', lineHeight: 1.4, textAlign: 'center', maxWidth: 'min(92%, 760px)' },
  noteWrap: { display: 'flex', justifyContent: 'center', margin: '0.45rem 0' },
  noteCard: { background: 'var(--accent-light)', border: '1px dashed var(--accent-border)', color: 'var(--text-main)', padding: '0.85rem 1.25rem', borderRadius: 'var(--radius-md)', width: 'fit-content', maxWidth: 'min(90%, 620px)', display: 'flex', flexDirection: 'column', gap: '0.35rem', boxShadow: 'var(--shadow-sm)' },
  noteHeader: { display: 'flex', alignItems: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' },
  noteBody: { fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' },
  noteTime: { fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right', fontWeight: 500 },
  
  infoPanelBackdrop: { position: 'absolute', inset: 0, zIndex: 190, border: 'none', padding: 0, background: 'rgba(5,8,14,0.48)', cursor: 'default' },
  infoPanel: { width: '400px', borderLeft: '1px solid var(--border-color)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', boxShadow: 'none' },
  infoPanelHeader: { padding: '1.2rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' },
  infoPanelHeaderMain: { minWidth: 0 },
  infoPanelEyebrow: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', fontWeight: 600, marginBottom: '0.35rem' },
  infoPanelTitle: { margin: 0, fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-main)' },
  infoPanelTabs: { padding: '0.8rem 1rem', display: 'flex', gap: '0.45rem', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' },
  infoPanelTab: { flex: 1, minHeight: '36px', borderRadius: 'var(--radius-sm)', border: '1px solid transparent', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' },
  infoPanelTabActive: { background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)' },
  infoClose: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  infoScroll: { flex: 1, overflowY: 'auto', padding: '1rem 1.1rem 1.5rem', userSelect: 'text', WebkitUserSelect: 'text' },
  infoProfile: { display: 'flex', flexDirection: 'column', marginBottom: '1.1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' },
  infoIdentityRow: { display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 },
  infoIdentityMain: { flex: 1, minWidth: 0 },
  infoName: { margin: '0 0 0.3rem', fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.02em', textAlign: 'left', overflowWrap: 'break-word', wordBreak: 'break-word' },
  infoPhone: { color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.55rem' },
  infoPhoneButton: { background: 'none', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'text', WebkitUserSelect: 'text' },
  infoBadgeRow: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-start' },
  infoBadge: { background: 'rgba(255,255,255,0.04)', color: 'var(--text-main)', padding: '4px 9px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)' },
  infoActionRow: { display: 'flex', gap: '0.5rem', marginTop: '0.8rem', flexWrap: 'wrap', justifyContent: 'flex-start' },
  infoActionBtn: { background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)', minHeight: '36px', padding: '0 0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' },
  infoActionBtnPrimary: { background: 'var(--accent)', color: 'var(--text-inverse)', border: 'none', boxShadow: 'none' },
  infoSection: { marginBottom: '2rem' },
  infoLabel: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '1.25rem', letterSpacing: '0.15em', textTransform: 'uppercase' },
  infoSnapshotGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '2rem' },
  infoSnapshotCard: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.95rem' },
  infoSnapshotLabel: { display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-dim)', fontWeight: 600, marginBottom: '0.45rem' },
  infoSnapshotValue: { display: 'block', fontSize: '0.88rem', color: 'var(--text-main)', fontWeight: 600, lineHeight: 1.35 },
  infoCardList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  infoListCard: { background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.95rem' },
  infoListTitle: { fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 600, lineHeight: 1.35, marginBottom: '0.3rem' },
  infoListMeta: { fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' },
  infoListSubtle: { fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  infoEmpty: { background: 'var(--bg-panel)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.95rem', color: 'var(--text-dim)', fontSize: '0.8rem', textAlign: 'center' },
  tagContainer: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  tagItem: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 },
  tagDel: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, fontSize: '0.85rem' },
  tagSelect: { background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', outline: 'none', cursor: 'pointer' },
  priorityGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  priorityBtn: { border: '1px solid', padding: '0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' },
  notesArea: { width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem', color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none', resize: 'none', minHeight: '120px', lineHeight: 1.5 },
  mediaGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' },
  mediaThumb: { width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: '1px solid var(--border-color)' },
  techInfo: { background: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '12px' },
  techRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 },
  transferRow: { display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1rem', cursor: 'pointer', borderRadius: 'var(--radius-md)', transition: 'all 0.2s', border: '1px solid transparent' },
  quickList: { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', position: 'absolute', bottom: '108px', left: '1.5rem', right: '1.5rem', maxHeight: '250px', overflowY: 'auto', zIndex: 100, boxShadow: 'var(--shadow-sm)', padding: '0.45rem' },
  quickItem: { padding: '0.95rem 1rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', color: 'var(--text-main)', borderRadius: 'var(--radius-sm)', transition: 'background 0.2s' }
};
const s = inboxStyles;
