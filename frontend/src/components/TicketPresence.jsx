import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';

export default function TicketPresence({ ticketId, text, sending }) {
  const [viewers, setViewers] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  const sessionId = useRef(crypto.randomUUID());
  const activity = useRef({ typedAt: 0, sending: false });
  const pingRef = useRef(null);
  useEffect(() => {
    activity.current.typedAt = text ? Date.now() : 0;
    const timer = setTimeout(() => pingRef.current?.(), 400);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => { activity.current.sending = sending; pingRef.current?.(); }, [sending]);
  useEffect(() => {
    if (!ticketId) return undefined;
    let alive = true; let pending = false;
    setViewers([]);
    const ping = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const { data } = await api.post(`/ticket-presence/${encodeURIComponent(ticketId)}`, {
          sessionId: sessionId.current, typing: Date.now() - activity.current.typedAt < 5000, sending: activity.current.sending,
        });
        if (alive) { setViewers(data.viewers || []); setUnavailable(false); }
      } catch { if (alive) { setViewers([]); setUnavailable(true); } }
      finally { pending = false; }
    };
    pingRef.current = ping;
    void ping();
    const timer = setInterval(ping, 5000);
    const visibility = () => { if (!document.hidden) void ping(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive = false; pingRef.current = null; clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      void api.delete(`/ticket-presence/${encodeURIComponent(ticketId)}`, { data: { sessionId: sessionId.current } }).catch(() => {});
    };
  }, [ticketId]);
  if (!viewers.length && !unavailable) return null;
  return <div role="status" aria-live="polite" style={{ padding: '6px 16px', fontSize: 12, color: 'var(--warning-text)', background: 'var(--warning-light)', borderBottom: '1px solid var(--border-color)' }}>
    {unavailable ? 'Presença dos outros atendentes temporariamente indisponível.' : viewers.map(v => `${v.name} ${v.sending ? 'está enviando uma mensagem' : v.typing ? 'está digitando' : 'também está nesta conversa'}`).join(' · ')}
  </div>;
}
