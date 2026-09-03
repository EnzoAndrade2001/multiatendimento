import React, { useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import io from 'socket.io-client';
import { SOCKET_URL } from '../services/socket';
import {
  MessageSquare,
  MessageCircle,
  LayoutDashboard,
  Settings,
  Users,
  Database,
  Link as LinkIcon,
  HelpCircle,
  Megaphone,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  Zap,
  Bell,
  ChevronDown,
  Radar,
  Coins,
  Search,
  Command,
  X,
  BarChart2,
  ClipboardCheck,
  Activity,
  LayoutGrid,
  AlertTriangle,
} from 'lucide-react';
import { getMe, getMediaUrl, getInstances, getInternalConversations } from '../services/api';
import UserAvatar from './ui/UserAvatar';
import { useIsMobile } from '../hooks/useIsMobile';
import ToastContainer from './ToastContainer';
import InternalChatDrawer from './InternalChatDrawer';
import { usePermissions } from '../auth/PermissionContext';

const PRIMARY_NAV_PATHS = ['/dashboard', '/inbox', '/crm', '/revenue'];

// Ordem das seções no menu "Operação".
const NAV_SECTION_ORDER = ['Clientes & conversas', 'Aquisição', 'Inteligência & gestão', 'Sistema'];

const MOBILE_LINKS = [
  { to: '/dashboard', icon: <LayoutDashboard size={22} />, label: 'Dash', permission: 'dashboard.view' },
  { to: '/inbox', icon: <MessageSquare size={22} />, label: 'Chat', permission: 'inbox.view' },
  { to: '/crm', icon: <Database size={22} />, label: 'CRM', permission: 'crm.view' },
  { to: '/settings', icon: <Settings size={22} />, label: 'Ajustes' },
];

function getInstanceHealth(instance) {
  const state = String(instance?.state || instance?.lastConnectionState || '').toLowerCase();
  const health = String(instance?.healthStatus || '').toLowerCase();
  if (instance?.status === 'connected' && (state === 'open' || health === 'healthy')) return 'healthy';
  if (state === 'connecting' || health === 'unstable' || instance?.status === 'connecting') return 'unstable';
  if (state === 'close' || health === 'offline' || instance?.status === 'disconnected') return 'offline';
  return 'degraded';
}

export default function Layout() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [notification, setNotification] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [internalChatWidth, setInternalChatWidth] = useState(0);
  const [internalSocket, setInternalSocket] = useState(null);
  const [incomingInternalMessage, setIncomingInternalMessage] = useState(null);
  const [initialInternalConversationKey, setInitialInternalConversationKey] = useState(null);
  const [internalSummary, setInternalSummary] = useState({ unread: 0, mentions: 0 });
  const audioRef = React.useRef(new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3'));
  const notificationTimerRef = React.useRef(null);
  const isChatOpenRef = React.useRef(false);
  const seenInternalEventsRef = React.useRef(new Set());
  const seenMentionEventsRef = React.useRef(new Set());
  const desktopMenuRef = React.useRef(null);
  const userMenuRef = React.useRef(null);
  const role = localStorage.getItem('role')?.toLowerCase();
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [instances, setInstances] = useState([]);
  const [realtimeConnected, setRealtimeConnected] = useState(true);
  const isMobile = useIsMobile();
  const canUseInternalChat = can('internal_chat.view');

  function getNotificationBody(message) {
    const text = message?.body?.trim();
    if (text) return text;

    const mediaLabels = {
      image: 'Imagem recebida',
      video: 'Video recebido',
      audio: 'Audio recebido',
      document: 'Documento recebido',
      sticker: 'Sticker recebido',
    };

    return mediaLabels[message?.mediaType] || 'Nova mensagem recebida';
  }

  function logout() {
    localStorage.clear();
    navigate('/login');
  }

  React.useEffect(() => {
    document.body.className = theme === 'dark' ? 'dark-theme' : 'light-theme';
    localStorage.setItem('theme', theme);
  }, [theme]);

  React.useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  React.useEffect(() => {
    const baseTitle = 'Multiatendimento';
    const pending = Number(internalSummary.unread || 0);
    document.title = pending > 0 ? `(${pending > 99 ? '99+' : pending}) ${baseTitle}` : baseTitle;
    return () => { document.title = baseTitle; };
  }, [internalSummary.unread]);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const tenantId = localStorage.getItem('tenantId');
    if (!tenantId) return undefined;

    getMe()
      .then((res) => {
        setCurrentUser(res.data);
        setTenant(res.data.tenant);
      })
      .catch(() => {});

    const onProfileUpdated = (event) => {
      if (event.detail) setCurrentUser((previous) => ({ ...previous, ...event.detail }));
    };
    window.addEventListener('user-profile-updated', onProfileUpdated);

    if (canUseInternalChat) {
      getInternalConversations()
        .then(({ data }) => {
          const conversations = Array.isArray(data?.conversations) ? data.conversations : [];
          setInternalSummary({
            unread: conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0),
            mentions: conversations.reduce((sum, item) => sum + Number(item.mentionCount || 0), 0),
          });
        })
        .catch(() => {});
    }

    const token = localStorage.getItem('token');
    const socket = io(SOCKET_URL, {
      auth: { token },
      reconnectionDelayMax: 10000,
    });
    setInternalSocket(socket);
    socket.on('connect', () => setRealtimeConnected(true));
    socket.on('disconnect', () => setRealtimeConnected(false));
    socket.on('connect_error', () => setRealtimeConnected(false));

    // /instance/list consulta a Evolution por instância (pode demorar/falhar).
    // Uma falha transitória aqui deixava o app sem lista de instâncias até um
    // reload completo, então tentamos de novo algumas vezes.
    let instancesTries = 0;
    const loadInstances = () => {
      getInstances()
        .then((res) => {
          if (Array.isArray(res.data) && res.data.length) {
            setInstances(res.data);
          } else if (instancesTries < 3) {
            instancesTries += 1;
            setTimeout(loadInstances, 4000);
          }
        })
        .catch(() => {
          if (instancesTries < 3) {
            instancesTries += 1;
            setTimeout(loadInstances, 4000);
          }
        });
    };
    loadInstances();
    const instancesRefreshTimer = window.setInterval(loadInstances, 30000);

    socket.on('new_message', ({ message, contact, fromMe }) => {
      if (fromMe) return;

      const notificationBody = getNotificationBody(message);
      audioRef.current.play().catch(() => {});
      setNotification({ name: contact?.name || contact?.phone || 'Contato', body: notificationBody });
      window.clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = window.setTimeout(() => setNotification(null), 5000);

      if (typeof window !== 'undefined' && window.Notification && Notification.permission === 'granted') {
        new Notification(`Nova mensagem de ${contact?.name || contact?.phone || 'Contato'}`, {
          body: notificationBody,
          icon: '/logo192.png',
        });
      }
    });

    socket.on('new_internal', (msg) => {
      const myId = localStorage.getItem('userId');
      if (!msg?.id || seenInternalEventsRef.current.has(msg.id)) return;
      seenInternalEventsRef.current.add(msg.id);
      if (seenInternalEventsRef.current.size > 500) {
        const first = seenInternalEventsRef.current.values().next().value;
        seenInternalEventsRef.current.delete(first);
      }

      setIncomingInternalMessage(msg);
      if (msg.senderId === myId) return;

      setInternalSummary((previous) => ({ ...previous, unread: Number(previous.unread || 0) + 1 }));

      if (isChatOpenRef.current) return;

      audioRef.current.play().catch(() => {});
      setNotification({
        name: `Equipe: ${msg.sender?.name || 'Colega'}`,
        body: msg.body || (msg.attachmentName ? `Anexo: ${msg.attachmentName}` : 'Nova mensagem interna'),
        isInternal: true,
        conversationKey: msg.teamId
          ? `team:${msg.teamId}`
          : `direct:${msg.senderId}`,
      });
      window.clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = window.setTimeout(() => setNotification(null), 5000);

      if (typeof window !== 'undefined' && window.Notification && Notification.permission === 'granted') {
        const systemNotification = new Notification(`Equipe: ${msg.sender?.name || 'Colega'}`, { body: msg.body || (msg.attachmentName ? `Anexo: ${msg.attachmentName}` : 'Nova mensagem interna') });
        systemNotification.onclick = () => {
          window.focus();
          setInitialInternalConversationKey(msg.teamId ? `team:${msg.teamId}` : `direct:${msg.senderId}`);
          setIsChatOpen(true);
          systemNotification.close();
        };
      }
    });

    socket.on('internal_mention', ({ message, mentionedUserId, mentionedTeamId } = {}) => {
      const myId = localStorage.getItem('userId');
      if (!message?.id || message.senderId === myId) return;
      const mentionKey = `${message.id}:${mentionedUserId || mentionedTeamId || myId}`;
      if (seenMentionEventsRef.current.has(mentionKey)) return;
      seenMentionEventsRef.current.add(mentionKey);
      if (seenMentionEventsRef.current.size > 500) {
        const first = seenMentionEventsRef.current.values().next().value;
        seenMentionEventsRef.current.delete(first);
      }
      setInternalSummary((previous) => ({ ...previous, mentions: Number(previous.mentions || 0) + 1 }));
    });

    socket.on('connection_update', ({ instance, data }) => {
      setInstances((prev) => 
        prev.map((inst) => {
          if (inst.instanceName === instance) {
            const state = String(data?.state || '').toLowerCase();
            const healthStatus = data?.healthStatus;
            if (state === 'open') return { ...inst, status: 'connected', state: 'open', healthStatus: healthStatus || 'healthy', lastConnectionState: 'open', lastWebhookAt: data?.receivedAt || inst.lastWebhookAt };
            if (state === 'connecting') return { ...inst, status: 'connecting', state: 'connecting', healthStatus: healthStatus || 'unstable', lastConnectionState: 'connecting', lastWebhookAt: data?.receivedAt || inst.lastWebhookAt };
            if (state === 'close') return { ...inst, status: data?.confirmed ? 'disconnected' : 'connecting', state: 'close', healthStatus: healthStatus || (data?.confirmed ? 'offline' : 'unstable'), lastConnectionState: 'close', lastWebhookAt: data?.receivedAt || inst.lastWebhookAt };
            if (healthStatus === 'degraded') return { ...inst, status: 'degraded', state: 'unknown', healthStatus, lastHealthError: data?.error || inst.lastHealthError };
          }
          return inst;
        })
      );
    });

    return () => {
      window.clearTimeout(notificationTimerRef.current);
      window.removeEventListener('user-profile-updated', onProfileUpdated);
      window.clearInterval(instancesRefreshTimer);
      setInternalSocket(null);
      setRealtimeConnected(false);
      socket.disconnect();
    };
  }, [canUseInternalChat]);

  React.useEffect(() => {
    function handlePointerDown(event) {
      if (desktopMenuRef.current && !desktopMenuRef.current.contains(event.target)) {
        setDesktopMenuOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    }

    if (desktopMenuOpen || userMenuOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [desktopMenuOpen, userMenuOpen]);

  React.useEffect(() => {
    setDesktopMenuOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  React.useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setDesktopMenuOpen(false);
        setUserMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const unhealthyInstances = React.useMemo(
    () => instances.filter((instance) => getInstanceHealth(instance) !== 'healthy'),
    [instances]
  );
  const unstableInstances = React.useMemo(
    () => unhealthyInstances.filter((instance) => getInstanceHealth(instance) === 'unstable'),
    [unhealthyInstances]
  );
  const degradedInstances = React.useMemo(
    () => unhealthyInstances.filter((instance) => getInstanceHealth(instance) === 'degraded'),
    [unhealthyInstances]
  );
  const disconnectedInstances = React.useMemo(
    () => unhealthyInstances.filter((instance) => getInstanceHealth(instance) === 'offline'),
    [unhealthyInstances]
  );

  const desktopLinks = React.useMemo(() => [
    // Barra principal
    { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Dashboard', permission: 'dashboard.view', roles: ['admin', 'agent', 'superadmin'] },
    { to: '/inbox', icon: <MessageSquare size={18} />, label: 'Chat', permission: 'inbox.view', roles: ['admin', 'agent', 'superadmin'] },
    { to: '/crm', icon: <Database size={18} />, label: 'CRM', permission: 'crm.view', roles: ['admin', 'agent', 'superadmin'] },
    { to: '/revenue', icon: <Coins size={18} />, label: 'iLux Sentinela', permission: 'revenue.view', roles: ['admin', 'superadmin'] },
    // Operação › Clientes & conversas
    { section: 'Clientes & conversas', action: () => setIsChatOpen(true), icon: <MessageCircle size={18} />, label: 'Chat Interno', permission: 'internal_chat.view', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Clientes & conversas', to: '/contacts', icon: <Users size={18} />, label: 'Clientes WhatsApp', permission: 'crm.view', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Clientes & conversas', to: '/quick-responses', icon: <Zap size={18} />, label: 'Respostas Rápidas', permission: 'quick_responses.manage', roles: ['admin', 'agent', 'superadmin'] },
    // Operação › Aquisição
    { section: 'Aquisição', to: '/campaigns', icon: <Megaphone size={18} />, label: 'Campanhas', permission: 'campaigns.manage', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Aquisição', to: '/leads', icon: <Radar size={18} />, label: 'Prospecção', permission: 'leads.manage', roles: ['admin', 'agent', 'superadmin'] },
    // Operação › Inteligência & gestão
    { section: 'Inteligência & gestão', to: '/knowledge', icon: <HelpCircle size={18} />, label: 'Treinamento IA', permission: 'settings.bot.manage', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Inteligência & gestão', to: '/telemetry', icon: <Activity size={18} />, label: 'Telemetria', permission: 'telemetry.view', roles: ['admin', 'supervisor', 'agent', 'tecnico', 'superadmin'] },
    { section: 'Inteligência & gestão', to: '/billing-reports', icon: <BarChart2 size={18} />, label: 'Relatórios de Cobrança', permission: 'billing.view', roles: ['admin', 'superadmin'] },
    // Operação › Sistema
    { section: 'Sistema', to: '/connections', icon: <LinkIcon size={18} />, label: 'Conexões', permission: 'connections.manage', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Sistema', to: '/audit', icon: <ClipboardCheck size={18} />, label: 'Auditoria do sistema', permission: 'audit.view', roles: ['admin', 'superadmin'] },
    { section: 'Sistema', to: '/privacy', icon: <ShieldCheck size={18} />, label: 'Privacidade', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Sistema', to: '/settings', icon: <Settings size={18} />, label: 'Ajustes', roles: ['admin', 'agent', 'superadmin'] },
    { section: 'Sistema', to: '/superadmin', icon: <ShieldCheck size={18} />, label: 'Painel Admin', roles: ['superadmin'] },
  ], [setIsChatOpen]);

  const visibleDesktopLinks = desktopLinks.filter((link) => (
    link.to === '/superadmin' ? role === 'superadmin' : (!link.permission || can(link.permission))
  ));
  const primaryDesktopLinks = visibleDesktopLinks.filter((link) => PRIMARY_NAV_PATHS.includes(link.to));
  const secondaryDesktopLinks = visibleDesktopLinks.filter((link) => !PRIMARY_NAV_PATHS.includes(link.to));
  const commandResults = visibleDesktopLinks.filter((link) => (
    !commandQuery.trim() || link.label.toLowerCase().includes(commandQuery.trim().toLowerCase())
  ));

  function activateNavigationItem(link) {
    setCommandOpen(false);
    setCommandQuery('');
    setDesktopMenuOpen(false);
    if (link.to) navigate(link.to);
    else link.action?.();
  }

  return (
    <div style={{ ...styles.root, paddingRight: !isMobile && isChatOpen ? `${internalChatWidth}px` : 0 }} className="app-layout-root">
      <style>{`
        .desktop-nav-scroll::-webkit-scrollbar {
          display: none;
        }
        .primary-nav-link, .header-action-button, .user-menu-item { transition: background-color .16s ease, border-color .16s ease, color .16s ease, transform .16s ease; }
        .primary-nav-link:hover, .header-action-button:hover, .user-menu-item:hover { background: var(--bg-hover, var(--accent-light)) !important; color: var(--text-main) !important; }
        .primary-nav-link:focus-visible, .header-action-button:focus-visible, .user-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        @media (max-width: 1180px) {
          .header-chat-label { display: none; }
        }
      `}</style>
      <nav style={{ ...styles.nav, padding: isMobile ? '0 var(--space-4)' : '0 var(--space-6)' }}>
        <div style={styles.brandGroup}>
          {tenant?.logoUrl ? (
            <div style={{ ...styles.logoFrame, width: isMobile ? '76px' : '98px', height: isMobile ? '42px' : '52px' }}>
              <img
                src={getMediaUrl(tenant.logoUrl)}
                alt={tenant?.name || 'Logo da empresa'}
                style={{
                  maxWidth: '100%',
                  maxHeight: isMobile ? '32px' : '41px',
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
          ) : (
            <>
              <span style={styles.brandIcon}>MA</span>
              <span style={{ ...styles.brand, fontSize: isMobile ? '0.92rem' : '1.05rem' }}>
                Multiatendimento <span style={styles.proTag}>PRO</span>
              </span>
            </>
          )}
        </div>

        {!isMobile ? (
          <div style={styles.centerNav}>
            <div style={{ ...styles.links }} className="desktop-nav-scroll" aria-label="Navegação principal">
              {primaryDesktopLinks.map((link) => (
                <NavLink className="primary-nav-link" key={link.to} to={link.to} end={link.to === '/dashboard'} style={({ isActive }) => ({ ...styles.primaryLink, ...(isActive ? styles.linkActive : {}) })}>
                  {link.icon}
                  <span>{link.label === 'Chat' ? 'Atendimento' : link.label}</span>
                </NavLink>
              ))}
              <div style={styles.moreMenuWrap} ref={desktopMenuRef}>
                <button
                  type="button"
                  className="primary-nav-link"
                  onClick={() => setDesktopMenuOpen((open) => !open)}
                  style={{ ...styles.primaryLink, ...styles.moreMenuBtn, ...(secondaryDesktopLinks.some((link) => link.to === location.pathname) ? styles.linkActive : {}) }}
                  aria-expanded={desktopMenuOpen}
                  aria-haspopup="menu"
                >
                  <LayoutGrid size={18} />
                  <span>Operação</span>
                  <ChevronDown size={15} />
                </button>
                {desktopMenuOpen ? (
                  <div style={styles.moreMenuDropdown} role="menu">
                    {NAV_SECTION_ORDER.map((section) => {
                      const items = secondaryDesktopLinks.filter((link) => (link.section || 'Sistema') === section);
                      if (!items.length) return null;
                      return (
                        <div key={section} style={styles.moreMenuGroup}>
                          <div style={styles.moreMenuGroupLabel}>{section}</div>
                          {items.map((link) => (
                            <button
                              key={link.to || link.label}
                              type="button"
                              role="menuitem"
                              onClick={() => activateNavigationItem(link)}
                              style={{ ...styles.moreMenuItem, ...(link.to === location.pathname ? styles.moreMenuItemActive : {}) }}
                            >
                              {link.icon}<span>{link.label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div style={styles.rightActions}>
          {!isMobile ? (
            <button type="button" className="header-action-button" onClick={() => setCommandOpen(true)} style={styles.commandButton} aria-label="Abrir busca de ações">
              <Search size={17} />
              <span>Buscar</span>
              <kbd style={styles.commandKey}>Ctrl K</kbd>
            </button>
          ) : null}
          {canUseInternalChat ? (
            <button
              type="button"
              className="header-action-button"
              onClick={() => {
                setInitialInternalConversationKey(null);
                setIsChatOpen(true);
              }}
              style={styles.internalChatButton}
              title="Abrir chat interno"
              aria-label={`Abrir chat interno${internalSummary.unread ? `, ${internalSummary.unread} mensagens não lidas` : ''}`}
            >
              <MessageCircle size={18} />
              {!isMobile ? <span className="header-chat-label">Chat interno</span> : null}
              {internalSummary.unread > 0 ? (
                <span style={styles.internalChatBadge} aria-hidden="true">
                  {internalSummary.unread > 99 ? '99+' : internalSummary.unread}
                </span>
              ) : null}
              {internalSummary.mentions > 0 ? <span style={styles.mentionDot} title={`${internalSummary.mentions} menções pendentes`}>@</span> : null}
            </button>
          ) : null}
          {currentUser?.name ? (
            <div ref={userMenuRef} style={styles.userMenuWrap}>
              <button type="button" className="header-action-button" style={{ ...styles.userIdentity, ...(isMobile ? styles.userIdentityMobile : {}) }} onClick={() => setUserMenuOpen((open) => !open)} aria-expanded={userMenuOpen} aria-haspopup="menu" title={`Usuário conectado: ${currentUser.name}`}>
                <UserAvatar user={currentUser} size={30} style={styles.userAvatar} />
                {!isMobile ? <span style={styles.userName}>{currentUser.name}</span> : null}
                {!isMobile ? <ChevronDown size={14} /> : null}
              </button>
              {userMenuOpen ? <div style={styles.userMenu} role="menu">
                <div style={styles.userMenuHeader}>
                  <UserAvatar user={currentUser} size={38} style={styles.userMenuAvatar} />
                  <span style={styles.userMenuProfile}><strong>{currentUser.name}</strong><small>{currentUser.email || 'Usuário do sistema'}</small></span>
                </div>
                <button type="button" className="user-menu-item" role="menuitem" style={styles.userMenuItem} onClick={() => { setUserMenuOpen(false); navigate('/settings?tab=account'); }}><Settings size={17} /><span>Minha conta</span></button>
                <button type="button" className="user-menu-item" role="menuitem" style={styles.userMenuItem} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}<span>{theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}</span></button>
                <div style={styles.userMenuDivider} />
                <button type="button" className="user-menu-item" role="menuitem" style={{ ...styles.userMenuItem, color: 'var(--danger)' }} onClick={logout}><LogOut size={17} /><span>Sair do sistema</span></button>
              </div> : null}
            </div>
          ) : null}
        </div>
      </nav>

      {(unstableInstances.length > 0 || degradedInstances.length > 0) && (
        <div style={{
          backgroundColor: 'var(--warning, #F59E0B)',
          color: '#17130A',
          padding: '0.65rem 1rem',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: isMobile ? '0.8rem' : '0.9rem',
          zIndex: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
        }}>
          <AlertTriangle size={16} />
          {unstableInstances.length > 0
            ? `A Evolution está reconectando ${unstableInstances.length === 1 ? 'uma conexão' : `${unstableInstances.length} conexões`}. As mensagens serão sincronizadas quando voltar.`
            : 'A Evolution está sem resposta. O painel continuará verificando automaticamente.'}
        </div>
      )}

      {(!realtimeConnected || disconnectedInstances.length > 0) && (
        <div style={{
          backgroundColor: !realtimeConnected ? 'var(--warning, #F59E0B)' : 'var(--danger, #EF4444)',
          color: !realtimeConnected ? '#17130A' : '#fff',
          padding: '0.65rem 1rem',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: isMobile ? '0.8rem' : '0.9rem',
          zIndex: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)'
        }}>
          ⚠️ Atenção: Você tem {disconnectedInstances.length === 1 ? 'uma conexão do WhatsApp desconectada' : `${disconnectedInstances.length} conexões do WhatsApp desconectadas`}! Clique em "Conexões" no menu para reconectar e voltar a receber mensagens.
        </div>
      )}

      <div style={{ ...styles.content, paddingBottom: isMobile ? '74px' : '0' }} className="app-layout-content">
        <Outlet context={{ instances }} />
      </div>

      {isMobile ? (
        <div style={styles.bottomNav}>
          {MOBILE_LINKS.filter((link) => !link.permission || can(link.permission)).map((link) => (
            <NavLink key={link.to} to={link.to} style={({ isActive }) => ({ ...styles.bottomLink, ...(isActive ? styles.bottomLinkActive : {}) })}>
              {link.icon}
              <span style={styles.bottomLabel}>{link.label}</span>
            </NavLink>
          ))}
        </div>
      ) : null}

      {notification ? (
        <div
          style={{ ...styles.toast, right: isMobile ? 'var(--space-4)' : 'var(--space-8)', left: isMobile ? 'var(--space-4)' : 'auto' }}
          onClick={() => {
            if (notification.isInternal) {
              setInitialInternalConversationKey(notification.conversationKey || null);
              setIsChatOpen(true);
            } else {
              navigate('/inbox');
            }
            setNotification(null);
          }}
        >
          <div style={styles.toastIcon}>
            <Bell size={18} color="var(--accent)" />
          </div>
          <div style={styles.toastBody}>
            <div style={styles.toastName}>{notification.name}</div>
            <div style={styles.toastMsg}>
              {notification.body.length > 64 ? `${notification.body.slice(0, 64)}...` : notification.body}
            </div>
          </div>
        </div>
      ) : null}

      {commandOpen ? (
        <div style={styles.commandOverlay} role="presentation" onMouseDown={() => setCommandOpen(false)}>
          <div style={styles.commandPalette} role="dialog" aria-modal="true" aria-label="Busca rápida" onMouseDown={(event) => event.stopPropagation()}>
            <div style={styles.commandSearchRow}>
              <Search size={19} color="var(--text-tertiary, var(--text-dim))" />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Ir para uma área ou ação..."
                style={styles.commandInput}
              />
              <button type="button" onClick={() => setCommandOpen(false)} style={styles.commandClose} title="Fechar busca" aria-label="Fechar busca"><X size={18} /></button>
            </div>
            <div style={styles.commandResults}>
              <div style={styles.commandSectionLabel}><Command size={14} /> Navegação</div>
              {commandResults.map((link) => (
                <button key={link.to || link.label} type="button" onClick={() => activateNavigationItem(link)} style={styles.commandResult}>
                  <span style={styles.commandResultIcon}>{link.icon}</span>
                  <span>{link.label}</span>
                </button>
              ))}
              {!commandResults.length ? <div style={styles.commandEmpty}>Nenhuma ação encontrada.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {canUseInternalChat ? (
        <InternalChatDrawer
          isOpen={isChatOpen}
          onClose={() => {
            setIsChatOpen(false);
            setInitialInternalConversationKey(null);
          }}
          socket={internalSocket}
          incomingMessage={incomingInternalMessage}
          initialConversationKey={initialInternalConversationKey}
          onSummaryChange={setInternalSummary}
          isMobile={isMobile}
          onWidthChange={setInternalChatWidth}
        />
      ) : null}
      <ToastContainer />
    </div>
  );
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box', background: 'var(--bg-base)', transition: 'padding-right .2s ease' },
  nav: {
    position: 'relative',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-5)',
    height: '68px',
    background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-main)',
    flexShrink: 0,
  },
  brandGroup: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 },
  logoFrame: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '5px 9px',
    borderRadius: '10px',
    background: '#FFFFFF',
    border: '1px solid rgba(15, 23, 42, 0.16)',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.12)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  brandIcon: {
    width: '34px',
    height: '34px',
    borderRadius: '12px',
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: '0.8rem',
    letterSpacing: '0.04em',
  },
  brand: { fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' },
  proTag: { color: 'var(--accent)', fontSize: '0.62rem', verticalAlign: 'top', marginLeft: '0.2rem' },
  centerNav: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.65rem', justifyContent: 'center' },
  links: { display: 'flex', gap: '0.45rem', minWidth: 0, overflow: 'visible' },
  primaryLink: {
    minHeight: '40px',
    padding: '0 0.85rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    color: 'var(--text-muted)',
    textDecoration: 'none',
    borderRadius: 'var(--radius-control, 10px)',
    border: '1px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.86rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    height: '38px',
    color: 'var(--text-muted)',
    textDecoration: 'none',
    borderRadius: '12px',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },
  linkActive: {
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    fontWeight: 700,
    boxShadow: 'inset 0 0 0 1px var(--accent-border)',
  },
  moreMenuWrap: { position: 'relative', flexShrink: 0 },
  moreMenuBtn: { background: 'transparent', border: '1px solid transparent' },
  moreMenuDropdown: {
    position: 'absolute',
    top: 'calc(100% + 0.6rem)',
    right: 0,
    minWidth: '236px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: '18px',
    padding: '0.5rem',
    boxShadow: '0 20px 40px rgba(0,0,0,0.22)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    zIndex: 1200,
    maxHeight: 'calc(100vh - 120px)',
    overflowY: 'auto',
  },
  moreMenuGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1rem',
    paddingTop: '0.35rem',
    marginTop: '0.15rem',
    borderTop: '1px solid var(--border-color)',
  },
  moreMenuGroupLabel: {
    fontSize: '0.66rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-dim)',
    padding: '0.25rem 0.9rem 0.35rem',
  },
  moreMenuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.75rem 0.9rem',
    borderRadius: '12px',
    textDecoration: 'none',
    color: 'var(--text-muted)',
    fontWeight: 700,
    fontSize: '0.88rem',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    width: '100%',
    fontFamily: 'inherit',
  },
  moreMenuItemActive: {
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    boxShadow: 'inset 0 0 0 1px var(--accent-border)',
  },
  rightActions: { display: 'flex', alignItems: 'center', gap: '0.8rem', flexShrink: 0 },
  internalChatButton: {
    position: 'relative',
    minWidth: '38px',
    height: '38px',
    padding: '0 0.7rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.45rem',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    background: 'var(--bg-surface)',
    color: 'var(--text-muted)',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 750,
    cursor: 'pointer',
  },
  internalChatBadge: {
    position: 'absolute',
    top: '-7px',
    right: '-7px',
    minWidth: '20px',
    height: '20px',
    padding: '0 5px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '999px',
    border: '2px solid var(--bg-panel)',
    background: 'var(--danger)',
    color: '#fff',
    fontSize: '0.64rem',
    fontWeight: 900,
    lineHeight: 1,
  },
  mentionDot: {
    position: 'absolute',
    bottom: '-6px',
    right: '-6px',
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '2px solid var(--bg-panel)',
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    fontSize: '0.65rem',
    fontWeight: 900,
  },
  userIdentity: {
    height: '38px',
    padding: '0 .55rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    minWidth: 0,
    maxWidth: '180px',
    color: 'var(--text-main)',
    fontSize: '0.82rem',
    fontWeight: 700,
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    background: 'var(--bg-surface)',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  userIdentityMobile: {
    maxWidth: '34px',
  },
  userAvatar: {
    width: '30px',
    height: '30px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    flexShrink: 0,
    background: 'var(--accent-light)',
    border: '1px solid var(--accent-border)',
    color: 'var(--accent)',
    fontSize: '0.78rem',
    fontWeight: 900,
  },
  userName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  userMenuWrap: { position: 'relative' },
  userMenu: { position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 1250, width: '260px', padding: '.45rem', border: '1px solid var(--border-color)', borderRadius: '14px', background: 'var(--bg-panel)', boxShadow: '0 18px 45px rgba(0,0,0,.22)' },
  userMenuHeader: { padding: '.65rem', display: 'flex', alignItems: 'center', gap: '.65rem' },
  userMenuAvatar: { width: '38px', height: '38px', flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--accent)', color: 'var(--text-inverse)', fontWeight: 900 },
  userMenuProfile: { minWidth: 0, display: 'grid', gap: '2px', color: 'var(--text-main)', fontSize: '.82rem' },
  userMenuItem: { width: '100%', minHeight: '40px', padding: '0 .7rem', display: 'flex', alignItems: 'center', gap: '.6rem', border: 0, borderRadius: '9px', background: 'transparent', color: 'var(--text-muted)', font: 'inherit', fontSize: '.8rem', fontWeight: 700, textAlign: 'left', cursor: 'pointer' },
  userMenuDivider: { height: '1px', margin: '.35rem .3rem', background: 'var(--border-color)' },
  commandButton: {
    height: '38px',
    minWidth: '150px',
    padding: '0 0.55rem 0 0.75rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    borderRadius: 'var(--radius-control, 10px)',
    fontFamily: 'inherit',
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  commandKey: {
    marginLeft: 'auto',
    padding: '0.18rem 0.38rem',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
    color: 'var(--text-tertiary, var(--text-dim))',
    background: 'var(--bg-panel)',
    fontFamily: 'inherit',
    fontSize: '0.68rem',
  },
  themeBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '38px',
    height: '38px',
    borderRadius: '12px',
  },
  logout: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    borderRadius: '12px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 700,
  },
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  bottomNav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: '74px',
    background: 'var(--bg-panel)',
    borderTop: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 1000,
  },
  bottomLink: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    textDecoration: 'none',
    color: 'var(--text-dim)',
    padding: '0.45rem 0.6rem',
    borderRadius: '14px',
  },
  bottomLinkActive: {
    color: 'var(--accent)',
    background: 'var(--accent-light)',
  },
  bottomLabel: { fontSize: '0.65rem', fontWeight: 700 },
  toast: {
    position: 'fixed',
    top: '84px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--accent-border)',
    padding: '0.95rem 1rem',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '0.85rem',
    boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
    zIndex: 9999,
    cursor: 'pointer',
    animation: 'slideIn 0.3s ease-out',
    maxWidth: '24rem',
  },
  toastIcon: {
    width: '36px',
    height: '36px',
    borderRadius: '12px',
    background: 'var(--accent-light)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toastBody: { minWidth: 0 },
  toastName: { fontWeight: 800, color: 'var(--text-main)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toastMsg: { color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '2px', lineHeight: 1.45 },
  commandOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 5000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '12vh 1rem 1rem',
    background: 'var(--overlay-bg)',
    backdropFilter: 'blur(6px)',
  },
  commandPalette: {
    width: 'min(620px, 100%)',
    overflow: 'hidden',
    borderRadius: 'var(--radius-dialog, 18px)',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-elevated, var(--bg-surface))',
    boxShadow: 'var(--shadow-overlay, 0 24px 72px rgba(0,0,0,.34))',
  },
  commandSearchRow: {
    minHeight: '64px',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0 1rem',
    borderBottom: '1px solid var(--border-color)',
  },
  commandInput: {
    flex: 1,
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'var(--text-main)',
    fontSize: '1rem',
    fontFamily: 'inherit',
  },
  commandClose: {
    width: '36px',
    height: '36px',
    borderRadius: 'var(--radius-control, 10px)',
    border: '1px solid var(--border-color)',
    background: 'transparent',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  commandResults: { maxHeight: '390px', overflowY: 'auto', padding: '0.65rem' },
  commandSectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.45rem 0.55rem 0.65rem',
    color: 'var(--text-tertiary, var(--text-dim))',
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  commandResult: {
    width: '100%',
    minHeight: '46px',
    padding: '0 0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    border: 'none',
    borderRadius: 'var(--radius-control, 10px)',
    background: 'transparent',
    color: 'var(--text-main)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    fontWeight: 600,
    textAlign: 'left',
  },
  commandResultIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '9px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    background: 'var(--accent-light)',
  },
  commandEmpty: { padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' },
};
