import { useCallback, useEffect, useRef, useState } from 'react';
import { getMessages, getTickets } from '../../services/api';
import io from 'socket.io-client';
import { SOCKET_URL } from '../../services/socket';
import { mergeMessagePages } from './helpers.jsx';

function normalizeMessageItems(items) {
  if (!Array.isArray(items)) {
    console.error('[inbox] payload de mensagens invalido:', items);
    return [];
  }

  return items.filter((item) => {
    const valid = item && typeof item === 'object';
    if (!valid) {
      console.error('[inbox] item de mensagem invalido descartado:', item);
    }
    return valid;
  });
}

function getTicketStatusWeight(status) {
  return { open: 3, pending: 2, bot: 2, resolved: 1 }[status] || 0;
}

function isTicketPreferred(candidate, current) {
  const candidateWeight = getTicketStatusWeight(candidate?.status);
  const currentWeight = getTicketStatusWeight(current?.status);

  if (candidateWeight !== currentWeight) {
    return candidateWeight > currentWeight;
  }

  return new Date(candidate?.updatedAt || 0).getTime() > new Date(current?.updatedAt || 0).getTime();
}

function normalizeTicketsForTab(items, currentTab) {
  if (currentTab !== 'all' || !Array.isArray(items)) {
    return Array.isArray(items) ? items : [];
  }

  const grouped = new Map();

  for (const ticket of items) {
    if (!ticket?.id) continue;

    const key = ticket.contactId || ticket.contact?.id || ticket.id;
    const current = grouped.get(key);

    if (!current || isTicketPreferred(ticket, current)) {
      grouped.set(key, ticket);
    }
  }

  return Array.from(grouped.values()).sort((a, b) => (
    new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  ));
}

export function useInboxTickets({ me }) {
  const [tickets, setTickets] = useState([]);
  const [tab, setTab] = useState('mine');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ priority: '', agentId: '', teamId: '' });
  const [counts, setCounts] = useState({ mine: 0, pending: 0, all: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const tabRef = useRef(tab);
  const filtersRef = useRef(filters);
  const searchRef = useRef(search);
  const meRef = useRef(me);
  const debounceTimerRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const currentTab = tabRef.current;
    const currentFilters = filtersRef.current || {};
    const currentSearch = searchRef.current || '';
    const filtersKey = JSON.stringify(currentFilters);

    setLoading(true);
    setError(null);

    try {
      const { data } = await getTickets(
        currentTab === 'mine' ? null : currentTab,
        currentTab === 'mine',
        { ...currentFilters, search: currentSearch }
      );

      // Uma busca antiga não pode sobrescrever a lista depois que o usuário
      // trocou de aba, filtro ou termo de pesquisa.
      const isCurrentRequest = requestId === requestIdRef.current;
      const isCurrentView = tabRef.current === currentTab
        && (searchRef.current || '') === currentSearch
        && JSON.stringify(filtersRef.current || {}) === filtersKey;
      if (!isCurrentRequest || !isCurrentView) return;

      setTickets(normalizeTicketsForTab(data.tickets || [], currentTab));
      setCounts(data.counts || { mine: 0, pending: 0, all: 0 });
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      console.error(error);
      if (requestId === requestIdRef.current) {
        setError(error);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const debouncedLoadTickets = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      loadTickets();
    }, 2000);
  }, [loadTickets]);

  const ticketMatchesCurrentView = useCallback((ticket) => {
    if (!ticket?.id) return false;

    const currentTab = tabRef.current;
    const currentFilters = filtersRef.current || {};
    const currentSearch = (searchRef.current || '').trim().toLowerCase();
    const currentUserId = meRef.current?.id;

    const pendingMatch =
      ticket.status === 'pending' ||
      ticket.status === 'bot' ||
      (ticket.status === 'open' && !ticket.agentId);

    const tabMatch =
      currentTab === 'mine'
        ? ticket.status === 'open' && ticket.agentId === currentUserId
        : currentTab === 'pending'
          ? pendingMatch
          : ['open', 'resolved'].includes(ticket.status);

    if (!tabMatch) return false;
    if (currentFilters.priority && ticket.priority !== currentFilters.priority) return false;
    if (currentFilters.agentId && ticket.agentId !== currentFilters.agentId) return false;
    if (currentFilters.teamId && ticket.teamId !== currentFilters.teamId) return false;

    if (currentSearch) {
      const name = (ticket.contact?.name || '').toLowerCase();
      const fantasyName = (ticket.contact?.fantasyName || '').toLowerCase();
      const cpfCnpj = (ticket.contact?.cpfCnpj || '').toLowerCase();
      const phone = (ticket.contact?.phone || '').toLowerCase();
      const whatsapp = (ticket.contact?.whatsapp || '').toLowerCase();

      if (!name.includes(currentSearch) && !fantasyName.includes(currentSearch) && !cpfCnpj.includes(currentSearch) && !phone.includes(currentSearch) && !whatsapp.includes(currentSearch)) {
        return false;
      }
    }

    return true;
  }, []);

  const upsertTicket = useCallback((incomingTicket) => {
    if (!incomingTicket?.id) return;

    setTickets((previous) => {
      if (!ticketMatchesCurrentView(incomingTicket)) {
        return previous.filter((ticket) => ticket.id !== incomingTicket.id);
      }

      const current = previous.find((ticket) => ticket.id === incomingTicket.id);
      const merged = {
        ...current,
        ...incomingTicket,
        contact: incomingTicket.contact || current?.contact,
        agent: incomingTicket.agent || current?.agent,
        team: incomingTicket.team || current?.team,
        instance: incomingTicket.instance || current?.instance,
      };

      const withoutCurrent = previous.filter((ticket) => ticket.id !== incomingTicket.id);
      return normalizeTicketsForTab([merged, ...withoutCurrent], tabRef.current);
    });
  }, [ticketMatchesCurrentView]);

  return {
    counts,
    debouncedLoadTickets,
    error,
    filters,
    loadTickets,
    loading,
    lastUpdatedAt,
    search,
    setFilters,
    setSearch,
    setTab,
    setTickets,
    tab,
    tickets,
    upsertTicket,
  };
}

