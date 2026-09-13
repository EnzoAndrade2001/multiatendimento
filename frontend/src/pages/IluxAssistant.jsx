import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Building2, Clock3, Database, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { queryAiAssistant } from '../services/api';

const SUGGESTIONS = [
  'Qual é a receita prevista para este mês?',
  'Quanto temos em contas a receber?',
  'Quais são os clientes inadimplentes?',
  'Quantas O.S. estão abertas?',
  'Quanto temos em contas a pagar neste mês?',
  'Quantos contratos estão ativos?',
  'Quais equipamentos estão sem leitura recente?',
];

function dateTime(value) {
  if (!value) return 'Sincronização ainda não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sincronização ainda não informada' : `Dados sincronizados em ${date.toLocaleString('pt-BR')}`;
}

function DataPreview({ data }) {
  if (!data || typeof data !== 'object') return null;
  const listKey = ['clientes', 'contas', 'ordens', 'titulos', 'contratos', 'equipamentos'].find((key) => Array.isArray(data[key]));
  const rows = listKey ? data[listKey] : [];
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]).slice(0, 5);
  return (
    <div className="ilux-ai-table-wrap">
      <table className="ilux-ai-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 10).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{typeof row[column] === 'number' ? row[column].toLocaleString('pt-BR') : (row[column] ?? '—')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function IluxAssistant() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function ask(text, crmCustomerId = null) {
    const value = String(text || '').trim();
    if (!value || busy) return;
    const id = `${Date.now()}-${Math.random()}`;
    setQuestion(''); setBusy(true);
    setMessages((current) => [...current, { id, question: value, loading: true }]);
    try {
      const { data } = await queryAiAssistant({ pergunta: value, crmCustomerId });
      setMessages((current) => current.map((item) => item.id === id ? { ...item, loading: false, ...data } : item));
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === id ? { ...item, loading: false, error: true, answer: error.response?.data?.error || 'Não foi possível concluir a consulta agora.' } : item));
    } finally { setBusy(false); inputRef.current?.focus(); }
  }

  function submit(event) { event.preventDefault(); void ask(question); }

  return (
    <main className="ilux-ai-page">
      <style>{styles}</style>
      <header className="ilux-ai-header">
        <div>
          <span className="ilux-ai-kicker"><Sparkles size={14} /> Inteligência corporativa</span>
          <h1>Assistente iLux</h1>
          <p>Consulte dados financeiros, clientes, contratos, equipamentos e ordens de serviço em linguagem natural.</p>
        </div>
        <div className="ilux-ai-scope"><Building2 size={17} /><span><small>Escopo atual</small>Empresa inteira</span></div>
      </header>

      <section className="ilux-ai-shell">
        <aside className="ilux-ai-aside">
          <div className="ilux-ai-info"><Database size={18} /><div><strong>Dados do iLux</strong><p>As respostas usam somente informações sincronizadas pelo agente local.</p></div></div>
          <div className="ilux-ai-info"><ShieldCheck size={18} /><div><strong>Consulta segura</strong><p>A IA não cria nem executa SQL. Permissões financeiras continuam valendo.</p></div></div>
          <div className="ilux-ai-aside-title">Perguntas sugeridas</div>
          <div className="ilux-ai-suggestions">{SUGGESTIONS.map((item) => <button type="button" key={item} onClick={() => ask(item)} disabled={busy}>{item}</button>)}</div>
        </aside>

        <div className="ilux-ai-workspace">
          <div className="ilux-ai-conversation">
            {!messages.length ? (
              <div className="ilux-ai-empty"><span><Bot size={28} /></span><h2>O que você quer saber sobre a empresa?</h2><p>Você pode perguntar sobre valores, quantidades, períodos ou citar um cliente pelo nome.</p></div>
            ) : messages.map((message) => (
              <article className="ilux-ai-exchange" key={message.id}>
                <div className="ilux-ai-question">{message.question}</div>
                <div className={`ilux-ai-answer${message.error ? ' is-error' : ''}`}>
                  <div className="ilux-ai-answer-icon"><Bot size={17} /></div>
                  <div className="ilux-ai-answer-content">
                    {message.loading ? <div className="ilux-ai-loading"><span /> Consultando dados sincronizados…</div> : <>
                      <p>{message.answer}</p>
                      <DataPreview data={message.data} />
                      {Array.isArray(message.candidates) && message.candidates.length ? <div className="ilux-ai-candidates">{message.candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => ask(message.question, candidate.id)}>{candidate.fantasyName || candidate.name}</button>)}</div> : null}
                      {message.syncedAt ? <small className="ilux-ai-synced"><Clock3 size={13} /> {dateTime(message.syncedAt)}</small> : null}
                    </>}
                  </div>
                </div>
              </article>
            ))}
            <div ref={endRef} />
          </div>

          <form className="ilux-ai-composer" onSubmit={submit}>
            <button type="button" className="ilux-ai-clear" onClick={() => setMessages([])} disabled={!messages.length || busy} title="Limpar conversa"><RotateCcw size={17} /></button>
            <input ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ex.: quais clientes estão inadimplentes há mais de 30 dias?" disabled={busy} maxLength={500} />
            <button className="ilux-ai-send" type="submit" disabled={busy || !question.trim()}><ArrowUp size={19} /></button>
          </form>
        </div>
      </section>
    </main>
  );
}

