import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, X } from 'lucide-react';
import { queryAiAssistant } from '../services/api';

// Painel lateral do assistente de IA (Fase 1: só leitura). Abre a partir da
// conversa atual no Inbox, já contextualizado pelo cliente do ticket quando
// existe (crmCustomerId) - o atendente não precisa repetir o nome do cliente.
// Cada pergunta é independente (sem memória entre perguntas): o backend
// classifica a intenção e só narra dados que ele mesmo buscou no Postgres,
// nunca o que o modelo "lembra" de uma pergunta anterior.

function formatSyncedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AiAssistantDrawer({ isOpen, onClose, ticketId, crmCustomerId, customerName, isMobile = false }) {
  const [exchanges, setExchanges] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) setExchanges([]);
  }, [isOpen, crmCustomerId]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [exchanges]);

  async function ask(pergunta, overrideCustomerId) {
    const trimmed = pergunta.trim();
    if (!trimmed || sending) return;
    const id = `${Date.now()}-${Math.random()}`;
    setExchanges((previous) => [...previous, { id, pergunta: trimmed, status: 'loading' }]);
    setSending(true);
    try {
      const { data } = await queryAiAssistant({
        pergunta: trimmed,
        ticketId: ticketId || null,
        crmCustomerId: overrideCustomerId ?? crmCustomerId ?? null,
      });
      setExchanges((previous) => previous.map((item) => item.id === id ? { ...item, status: 'done', ...data } : item));
    } catch (error) {
      setExchanges((previous) => previous.map((item) => item.id === id ? {
        ...item,
        status: 'error',
        answer: error.response?.data?.error || 'Não foi possível responder agora.',
      } : item));
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event) {
    event?.preventDefault();
    const pergunta = text;
    setText('');
    void ask(pergunta);
  }

  if (!isOpen) return null;

  return <>
    {isMobile ? <div style={s.backdrop} onClick={onClose} aria-hidden="true" /> : null}
    <aside style={{ ...s.drawer, width: isMobile ? '100vw' : 400 }} role="dialog" aria-modal={isMobile} aria-label="Assistente de IA">
      <header style={s.header}>
        <div style={s.title}><Sparkles size={18} /> Assistente (IA)</div>
        <button type="button" style={s.iconButton} onClick={onClose} aria-label="Fechar assistente"><X size={20} /></button>
      </header>
      {customerName ? <div style={s.customerBadge}>Sobre: <strong>{customerName}</strong></div> : null}
      <div style={s.body} aria-live="polite">
        {!exchanges.length ? <div style={s.empty}>
          <Sparkles size={22} />
          <span>Pergunte sobre boletos em aberto, contrato, equipamentos ou dados cadastrais do cliente.</span>
        </div> : null}
        {exchanges.map((exchange) => <div key={exchange.id} style={s.exchange}>
          <div style={s.question}>{exchange.pergunta}</div>
          {exchange.status === 'loading' ? <div style={s.loading}>Consultando…</div> : <>
            <div style={{ ...s.answer, ...(exchange.status === 'error' ? s.answerError : {}) }}>{exchange.answer}</div>
            {Array.isArray(exchange.candidates) && exchange.candidates.length ? <div style={s.candidates}>
              {exchange.candidates.map((candidate) => (
                <button key={candidate.id} type="button" style={s.candidateButton} onClick={() => ask(exchange.pergunta, candidate.id)}>
                  {candidate.name}{candidate.fantasyName ? ` · ${candidate.fantasyName}` : ''}
                </button>
              ))}
            </div> : null}
            {exchange.syncedAt ? <div style={s.syncedAt}>Dados sincronizados em {formatSyncedAt(exchange.syncedAt)}</div> : null}
          </>}
        </div>)}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} style={s.composer}>
        <input
          ref={inputRef}
          type="text"
          style={s.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ex.: tem boleto em aberto?"
          aria-label="Pergunta para o assistente"
          disabled={sending}
        />
        <button type="submit" style={s.send} disabled={sending || !text.trim()} aria-label="Perguntar"><Send size={16} /></button>
      </form>
    </aside>
  </>;
}

const s = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1040, background: 'var(--overlay-bg)', backdropFilter: 'blur(2px)' },
  drawer: { position: 'fixed', inset: '0 0 0 auto', zIndex: 1050, maxWidth: '100vw', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', borderLeft: '1px solid var(--border-color)', boxShadow: '-8px 0 32px rgba(0,0,0,.18)' },
  header: { minHeight: '60px', padding: '.8rem 1rem', display: 'flex', alignItems: 'center', gap: '.7rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface)' },
  title: { flex: 1, display: 'flex', alignItems: 'center', gap: '.55rem', color: 'var(--text-main)', fontWeight: 800 },
  iconButton: { width: '38px', height: '38px', display: 'grid', placeItems: 'center', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' },
  customerBadge: { padding: '.55rem 1rem', borderBottom: '1px solid var(--border-color)', background: 'var(--accent-light)', color: 'var(--accent)', fontSize: '.78rem' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.9rem' },
  empty: { margin: 'auto 0', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.6rem', color: 'var(--text-muted)', textAlign: 'center', fontSize: '.84rem' },
  exchange: { display: 'flex', flexDirection: 'column', gap: '.4rem' },
  question: { alignSelf: 'flex-end', maxWidth: '90%', padding: '.55rem .8rem', borderRadius: '12px', borderBottomRightRadius: '4px', background: 'var(--accent)', color: 'var(--text-inverse)', fontSize: '.86rem' },
  loading: { color: 'var(--text-dim)', fontSize: '.8rem', fontStyle: 'italic' },
  answer: { padding: '.6rem .8rem', borderRadius: '12px', borderBottomLeftRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '.86rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  answerError: { borderColor: 'var(--danger-border)', background: 'var(--danger-light)', color: 'var(--danger-text)' },
  candidates: { display: 'flex', flexWrap: 'wrap', gap: '.4rem' },
  candidateButton: { padding: '.4rem .7rem', border: '1px solid var(--accent-border)', borderRadius: '999px', background: 'var(--accent-light)', color: 'var(--accent)', fontSize: '.76rem', fontWeight: 700, cursor: 'pointer' },
  syncedAt: { color: 'var(--text-dim)', fontSize: '.68rem' },
  composer: { display: 'flex', gap: '.5rem', padding: '.7rem 1rem max(.7rem, env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', background: 'var(--bg-surface)' },
  input: { flex: 1, minWidth: 0, height: '42px', padding: '0 .8rem', border: '1px solid var(--border-color)', borderRadius: '12px', outline: 0, background: 'var(--bg-panel)', color: 'var(--text-main)', font: 'inherit' },
  send: { width: '42px', height: '42px', flexShrink: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'var(--accent)', color: 'var(--text-inverse)', cursor: 'pointer' },
};