export function useInboxMessages({
  historySearch,
  messagePageSize,
  scrollRef,
  selectedId,
  selectedIdRef,
  setSummary,
  shouldScrollToBottomRef,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextMessagesCursor, setNextMessagesCursor] = useState(null);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const loadMessages = useCallback(async ({
    ticketId = selectedIdRef.current,
    before = null,
    replace = true,
    background = false,
  } = {}) => {
    if (!ticketId) return;

    const requestId = ++requestIdRef.current;

    if (replace) {
      if (!background) setLoading(true);
    }
    else setLoadingMoreMessages(true);

    setSummary(null);
    setError(null);
    const previousScrollHeight = scrollRef.current?.scrollHeight || 0;
    const previousScrollTop = scrollRef.current?.scrollTop || 0;

    try {
      const { data } = await getMessages(ticketId, {
        limit: messagePageSize,
        includeHistory: true,
        ...(historySearch?.trim() ? { search: historySearch.trim() } : {}),
        ...(before ? { before } : {}),
      });
      const incomingItems = normalizeMessageItems(data?.items);

      // Ao trocar de conversa, a resposta pendente da conversa anterior deve
      // ser descartada para não contaminar o histórico atual.
      if (requestId !== requestIdRef.current || ticketId !== selectedIdRef.current) return;

      if (replace) {
        shouldScrollToBottomRef.current = true;
        setMessages(incomingItems);
      } else {
        setMessages((previous) => mergeMessagePages(previous, incomingItems, true));
        setTimeout(() => {
          if (scrollRef.current) {
            const newHeight = scrollRef.current.scrollHeight;
            scrollRef.current.scrollTop = newHeight - previousScrollHeight + previousScrollTop;
          }
        }, 0);
      }

      setHasMoreMessages(Boolean(data?.hasMore));
      setNextMessagesCursor(data?.nextCursor || null);
    } catch (error) {
      console.error(error);
      if (requestId === requestIdRef.current && ticketId === selectedIdRef.current) {
        setError(error);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        if (replace) setLoading(false);
        else setLoadingMoreMessages(false);
      }
    }
  }, [historySearch, messagePageSize, scrollRef, selectedIdRef, setSummary, shouldScrollToBottomRef]);

  const handleLoadMoreMessages = useCallback(async () => {
    if (!selectedId || !hasMoreMessages || !nextMessagesCursor || loadingMoreMessages) return;
    await loadMessages({ ticketId: selectedId, before: nextMessagesCursor, replace: false });
  }, [hasMoreMessages, loadMessages, loadingMoreMessages, nextMessagesCursor, selectedId]);

  return {
    handleLoadMoreMessages,
    hasMoreMessages,
    loadMessages,
    loading,
    loadingMoreMessages,
    messages,
    error,
    nextMessagesCursor,
    setMessages,
  };
}

