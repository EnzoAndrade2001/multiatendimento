import React, { useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowLeft,
  Bell,
  Bot,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Database,
  Headphones,
  LayoutDashboard,
  Menu,
  MoreVertical,
  Paperclip,
  PanelRight,
  Plus,
  Search,
  Send,
  Settings,
  Tag,
  Users,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import './MockInbox.css';

const MOCK_TICKETS = [
  {
    id: 'secont',
    name: 'Secont Fiscal',
    phone: '+55 47 9930-7657',
    initials: 'SF',
    color: '#2b9d9d',
    preview: 'Preciso de ajuda com a emissão de uma nota fiscal.',
    time: '10:24',
    status: 'open',
    queue: 'mine',
    team: 'Fiscal',
    unread: 2,
    tags: ['Cliente', 'Fiscal'],
    lastSeen: 'Online agora',
    equipment: '3 equipamentos',
    messages: [
      { from: 'contact', text: 'Olá! Preciso de ajuda com a emissão de uma nota fiscal.', time: '10:24' },
      { from: 'agent', text: 'Olá, claro! Posso te ajudar. Você já possui todas as informações necessárias?', time: '10:25' },
      { from: 'contact', text: 'Tenho os dados da empresa e do cliente, mas estou com dúvida no CFOP.', time: '10:25' },
      { from: 'agent', text: 'Entendi! Me informe o tipo de operação que você está realizando.', time: '10:26' },
      { from: 'contact', text: 'É uma venda de mercadoria para outro estado.', time: '10:26' },
      { from: 'agent', text: 'Nesse caso, o CFOP recomendado é 6.102. Posso te enviar um exemplo?', time: '10:27' },
      { from: 'contact', text: 'Isso, por favor! Vai me ajudar bastante.', time: '10:27' },
    ],
  },
  {
    id: 'ac',
    name: 'AC Soluções',
    phone: '+55 48 98812-4201',
    initials: 'AC',
    color: '#168b9a',
    preview: 'Conseguiram resolver meu problema, muito obrigado!',
    time: '10:15',
    status: 'pending',
    queue: 'pending',
    team: 'Suporte',
    unread: 1,
    tags: ['Cliente'],
    lastSeen: 'Visto há 12 min',
    equipment: '1 equipamento',
    messages: [
      { from: 'contact', text: 'Conseguiram resolver meu problema, muito obrigado!', time: '10:15' },
      { from: 'agent', text: 'Fico feliz! Se precisar de algo, estamos por aqui.', time: '10:16' },
    ],
  },
  {
    id: 'mr',
    name: 'MR Contabilidade',
    phone: '+55 51 99811-2002',
    initials: 'MR',
    color: '#c98331',
    preview: 'Vocês têm integração com o sistema Domínio?',
    time: '09:48',
    status: 'bot',
    queue: 'automatic',
    team: 'Comercial',
    unread: 0,
    tags: ['Lead', 'Comercial'],
    lastSeen: 'Visto há 38 min',
    equipment: 'Sem equipamentos',
    messages: [
      { from: 'contact', text: 'Bom dia! Vocês têm integração com o sistema Domínio?', time: '09:48' },
      { from: 'bot', text: 'Olá! Vou encaminhar sua pergunta para o time comercial.', time: '09:48' },
    ],
  },
  {
    id: 'fb',
    name: 'FB Escritório',
    phone: '+55 11 99011-8890',
    initials: 'FB',
    color: '#6d54b5',
    preview: 'Pode me enviar a segunda via do boleto?',
    time: '09:32',
    status: 'open',
    queue: 'mine',
    team: 'Financeiro',
    unread: 1,
    tags: ['Financeiro'],
    lastSeen: 'Visto há 54 min',
    equipment: '5 equipamentos',
    messages: [
      { from: 'contact', text: 'Pode me enviar a segunda via do boleto?', time: '09:32' },
      { from: 'agent', text: 'Claro! Vou localizar o documento e já envio para você.', time: '09:33' },
    ],
  },
  {
    id: 'joao',
    name: 'João Pereira',
    phone: '+55 41 99120-3321',
    initials: 'JP',
    color: '#158b7a',
    preview: 'Quero saber mais sobre os planos disponíveis.',
    time: '09:10',
    status: 'pending',
    queue: 'pending',
    team: 'Comercial',
    unread: 0,
    tags: ['Lead'],
    lastSeen: 'Visto há 1h',
    equipment: 'Sem equipamentos',
    messages: [{ from: 'contact', text: 'Quero saber mais sobre os planos disponíveis.', time: '09:10' }],
  },
  {
    id: 'lm',
    name: 'LM Consultoria',
    phone: '+55 31 99210-1120',
    initials: 'LM',
    color: '#d6a32c',
    preview: 'Aguardando retorno sobre a proposta enviada.',
    time: 'Ontem',
    status: 'resolved',
    queue: 'all',
    team: 'Comercial',
    unread: 0,
    tags: ['Proposta'],
    lastSeen: 'Visto ontem',
    equipment: '2 equipamentos',
    messages: [{ from: 'contact', text: 'Aguardando retorno sobre a proposta enviada.', time: 'Ontem' }],
  },
];

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Atendimento', icon: Headphones, active: true },
  { label: 'CRM', icon: Database },
  { label: 'Indicadores', icon: Activity },
  { label: 'Configurações', icon: Settings },
];