const styles = `
  .ilux-ai-page{flex:1;min-height:0;overflow-y:auto;padding:2rem;background:var(--bg-base);color:var(--text-main)}
  .ilux-ai-header{max-width:1440px;margin:0 auto 1.25rem;display:flex;align-items:flex-end;justify-content:space-between;gap:1rem}.ilux-ai-kicker{display:flex;align-items:center;gap:.4rem;color:var(--accent);font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.ilux-ai-header h1{margin:.5rem 0 .3rem;font:800 1.85rem/1.15 var(--font-display)}.ilux-ai-header p{margin:0;color:var(--text-muted);line-height:1.5}.ilux-ai-scope{display:flex;align-items:center;gap:.65rem;padding:.7rem .9rem;border:1px solid var(--accent-border);border-radius:13px;background:var(--accent-light);color:var(--accent)}.ilux-ai-scope span{display:grid;font-size:.84rem;font-weight:800}.ilux-ai-scope small{color:var(--text-muted);font-size:.65rem;font-weight:700;text-transform:uppercase}
  .ilux-ai-shell{max-width:1440px;height:calc(100vh - 190px);min-height:560px;margin:auto;display:grid;grid-template-columns:300px minmax(0,1fr);overflow:hidden;border:1px solid var(--border-color);border-radius:18px;background:var(--bg-surface);box-shadow:0 18px 45px rgba(0,0,0,.09)}
  .ilux-ai-aside{padding:1rem;overflow-y:auto;border-right:1px solid var(--border-color);background:var(--bg-panel)}.ilux-ai-info{display:flex;gap:.7rem;margin-bottom:.7rem;padding:.8rem;border:1px solid var(--border-color);border-radius:12px;color:var(--accent);background:var(--bg-surface)}.ilux-ai-info div{min-width:0}.ilux-ai-info strong{color:var(--text-main);font-size:.82rem}.ilux-ai-info p{margin:.2rem 0 0;color:var(--text-muted);font-size:.72rem;line-height:1.45}.ilux-ai-aside-title{margin:1.15rem .25rem .55rem;color:var(--text-dim);font-size:.7rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.ilux-ai-suggestions{display:grid;gap:.4rem}.ilux-ai-suggestions button{padding:.7rem .75rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-surface);color:var(--text-main);font:600 .78rem/1.4 inherit;text-align:left;cursor:pointer}.ilux-ai-suggestions button:hover{border-color:var(--accent-border);background:var(--accent-light)}
  .ilux-ai-workspace{min-width:0;min-height:0;display:flex;flex-direction:column}.ilux-ai-conversation{flex:1;min-height:0;overflow-y:auto;padding:1.4rem clamp(1rem,4vw,4rem)}.ilux-ai-empty{height:100%;display:grid;place-content:center;justify-items:center;text-align:center;color:var(--text-muted)}.ilux-ai-empty span{width:58px;height:58px;display:grid;place-items:center;border-radius:17px;background:var(--accent-light);color:var(--accent)}.ilux-ai-empty h2{margin:1rem 0 .4rem;color:var(--text-main);font-size:1.25rem}.ilux-ai-empty p{max-width:470px;margin:0;line-height:1.5}
  .ilux-ai-exchange{display:grid;gap:.7rem;margin-bottom:1.4rem}.ilux-ai-question{justify-self:end;max-width:min(80%,720px);padding:.7rem .95rem;border-radius:13px 13px 4px 13px;background:var(--accent);color:var(--text-inverse);font-size:.9rem}.ilux-ai-answer{max-width:900px;display:flex;gap:.7rem}.ilux-ai-answer-icon{width:34px;height:34px;flex:0 0 34px;display:grid;place-items:center;border-radius:10px;background:var(--accent-light);color:var(--accent)}.ilux-ai-answer-content{min-width:0;flex:1;padding:.85rem 1rem;border:1px solid var(--border-color);border-radius:4px 14px 14px;background:var(--bg-panel)}.ilux-ai-answer-content>p{margin:0;white-space:pre-wrap;line-height:1.6}.ilux-ai-answer.is-error .ilux-ai-answer-content{border-color:var(--danger-border);background:var(--danger-light);color:var(--danger-text)}.ilux-ai-loading{display:flex;align-items:center;gap:.6rem;color:var(--text-muted)}.ilux-ai-loading span{width:14px;height:14px;border:2px solid var(--border-color);border-top-color:var(--accent);border-radius:50%;animation:iluxspin .8s linear infinite}@keyframes iluxspin{to{transform:rotate(360deg)}}.ilux-ai-synced{margin-top:.7rem;display:flex;align-items:center;gap:.35rem;color:var(--text-dim)}.ilux-ai-candidates{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem}.ilux-ai-candidates button{padding:.4rem .65rem;border:1px solid var(--accent-border);border-radius:999px;background:var(--accent-light);color:var(--accent);font-weight:700;cursor:pointer}
  .ilux-ai-table-wrap{max-width:100%;margin-top:.8rem;overflow-x:auto;border:1px solid var(--border-color);border-radius:10px}.ilux-ai-table{width:100%;border-collapse:collapse;font-size:.75rem}.ilux-ai-table th,.ilux-ai-table td{padding:.55rem .65rem;border-bottom:1px solid var(--border-color);text-align:left;white-space:nowrap}.ilux-ai-table th{color:var(--text-dim);font-size:.65rem;text-transform:uppercase;background:var(--bg-surface)}.ilux-ai-table tr:last-child td{border-bottom:0}
  .ilux-ai-composer{margin:0 clamp(1rem,4vw,4rem) 1rem;display:flex;align-items:center;gap:.5rem;padding:.45rem;border:1px solid var(--border-color);border-radius:15px;background:var(--bg-panel);box-shadow:0 9px 28px rgba(0,0,0,.08)}.ilux-ai-composer input{flex:1;min-width:0;height:42px;border:0;outline:0;background:transparent;color:var(--text-main);font:inherit}.ilux-ai-clear,.ilux-ai-send{width:40px;height:40px;display:grid;place-items:center;border-radius:11px;cursor:pointer}.ilux-ai-clear{border:0;background:transparent;color:var(--text-muted)}.ilux-ai-send{border:0;background:var(--accent);color:var(--text-inverse)}.ilux-ai-clear:disabled,.ilux-ai-send:disabled{opacity:.4;cursor:not-allowed}
  @media(max-width:900px){.ilux-ai-page{padding:1rem}.ilux-ai-header{align-items:flex-start}.ilux-ai-shell{height:calc(100vh - 170px);grid-template-columns:1fr}.ilux-ai-aside{display:none}.ilux-ai-conversation{padding:1rem}.ilux-ai-composer{margin:0 .7rem .7rem}.ilux-ai-header p{display:none}.ilux-ai-scope{padding:.55rem .65rem}.ilux-ai-question{max-width:90%}}
  @media(max-width:560px){.ilux-ai-page{padding:.75rem}.ilux-ai-header h1{font-size:1.4rem}.ilux-ai-scope small{display:none}.ilux-ai-shell{height:calc(100vh - 142px);min-height:460px;border-radius:14px}.ilux-ai-answer-icon{display:none}.ilux-ai-answer-content{border-radius:12px}.ilux-ai-conversation{padding:.75rem}.ilux-ai-composer{margin:0 .5rem .5rem}.ilux-ai-clear{display:none}}
`;