export function useInboxRealtime({
  historySearchRef,
  loadInitial,
  loadMessages,
  loadTickets,
  selectedIdRef,
  setMessages,
  setTickets,
  shouldScrollToBottomRef,
  upsertTicket,
  debouncedLoadTickets,
}) {
  const [isDisconnected, setIsDisconnected] = useState(false);
  const socketRef = useRef(null);

  const onReconnect = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setIsDisconnected(false);
    socket.connect();
  }, []);

  useEffect(() => {
    loadInitial();
    const token = localStorage.getItem('token');
    const socket = io(SOCKET_URL, {
      auth: { token },
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;
    setIsDisconnected(!socket.connected);

    const refreshTimer = setInterval(() => {
      loadTickets();
    }, 30000);

    socket.on('new_message', ({ message, ticket }) => {
      if (!message || typeof message !== 'object') {
        console.error('[inbox] new_message invalida ignorada:', message);
        return;
      }

      if (ticket?.id === selectedIdRef.current) {
        if (historySearchRef?.current?.trim()) {
          loadMessages({ ticketId: selectedIdRef.current, replace: true, background: true }).catch((error) => console.error(error));
          return;
        }

        shouldScrollToBottomRef.current = true;
        setMessages((previous) => {
          const exists = previous.find((item) => item.id === message.id);
          if (exists) {
            return previous.map((item) => (item.id === message.id ? message : item));
          }
          return [...previous, message];
        });
      }

      if (ticket?.id) {
        const unreadCount =
          ticket.id === selectedIdRef.current
            ? 0
            : typeof ticket.unreadCount === 'number'
              ? ticket.unreadCount
              : undefined;

        upsertTicket({ ...ticket, unreadCount });
      } else {
        debouncedLoadTickets();
      }
    });

    socket.on('connect', () => {
      setIsDisconnected(false);
      loadTickets();
      if (selectedIdRef.current) {
        loadMessages({ ticketId: selectedIdRef.current, replace: true, background: true }).catch((error) => console.error(error));
      }
    });

    socket.on('message_updated', ({ message }) => {
      if (!message || typeof message !== 'object') {
        console.error('[inbox] message_updated invalida ignorada:', message);
        return;
      }

      if (historySearchRef?.current?.trim()) {
        loadMessages({ ticketId: selectedIdRef.current, replace: true, background: true }).catch((error) => console.error(error));
        return;
      }

      setMessages((previous) => previous.map((item) => (item.id === message.id ? message : item)));
    });

    socket.on('ticket_updated', (payload = {}) => {
      if (payload.ticket) {
        upsertTicket(payload.ticket);
        return;
      }

      const ticketId = payload.ticketId || payload.id;
      if (ticketId) {
        setTickets((previous) => previous.map((ticket) => (
          ticket.id === ticketId
            ? {
                ...ticket,
                ...(payload.status ? { status: payload.status } : {}),
                ...(typeof payload.unreadCount === 'number' ? { unreadCount: payload.unreadCount } : {}),
                updatedAt: new Date().toISOString(),
              }
            : ticket
        )));
      } else {
        debouncedLoadTickets();
      }
    });

    socket.on('connect_error', (error) => {
      console.error('[socket] erro de conexao:', error.message);
      setIsDisconnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.warn('[socket] conexao encerrada:', reason);
      setIsDisconnected(true);
    });

    return () => {
      clearInterval(refreshTimer);
      if (socketRef.current === socket) socketRef.current = null;
      socket.disconnect();
    };
  }, [
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
  ]);

  return { isDisconnected, onReconnect };
}
