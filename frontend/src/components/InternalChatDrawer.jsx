import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, ChevronLeft, Circle, MessageCircle, Pin, PinOff, Reply, Search, Send, Sparkles, Users, X } from 'lucide-react';
import { toast } from '../utils/toast';
import {
  getInternalConversations,
  getInternalConversationMessages,
  getInternalMessages,
  getInternalMessageThread,
  getUsers,
  addInternalMessageReaction,
  removeInternalMessageReaction,
  sendInternalConversationMessage,
  sendInternalMessage,
  updateInternalConversationPin,
  updateInternalConversationRead,
} from '../services/api';
import ActionButton from './ui/ActionButton';

const FILTERS = [
  { id: 'conversations', label: 'Minhas conversas', icon: MessageCircle },
  { id: 'unread', label: 'Não lidas', icon: Circle },
  { id: 'mentions', label: 'Menções', icon: AtSign },
  { id: 'pinned', label: 'Fixadas', icon: Pin },
];
const QUICK_REACTIONS = ['👍', '✅', '👀', '🎉'];
const FALLBACK_STATUSES = new Set([404, 405, 501]);

function unsupported(error) {
  return FALLBACK_STATUSES.has(error?.response?.status);
}

function mergeUnique(previous, message) {
  if (!message?.id || previous.some((item) => item.id === message.id)) return previous;
  return [...previous, message].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
}

function messageConversationKey(message, myId) {
  if (message?.teamId) return `team:${message.teamId}`;
  const peerId = message?.senderId === myId ? message?.receiverId : message?.senderId;
  return peerId ? `direct:${peerId}` : null;
}

function mentionIds(body, conversations) {
  const normalized = String(body || '').toLocaleLowerCase('pt-BR');
  const ids = conversations
    .filter((item) => item.kind === 'direct')
    .filter((item) => {
      const fullName = item.target.name.trim().toLocaleLowerCase('pt-BR');
      const firstName = fullName.split(/\s+/)[0];
      return normalized.includes(`@${fullName}`) || normalized.includes(`@${firstName}`);
    })
    .map((item) => item.target.id);
  return [...new Set(ids)];
}

function mentionedTeamIds(body, conversations) {
  const normalized = String(body || '').toLocaleLowerCase('pt-BR');
  return [...new Set(conversations
    .filter((item) => item.kind === 'team')
    .filter((item) => normalized.includes(`@${item.target.name.trim().toLocaleLowerCase('pt-BR')}`))
    .map((item) => item.target.id))];
}