const QUEUES = [
  { id: 'all', label: 'Todas', count: 24 },
  { id: 'pending', label: 'Aguardando', count: 8 },
  { id: 'mine', label: 'Minhas', count: 6 },
  { id: 'automatic', label: 'Automático', count: 10 },
];

function Avatar({ ticket, size = 'md' }) {
  return (
    <span className={`mock-avatar mock-avatar-${size}`} style={{ '--avatar-color': ticket.color }} aria-hidden="true">
      {ticket.initials}
      <i className="mock-avatar-dot" />
    </span>
  );
}

function StatusPill({ status }) {
  const labels = { open: 'Em atendimento', pending: 'Aguardando equipe', bot: 'Bot em atendimento', resolved: 'Encerrado' };
  return <span className={`mock-status-pill mock-status-${status}`}><i />{labels[status] || status}</span>;
}

function MockInbox() {
  const [activeQueue, setActiveQueue] = useState('all');
  const [selectedId, setSelectedId] = useState('secont');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState(() => Object.fromEntries(MOCK_TICKETS.map((ticket) => [ticket.id, ticket.messages])));
  const [detailsOpen, setDetailsOpen] = useState(() => window.innerWidth > 1180);
  const [mobileView, setMobileView] = useState('list');
  const [navOpen, setNavOpen] = useState(false);
  const [notice, setNotice] = useState(true);

  const selectedTicket = MOCK_TICKETS.find((ticket) => ticket.id === selectedId) || MOCK_TICKETS[0];
  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return MOCK_TICKETS.filter((ticket) => {
      const matchesQueue = activeQueue === 'all' || ticket.queue === activeQueue;
      const matchesSearch = !query || `${ticket.name} ${ticket.phone} ${ticket.preview}`.toLowerCase().includes(query);
      return matchesQueue && matchesSearch;
    });
  }, [activeQueue, search]);

  function selectTicket(id) {
    setSelectedId(id);
    setMobileView('chat');
  }

  function sendMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => ({
      ...current,
      [selectedTicket.id]: [...(current[selectedTicket.id] || []), { from: 'agent', text, time: 'agora' }],
    }));
    setDraft('');
  }

  return (
    <div className={`mock-inbox ${navOpen ? 'mock-inbox-nav-open' : ''}`} data-mobile-view={mobileView}>
      <aside className="mock-inbox-rail">
        <div className="mock-rail-brand" aria-label="Multiatendimento">
          <span>MA</span>
        </div>
        <button className="mock-rail-toggle" type="button" onClick={() => setNavOpen((value) => !value)} aria-label="Abrir menu">
          <Menu size={19} />
        </button>
        <nav className="mock-rail-nav" aria-label="Navegação principal">
          {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
            <button key={label} type="button" className={`mock-rail-link ${active ? 'is-active' : ''}`} title={label}>
              <Icon size={19} strokeWidth={2} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="mock-rail-footer">
          <button type="button" className="mock-rail-link" title="Ajuda"><CircleHelp size={19} /><span>Ajuda</span></button>
          <div className="mock-rail-user"><span>LP</span><i /></div>
        </div>
      </aside>

      <section className="mock-inbox-app">
        {notice ? (
          <div className="mock-health-banner">
            <span><Wifi size={15} /> Canal principal conectado e recebendo mensagens.</span>
            <button type="button" onClick={() => setNotice(false)} aria-label="Fechar aviso"><X size={15} /></button>
          </div>
        ) : null}

        <header className="mock-inbox-topbar">
          <div className="mock-topbar-title">
            <div className="mock-mobile-menu"><Menu size={20} /></div>
            <div>
              <div className="mock-eyebrow">Operação</div>
              <h1>Central de Atendimento <span className="mock-live-dot">Ao vivo</span></h1>
            </div>
          </div>
          <div className="mock-topbar-actions">
            <button type="button" className="mock-channel-select"><span className="mock-whatsapp-mark">◉</span> WhatsApp <ChevronDown size={15} /></button>
            <span className="mock-topbar-online"><i /> Online</span>
            <button type="button" className="mock-icon-button" title="Notificações"><Bell size={18} /></button>
            <button type="button" className="mock-primary-action"><CheckCheck size={16} /> Finalizar atendimento</button>
          </div>
        </header>

        <div className="mock-inbox-grid">
          <aside className="mock-queue-panel">
            <div className="mock-panel-heading">
              <div><div className="mock-eyebrow">Fila de trabalho</div><h2>Conversas <span>{filteredTickets.length}</span></h2></div>
              <button type="button" className="mock-icon-button" title="Mais opções"><MoreVertical size={17} /></button>
            </div>
            <div className="mock-search-row">
              <label className="mock-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar conversas" /></label>
              <button type="button" className="mock-filter-button" title="Filtros"><Zap size={16} /></button>
            </div>
            <div className="mock-queue-tabs" role="tablist">
              {QUEUES.map((queue) => (
                <button key={queue.id} type="button" role="tab" aria-selected={activeQueue === queue.id} className={activeQueue === queue.id ? 'is-active' : ''} onClick={() => setActiveQueue(queue.id)}>
                  {queue.label} <b>{queue.count}</b>
                </button>
              ))}
            </div>
            <div className="mock-ticket-list">
              {filteredTickets.map((ticket) => (
                <button key={ticket.id} type="button" className={`mock-ticket-row ${selectedId === ticket.id ? 'is-selected' : ''}`} onClick={() => selectTicket(ticket.id)}>
                  <Avatar ticket={ticket} />
                  <span className="mock-ticket-copy">
                    <span className="mock-ticket-line"><strong>{ticket.name}</strong><time>{ticket.time}</time></span>
                    <span className="mock-ticket-preview">{ticket.preview}</span>
                    <span className="mock-ticket-meta"><StatusPill status={ticket.status} />{ticket.unread ? <em>{ticket.unread}</em> : null}</span>
                  </span>
                </button>
              ))}
              {!filteredTickets.length ? <div className="mock-empty-queue">Nenhuma conversa encontrada.</div> : null}
            </div>
          </aside>

          <main className="mock-conversation-panel">
            <header className="mock-conversation-header">
              <button type="button" className="mock-back-button" onClick={() => setMobileView('list')} aria-label="Voltar para conversas"><ArrowLeft size={19} /></button>
              <Avatar ticket={selectedTicket} size="lg" />
              <div className="mock-conversation-identity"><h2>{selectedTicket.name}</h2><span><i />{selectedTicket.lastSeen}</span></div>
              <div className="mock-conversation-tools">
                <button type="button" className="mock-icon-button" title="Etiquetas"><Tag size={17} /></button>
                <button type="button" className="mock-icon-button" title="Atribuir"><Users size={17} /></button>
                <button type="button" className="mock-icon-button" title="Mais opções"><MoreVertical size={18} /></button>
                <button type="button" className={`mock-icon-button ${detailsOpen ? 'is-active' : ''}`} onClick={() => setDetailsOpen((value) => !value)} title="Dados do cliente"><PanelRight size={18} /></button>
              </div>
            </header>
            <div className="mock-message-list">
              <div className="mock-day-divider"><span>Hoje</span></div>
              {(messages[selectedTicket.id] || []).map((message, index) => (
                <div key={`${selectedTicket.id}-${index}`} className={`mock-message-row ${message.from === 'agent' ? 'is-agent' : ''}`}>
                  <div className="mock-message-bubble">{message.from === 'bot' ? <span className="mock-message-label"><Bot size={13} /> Assistente</span> : null}<p>{message.text}</p><time>{message.time}{message.from === 'agent' ? '  ✓✓' : ''}</time></div>
                </div>
              ))}
            </div>
            <form className="mock-composer" onSubmit={sendMessage}>
              <div className="mock-composer-input"><Paperclip size={18} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Digite uma mensagem..." /><button type="button" title="Resposta rápida"><Zap size={17} /></button></div>
              <button type="submit" className="mock-send-button" aria-label="Enviar mensagem"><Send size={17} /></button>
            </form>
          </main>

          {detailsOpen ? (
            <aside className="mock-details-panel">
              <div className="mock-details-heading"><div><div className="mock-eyebrow">Contexto</div><h2>Dados do cliente</h2></div><button type="button" className="mock-icon-button" onClick={() => setDetailsOpen(false)} aria-label="Fechar painel"><X size={17} /></button></div>
              <div className="mock-profile-card"><Avatar ticket={selectedTicket} size="lg" /><div><strong>{selectedTicket.name}</strong><span>{selectedTicket.phone}</span></div><button type="button" className="mock-icon-button" title="Abrir CRM"><Database size={16} /></button></div>
              <section className="mock-detail-section"><div className="mock-detail-title"><h3>Etiquetas</h3><button type="button" className="mock-icon-button"><Plus size={16} /></button></div><div className="mock-detail-tags">{selectedTicket.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>
              <section className="mock-detail-section"><h3>Responsável</h3><button type="button" className="mock-assignee"><span className="mock-assignee-icon"><Users size={17} /></span><span><strong>Equipe {selectedTicket.team}</strong><small>3 atendentes online</small></span><ChevronDown size={16} /></button></section>
              <section className="mock-detail-section"><div className="mock-detail-title"><h3>Resumo operacional</h3><button type="button" className="mock-text-action">Ver CRM</button></div><div className="mock-summary-list"><div><ClipboardList size={16} /><span>Atendimentos abertos</span><b>2</b></div><div><Archive size={16} /><span>{selectedTicket.equipment}</span><b>3</b></div><div><Bot size={16} /><span>Último bot</span><b>Hoje</b></div></div></section>
              <div className="mock-channel-card"><div className="mock-channel-icon"><Wifi size={21} /></div><div><strong>Canal conectado</strong><span>WhatsApp Business API</span><small><i /> Conectado há 2h 34m</small></div></div>
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default MockInbox;