export default function InternalChatDrawer({ isOpen, onClose, socket, incomingMessage, initialConversationKey, onSummaryChange }) {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('conversations');
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [viewerUserIds, setViewerUserIds] = useState([]);
  const [advancedAvailable, setAdvancedAvailable] = useState(null);
  const [messageType, setMessageType] = useState('message');
  const [replyTo, setReplyTo] = useState(null);
  const [thread, setThread] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);
  const bottomRef = useRef(null);
  const closeRef = useRef(null);
  const myId = localStorage.getItem('userId');

  useEffect(() => {
    if (advancedAvailable === false && messageType === 'note') setMessageType('message');
  }, [advancedAvailable, messageType]);

  function publishSummary(next) {
    onSummaryChange?.({
      unread: next.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0),
      mentions: next.reduce((sum, item) => sum + Number(item.mentionCount || 0), 0),
    });
  }

  async function loadConversations() {
    setError('');
    let next;
    try {
      const { data } = await getInternalConversations();
      next = Array.isArray(data?.conversations) ? data.conversations : [];
      setAdvancedAvailable(true);
    } catch (requestError) {
      if (!unsupported(requestError)) throw requestError;
      const { data } = await getUsers();
      next = (Array.isArray(data) ? data : [])
        .filter((user) => String(user.id) !== String(myId) && user.active !== false)
        .map((user) => ({ key: `direct:${user.id}`, kind: 'direct', target: user, unreadCount: 0, mentionCount: 0, pinned: false, lastMessage: null }));
      setAdvancedAvailable(false);
    }
    setConversations(next);
    publishSummary(next);
    return next;
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    setLoading(true);
    loadConversations()
      .then((next) => {
        const target = initialConversationKey && next.find((item) => item.key === initialConversationKey);
        if (target) void selectConversation(target);
      })
      .catch((requestError) => {
        setError(requestError.response?.data?.error || 'Não foi possível carregar o chat interno.');
        toast.error('Não foi possível carregar o chat interno.');
      })
      .finally(() => setLoading(false));
    closeRef.current?.focus();
    return undefined;
    // selectConversation intentionally uses the fresh response above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialConversationKey]);

  useEffect(() => {
    if (!socket) return undefined;
    const handlePresence = ({ onlineUserIds: next = [] } = {}) => setOnlineUserIds(next);
    const handleViewers = ({ conversationKey, viewerUserIds: next = [] } = {}) => {
      if (selected?.kind === 'direct' && conversationKey === [myId, selected.target.id].sort().join(':')) setViewerUserIds(next);
    };
    const handleConversationUpdate = () => void loadConversations().catch(() => {});
    const handleMessageUpdate = (update) => {
      setMessages((previous) => previous.map((message) => message.id === update.id ? { ...message, ...update } : message));
      setThread((previous) => previous ? {
        parent: previous.parent?.id === update.id ? { ...previous.parent, ...update } : previous.parent,
        replies: (previous.replies || []).map((message) => message.id === update.id ? { ...message, ...update } : message),
      } : previous);
    };
    socket.on('internal_presence', handlePresence);
    socket.on('internal_viewers', handleViewers);
    socket.on('internal_conversation:updated', handleConversationUpdate);
    socket.on('internal_message:updated', handleMessageUpdate);
    return () => {
      socket.off('internal_presence', handlePresence);
      socket.off('internal_viewers', handleViewers);
      socket.off('internal_conversation:updated', handleConversationUpdate);
      socket.off('internal_message:updated', handleMessageUpdate);
    };
  }, [socket, selected?.key, myId]);

  useEffect(() => {
    if (!socket || !isOpen) return undefined;
    socket.emit('internal_viewing', { peerId: selected?.kind === 'direct' ? selected.target.id : null });
    setViewerUserIds([]);
    return () => socket.emit('internal_viewing', { peerId: null });
  }, [socket, selected?.key, isOpen]);

  useEffect(() => {
    if (!incomingMessage) return;
    const key = messageConversationKey(incomingMessage, myId);
    if (!key) return;
    setConversations((previous) => {
      const next = previous.map((item) => item.key === key ? {
        ...item,
        lastMessage: incomingMessage,
        unreadCount: selected?.key === key || incomingMessage.senderId === myId ? 0 : Number(item.unreadCount || 0) + 1,
        mentionCount: selected?.key === key ? 0 : Number(item.mentionCount || 0),
      } : item);
      publishSummary(next);
      return next;
    });
    if (selected?.key === key) {
      setMessages((previous) => mergeUnique(previous, incomingMessage));
      if (incomingMessage.senderId !== myId) void markRead(key);
    }
  }, [incomingMessage, selected?.key, myId]);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, thread?.replies?.length]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (thread) setThread(null);
      else if (replyTo) setReplyTo(null);
      else if (selected) setSelected(null);
      else onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, selected, thread, replyTo, onClose]);

  async function markRead(key) {
    try {
      await updateInternalConversationRead(key);
      setConversations((previous) => {
        const next = previous.map((item) => item.key === key ? { ...item, unreadCount: 0, mentionCount: 0 } : item);
        publishSummary(next);
        return next;
      });
    } catch {
      // A mensagem continua disponível; a próxima atualização tentará sincronizar o contador.
    }
  }

  async function selectConversation(conversation) {
    setSelected(conversation);
    setThread(null);
    setReplyTo(null);
    setError('');
    setLoading(true);
    void markRead(conversation.key);
    try {
      if (advancedAvailable !== false) {
        try {
          const { data } = await getInternalConversationMessages(conversation.key);
          setMessages(Array.isArray(data?.messages) ? data.messages : []);
          return;
        } catch (requestError) {
          if (!unsupported(requestError) || conversation.kind !== 'direct') throw requestError;
          setAdvancedAvailable(false);
        }
      }
      const { data } = await getInternalMessages(conversation.target.id);
      setMessages(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Não foi possível carregar esta conversa.');
      toast.error('Não foi possível carregar esta conversa.');
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }

  async function togglePin(event, conversation) {
    event.stopPropagation();
    if (advancedAvailable === false) return;
    const pinned = !conversation.pinned;
    setConversations((previous) => previous.map((item) => item.key === conversation.key ? { ...item, pinned } : item));
    setSelected((previous) => previous?.key === conversation.key ? { ...previous, pinned } : previous);
    try {
      await updateInternalConversationPin(conversation.key, pinned);
    } catch {
      setConversations((previous) => previous.map((item) => item.key === conversation.key ? { ...item, pinned: !pinned } : item));
      setSelected((previous) => previous?.key === conversation.key ? { ...previous, pinned: !pinned } : previous);
      toast.error('Não foi possível atualizar a conversa fixada.');
    }
  }

  async function handleSend(event) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || !selected || sending) return;
    const payload = {
      body,
      type: messageType,
      replyToId: replyTo?.id || thread?.parent?.id || undefined,
      ...(selected.kind === 'team' ? { teamId: selected.target.id } : { receiverId: selected.target.id }),
      mentionUserIds: mentionIds(body, conversations),
      mentionTeamIds: [...new Set([
        ...mentionedTeamIds(body, conversations),
        ...(selected.kind === 'team' && /(^|\s)@(todos|equipe|all)(?=\s|$|[.,!?;:])/i.test(body) ? [selected.target.id] : []),
      ])],
    };
    setSending(true);
    try {
      let data;
      if (advancedAvailable !== false) {
        try {
          ({ data } = await sendInternalConversationMessage(payload));
        } catch (requestError) {
          if (!unsupported(requestError) || selected.kind !== 'direct' || messageType !== 'message' || payload.replyToId) throw requestError;
          setAdvancedAvailable(false);
          ({ data } = await sendInternalMessage({ receiverId: selected.target.id, body }));
        }
      } else {
        ({ data } = await sendInternalMessage({ receiverId: selected.target.id, body }));
      }
      setMessages((previous) => mergeUnique(previous, data));
      if (thread && String(data.replyToId) === String(thread.parent?.id)) {
        setThread((previous) => ({ ...previous, replies: mergeUnique(previous.replies || [], data) }));
      }
      setConversations((previous) => previous.map((item) => item.key === selected.key ? { ...item, lastMessage: data } : item));
      setText('');
      setReplyTo(null);
    } catch (err) {
      toast.error(`Falha ao enviar: ${err.response?.data?.error || err.message}`);
    } finally {
      setSending(false);
    }
  }

  async function openThread(message) {
    if (advancedAvailable === false) return;
    setThreadLoading(true);
    try {
      const { data } = await getInternalMessageThread(message.replyToId || message.id);
      setThread({ parent: data?.parent || message, replies: Array.isArray(data?.replies) ? data.replies : [] });
      setReplyTo(null);
    } catch (requestError) {
      toast.error(requestError.response?.data?.error || 'Não foi possível abrir a thread.');
    } finally {
      setThreadLoading(false);
    }
  }

  function updateReactions(messageId, reactions) {
    setMessages((previous) => previous.map((message) => message.id === messageId ? { ...message, reactions } : message));
    setThread((previous) => previous ? {
      parent: previous.parent?.id === messageId ? { ...previous.parent, reactions } : previous.parent,
      replies: (previous.replies || []).map((message) => message.id === messageId ? { ...message, reactions } : message),
    } : previous);
  }

  async function toggleReaction(message, emoji) {
    if (advancedAvailable === false) return;
    const mine = (message.reactions || []).some((reaction) => reaction.emoji === emoji && String(reaction.userId) === String(myId));
    try {
      const { data } = mine
        ? await removeInternalMessageReaction(message.id, emoji)
        : await addInternalMessageReaction(message.id, emoji);
      updateReactions(message.id, data?.reactions || []);
    } catch (requestError) {
      toast.error(requestError.response?.data?.error || 'Não foi possível atualizar a reação.');
    }
  }

  function selectMention(conversation) {
    const name = conversation.target?.name;
    if (!name) return;
    setText((previous) => previous.replace(/(?:^|\s)@([^@\s]*)$/, (match) => `${match.startsWith(' ') ? ' ' : ''}@${name} `));
  }

  function renderMessage(message, compact = false) {
    const mine = String(message.senderId) === String(myId);
    const groupedReactions = Object.values((message.reactions || []).reduce((groups, reaction) => {
      groups[reaction.emoji] ||= { emoji: reaction.emoji, count: 0, mine: false };
      groups[reaction.emoji].count += 1;
      if (String(reaction.userId) === String(myId)) groups[reaction.emoji].mine = true;
      return groups;
    }, {}));
    return <article key={message.id} className="internal-message" style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{ ...s.bubble, ...(mine ? s.mine : s.theirs), ...(message.type === 'note' ? s.note : {}) }}>
        <div style={s.messageMeta}>
          {selected?.kind === 'team' || !mine ? <strong>{mine ? 'Você' : message.sender?.name || 'Equipe'}</strong> : null}
          {message.type === 'note' ? <span style={s.noteBadge}>Nota interna</span> : null}
        </div>
        {message.replyTo ? <button type="button" style={s.replyPreview} onClick={() => openThread(message.replyTo)}><Reply size={12} /> {message.replyTo.body}</button> : null}
        <div style={s.body}>{message.body}</div>
        <time style={s.time}>{new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
        {groupedReactions.length ? <div style={s.reactions}>{groupedReactions.map((reaction) => <button key={reaction.emoji} type="button" style={{ ...s.reaction, ...(reaction.mine ? s.reactionMine : {}) }} onClick={() => toggleReaction(message, reaction.emoji)}>{reaction.emoji} {reaction.count}</button>)}</div> : null}
        {!compact && advancedAvailable !== false ? <div className="internal-message-actions" style={s.messageActions}>
          <button type="button" style={s.messageAction} onClick={() => setReplyTo(message)} title="Responder"><Reply size={13} /></button>
          <button type="button" style={s.messageAction} onClick={() => openThread(message)} title="Abrir thread"><MessageCircle size={13} /></button>
          {QUICK_REACTIONS.map((emoji) => <button key={emoji} type="button" style={s.emojiAction} onClick={() => toggleReaction(message, emoji)} aria-label={`Reagir com ${emoji}`}>{emoji}</button>)}
        </div> : null}
      </div>
    </article>;
  }

  const totals = useMemo(() => ({
    unread: conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0),
    mentions: conversations.reduce((sum, item) => sum + Number(item.mentionCount || 0), 0),
    pinned: conversations.filter((item) => item.pinned).length,
  }), [conversations]);

  const displayed = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    return conversations
      .filter((item) => showAll || item.lastMessage)
      .filter((item) => !normalizedQuery || item.target.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery))
      .filter((item) => filter === 'unread' ? item.unreadCount > 0 : filter === 'mentions' ? item.mentionCount > 0 : filter === 'pinned' ? item.pinned : true)
      .sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || new Date(right.lastMessage?.createdAt || 0) - new Date(left.lastMessage?.createdAt || 0));
  }, [conversations, query, filter, showAll]);

  const mentionQuery = useMemo(() => {
    const match = text.match(/(?:^|\s)@([^@\s]*)$/);
    return match ? match[1].toLocaleLowerCase('pt-BR') : null;
  }, [text]);
  const mentionOptions = useMemo(() => mentionQuery === null || advancedAvailable === false ? [] : conversations
    .filter((item) => item.target?.name?.toLocaleLowerCase('pt-BR').includes(mentionQuery))
    .slice(0, 6), [advancedAvailable, conversations, mentionQuery]);

  if (!isOpen) return null;
  const online = selected?.kind === 'direct' && onlineUserIds.includes(selected.target.id);
  const viewing = selected?.kind === 'direct' && viewerUserIds.includes(selected.target.id);
  const renderedMessages = thread ? [thread.parent, ...(thread.replies || [])] : messages;

  return <>
    <div style={s.backdrop} onClick={onClose} aria-hidden="true" />
    <aside style={s.drawer} role="dialog" aria-modal="true" aria-label="Chat interno da equipe">
      <style>{chatCss}</style>
      {!selected ? <div style={s.view}>
        <header style={s.header}>
          <div style={s.title}><Users size={18} /> Chat interno</div>
          <button ref={closeRef} type="button" style={s.iconButton} onClick={onClose} aria-label="Fechar chat interno"><X size={20} /></button>
        </header>
        <div style={s.filters} role="tablist" aria-label="Atalhos do chat interno">
          {FILTERS.map(({ id, label, icon: Icon }) => {
            const count = id === 'unread' ? totals.unread : id === 'mentions' ? totals.mentions : id === 'pinned' ? totals.pinned : null;
            return <button key={id} type="button" role="tab" aria-selected={filter === id} style={{ ...s.filter, ...(filter === id ? s.filterActive : {}) }} onClick={() => setFilter(id)}>
              <Icon size={14} /><span>{label}</span>{count ? <span style={s.count}>{count}</span> : null}
            </button>;
          })}
        </div>
        <div style={s.searchRow}>
          <label style={s.searchBox}><Search size={16} /><span style={s.srOnly}>Buscar conversa</span><input style={s.searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar colega ou equipe…" /></label>
          <button type="button" style={s.newButton} onClick={() => setShowAll((value) => !value)}>{showAll ? 'Recentes' : 'Nova'}</button>
        </div>
        <div style={s.list} aria-live="polite" aria-busy={loading}>
          {!loading && error ? <div style={s.errorState}><span>{error}</span><button type="button" style={s.retry} onClick={() => loadConversations().catch(() => {})}>Tentar novamente</button></div> : null}
          {loading ? <div style={s.empty}>Carregando conversas…</div> : displayed.map((conversation) => {
            const isOnline = conversation.kind === 'direct' && onlineUserIds.includes(conversation.target.id);
            return <div key={conversation.key} style={s.row}>
              <button type="button" style={s.rowMain} onClick={() => selectConversation(conversation)} aria-label={`Abrir ${conversation.target.name}${conversation.unreadCount ? `, ${conversation.unreadCount} não lidas` : ''}`}>
                <span style={s.avatar}>{conversation.kind === 'team' ? <Users size={16} /> : conversation.target.name?.[0]?.toUpperCase()}</span>
                <span style={s.rowInfo}><span style={s.nameLine}>{conversation.target.name}<span style={{ ...s.presence, background: isOnline ? 'var(--success)' : 'var(--text-dim)' }} title={isOnline ? 'Online' : 'Offline'} /></span><span style={s.preview}>{conversation.lastMessage?.body || 'Iniciar conversa'}</span></span>
                {conversation.mentionCount > 0 ? <span style={s.mention}>@{conversation.mentionCount}</span> : null}
                {conversation.unreadCount > 0 ? <span style={s.unread}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span> : null}
              </button>
              {advancedAvailable !== false ? <button type="button" style={s.pin} onClick={(event) => togglePin(event, conversation)} aria-label={conversation.pinned ? 'Desafixar conversa' : 'Fixar conversa'}>{conversation.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button> : null}
            </div>;
          })}
          {!loading && !error && !displayed.length ? <div style={s.empty}><Sparkles size={24} /><span>Nenhuma conversa neste filtro.</span></div> : null}
        </div>
        {advancedAvailable === false ? <p style={s.compatibility}>Modo compatível ativo. Equipes, notas, menções, threads e reações exigem a versão atualizada do backend.</p> : null}
      </div> : <div style={s.view}>
        <header style={s.header}>
          <button type="button" style={s.iconButton} onClick={() => thread ? setThread(null) : setSelected(null)} aria-label={thread ? 'Voltar à conversa' : 'Voltar às conversas'}><ChevronLeft size={20} /></button>
          <div style={s.selectedIdentity}><span style={s.avatar}>{selected.kind === 'team' ? <Users size={16} /> : selected.target.name?.[0]?.toUpperCase()}</span><span><strong style={s.selectedName}>{selected.target.name}</strong><small style={s.status}>{selected.kind === 'team' ? 'Conversa de equipe' : viewing ? 'Também está nesta conversa' : online ? 'Online agora' : 'Offline'}</small></span></div>
          <button type="button" style={s.iconButton} onClick={onClose} aria-label="Fechar chat interno"><X size={20} /></button>
        </header>
        <div style={s.messages} aria-live="polite" aria-busy={loading}>
          {loading || threadLoading ? <div style={s.empty}>{threadLoading ? 'Carregando thread…' : 'Carregando mensagens…'}</div> : renderedMessages.map((message) => renderMessage(message, Boolean(thread && message.id === thread.parent?.id)))}
          {!loading && !threadLoading && !renderedMessages.length ? <div style={s.empty}><MessageCircle size={24} /><span>Nenhuma mensagem ainda.</span></div> : null}
          <div ref={bottomRef} />
        </div>
        <div style={s.composerArea}>
          {replyTo || thread ? <div style={s.replyBar}><Reply size={14} /><span><strong>Respondendo a {replyTo?.sender?.name || thread?.parent?.sender?.name || 'mensagem'}</strong><small>{replyTo?.body || thread?.parent?.body}</small></span>{replyTo ? <button type="button" style={s.dismissReply} onClick={() => setReplyTo(null)} aria-label="Cancelar resposta"><X size={14} /></button> : null}</div> : null}
          <div style={s.typeTabs} role="tablist" aria-label="Tipo da mensagem">
            <button type="button" role="tab" aria-selected={messageType === 'message'} style={{ ...s.typeTab, ...(messageType === 'message' ? s.typeTabActive : {}) }} onClick={() => setMessageType('message')}>Mensagem</button>
            <button type="button" role="tab" aria-selected={messageType === 'note'} disabled={advancedAvailable === false} style={{ ...s.typeTab, ...(messageType === 'note' ? s.noteTabActive : {}) }} onClick={() => setMessageType('note')}>Nota interna</button>
          </div>
          <form onSubmit={handleSend} style={s.composer}>
            {mentionOptions.length ? <div style={s.mentionMenu} role="listbox" aria-label="Sugestões de menção">{mentionOptions.map((conversation) => <button key={conversation.key} type="button" style={s.mentionOption} onClick={() => selectMention(conversation)}><span style={s.mentionAvatar}>{conversation.kind === 'team' ? <Users size={13} /> : conversation.target.name?.[0]?.toUpperCase()}</span><span><strong>{conversation.target.name}</strong><small>{conversation.kind === 'team' ? 'Equipe' : 'Pessoa'}</small></span></button>)}</div> : null}
            <textarea rows={1} style={{ ...s.input, ...(messageType === 'note' ? s.noteInput : {}) }} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} placeholder={messageType === 'note' ? 'Escreva uma nota interna…' : 'Mensagem… Use @nome para mencionar'} aria-label={`${messageType === 'note' ? 'Nota interna' : 'Mensagem'} para ${selected.target.name}`} />
            <ActionButton type="submit" loading={sending} disabled={!text.trim()} style={s.send} aria-label="Enviar mensagem"><Send size={16} /></ActionButton>
          </form>
          <span style={s.shortcut}>Enter envia · Shift + Enter quebra linha</span>
        </div>
      </div>}
    </aside>
  </>;
}

const chatCss = `
  .internal-message { position: relative; }
  .internal-message .internal-message-actions { opacity: 0; pointer-events: none; transform: translateY(2px); transition: opacity .15s ease, transform .15s ease; }
  .internal-message:hover .internal-message-actions,
  .internal-message:focus-within .internal-message-actions { opacity: 1; pointer-events: auto; transform: translateY(0); }
  @media (max-width: 520px) {
    [aria-label="Chat interno da equipe"] { width: 100vw !important; }
  }
`;

const s = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1040, background: 'var(--overlay-bg)', backdropFilter: 'blur(2px)' },
  drawer: { position: 'fixed', inset: '0 0 0 auto', zIndex: 1050, width: 'min(440px, 100vw)', background: 'var(--bg-base)', boxShadow: '-8px 0 32px rgba(0,0,0,.22)' },
  view: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
  header: { minHeight: '68px', padding: '.8rem 1rem', display: 'flex', alignItems: 'center', gap: '.7rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface)' },
  title: { flex: 1, display: 'flex', alignItems: 'center', gap: '.55rem', color: 'var(--text-main)', fontWeight: 800 },
  iconButton: { width: '40px', height: '40px', display: 'grid', placeItems: 'center', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  filters: { padding: '.75rem 1rem .4rem', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '.45rem' },
  filter: { minHeight: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.35rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: '.76rem', fontWeight: 700, cursor: 'pointer' },
  filterActive: { borderColor: 'var(--accent-border)', background: 'var(--accent-light)', color: 'var(--accent)' },
  count: { minWidth: '20px', height: '20px', padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: '999px', background: 'var(--accent)', color: 'var(--text-inverse)', fontSize: '.66rem' },
  searchRow: { padding: '.5rem 1rem .7rem', display: 'flex', gap: '.5rem' },
  searchBox: { flex: 1, minWidth: 0, height: '40px', padding: '0 .7rem', display: 'flex', alignItems: 'center', gap: '.5rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-panel)', color: 'var(--text-dim)' },
  searchInput: { flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', color: 'var(--text-main)', font: 'inherit' },
  newButton: { minWidth: '82px', border: '1px solid var(--accent-border)', borderRadius: '10px', background: 'var(--accent-light)', color: 'var(--accent)', font: 'inherit', fontWeight: 800, cursor: 'pointer' },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '.35rem 1rem max(1rem, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '.5rem' },
  row: { display: 'flex', alignItems: 'stretch', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-surface)', overflow: 'hidden' },
  rowMain: { flex: 1, minWidth: 0, padding: '.7rem', display: 'flex', alignItems: 'center', gap: '.7rem', border: 0, background: 'transparent', color: 'var(--text-main)', textAlign: 'left', font: 'inherit', cursor: 'pointer' },
  avatar: { width: '38px', height: '38px', flexShrink: 0, display: 'inline-grid', placeItems: 'center', borderRadius: '11px', background: 'var(--accent)', color: 'var(--text-inverse)', fontWeight: 800 },
  rowInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' },
  nameLine: { display: 'flex', alignItems: 'center', gap: '.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '.88rem', fontWeight: 750 },
  presence: { width: '7px', height: '7px', flexShrink: 0, borderRadius: '50%' },
  preview: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)', fontSize: '.72rem' },
  mention: { color: 'var(--danger)', fontSize: '.7rem', fontWeight: 800 },
  unread: { minWidth: '22px', height: '22px', padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: '999px', background: 'var(--accent)', color: 'var(--text-inverse)', fontSize: '.68rem', fontWeight: 800 },
  pin: { width: '38px', border: 0, borderLeft: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  empty: { padding: '2.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem', color: 'var(--text-muted)', textAlign: 'center', fontSize: '.84rem' },
  selectedIdentity: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '.7rem' },
  selectedName: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)', fontSize: '.92rem' },
  status: { display: 'block', marginTop: '2px', color: 'var(--text-dim)', fontSize: '.68rem' },
  messages: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.55rem', userSelect: 'text' },
  bubble: { position: 'relative', maxWidth: '85%', padding: '.65rem .85rem', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,.08)', fontSize: '.88rem', lineHeight: 1.5 },
  mine: { background: 'var(--accent)', color: 'var(--text-inverse)', borderBottomRightRadius: '4px' },
  theirs: { background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderBottomLeftRadius: '4px' },
  note: { background: 'var(--warning-light)', color: 'var(--text-main)', border: '1px solid var(--warning-border)' },
  messageMeta: { minHeight: '15px', display: 'flex', alignItems: 'center', gap: '.35rem', marginBottom: '.25rem', color: 'var(--text-muted)', fontSize: '.64rem' },
  noteBadge: { padding: '1px 5px', borderRadius: '999px', border: '1px solid var(--warning-border)', color: 'var(--warning-text)', fontSize: '.56rem', fontWeight: 800, textTransform: 'uppercase' },
  replyPreview: { width: '100%', maxWidth: '260px', marginBottom: '.4rem', padding: '.35rem .45rem', display: 'flex', alignItems: 'center', gap: '.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 0, borderLeft: '2px solid var(--accent)', borderRadius: '5px', background: 'var(--bg-panel)', color: 'var(--text-muted)', fontSize: '.66rem', cursor: 'pointer' },
  body: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  time: { display: 'block', marginTop: '.3rem', textAlign: 'right', fontSize: '.63rem', opacity: .72 },
  reactions: { display: 'flex', flexWrap: 'wrap', gap: '.25rem', marginTop: '.35rem' },
  reaction: { minHeight: '23px', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-main)', cursor: 'pointer', fontSize: '.67rem' },
  reactionMine: { borderColor: 'var(--accent-border)', background: 'var(--accent-light)' },
  messageActions: { position: 'absolute', top: '-16px', right: '6px', zIndex: 2, height: '29px', padding: '2px', display: 'flex', alignItems: 'center', gap: '1px', border: '1px solid var(--border-color)', borderRadius: '999px', background: 'var(--bg-panel)', boxShadow: 'var(--shadow-sm)' },
  messageAction: { width: '24px', height: '24px', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  emojiAction: { width: '24px', height: '24px', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer', fontSize: '.7rem' },
  composerArea: { position: 'relative', padding: '.55rem 1rem max(.65rem, env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', background: 'var(--bg-surface)' },
  composer: { position: 'relative', display: 'flex', alignItems: 'flex-end', gap: '.55rem' },
  input: { flex: 1, minHeight: '42px', maxHeight: '120px', padding: '.65rem .8rem', resize: 'vertical', border: '1px solid var(--border-color)', borderRadius: '12px', outline: 0, background: 'var(--bg-panel)', color: 'var(--text-main)', font: 'inherit', lineHeight: 1.4 },
  noteInput: { background: 'var(--warning-light)', borderColor: 'var(--warning-border)' },
  send: { width: '42px', height: '42px', minWidth: '42px', padding: 0, display: 'grid', placeItems: 'center', borderRadius: '50%' },
  typeTabs: { display: 'flex', gap: '.25rem', marginBottom: '.4rem' },
  typeTab: { minHeight: '28px', padding: '0 .7rem', border: '1px solid transparent', borderRadius: '999px', background: 'transparent', color: 'var(--text-dim)', font: 'inherit', fontSize: '.66rem', fontWeight: 800, cursor: 'pointer' },
  typeTabActive: { borderColor: 'var(--accent-border)', background: 'var(--accent-light)', color: 'var(--accent)' },
  noteTabActive: { borderColor: 'var(--warning-border)', background: 'var(--warning-light)', color: 'var(--warning-text)' },
  replyBar: { marginBottom: '.45rem', padding: '.4rem .55rem', display: 'flex', alignItems: 'center', gap: '.45rem', borderLeft: '3px solid var(--accent)', borderRadius: '7px', background: 'var(--bg-panel)', color: 'var(--text-muted)', fontSize: '.66rem' },
  dismissReply: { marginLeft: 'auto', width: '28px', height: '28px', display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  shortcut: { display: 'block', marginTop: '.3rem', color: 'var(--text-dim)', fontSize: '.58rem' },
  mentionMenu: { position: 'absolute', left: 0, right: '50px', bottom: 'calc(100% + 5px)', zIndex: 4, maxHeight: '230px', overflowY: 'auto', padding: '.25rem', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'var(--bg-panel)', boxShadow: 'var(--shadow-lg)' },
  mentionOption: { width: '100%', minHeight: '42px', padding: '.35rem .5rem', display: 'flex', alignItems: 'center', gap: '.5rem', border: 0, borderRadius: '8px', background: 'transparent', color: 'var(--text-main)', textAlign: 'left', cursor: 'pointer' },
  mentionAvatar: { width: '28px', height: '28px', display: 'grid', placeItems: 'center', flexShrink: 0, borderRadius: '8px', background: 'var(--accent-light)', color: 'var(--accent)', fontSize: '.6rem', fontWeight: 800 },
  errorState: { margin: '.5rem 0', padding: '1rem', display: 'grid', justifyItems: 'start', gap: '.6rem', border: '1px solid var(--danger-border)', borderRadius: '10px', background: 'var(--danger-light)', color: 'var(--danger-text)', fontSize: '.76rem' },
  retry: { minHeight: '32px', padding: '0 .7rem', border: '1px solid var(--danger-border)', borderRadius: '8px', background: 'transparent', color: 'var(--danger-text)', fontWeight: 800, cursor: 'pointer' },
  compatibility: { margin: 0, padding: '.55rem 1rem', borderTop: '1px solid var(--border-color)', color: 'var(--text-dim)', fontSize: '.62rem', lineHeight: 1.45 },
  srOnly: { position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 },
};
