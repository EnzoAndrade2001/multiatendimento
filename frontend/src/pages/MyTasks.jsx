import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Check, Pencil, RefreshCw, X } from 'lucide-react';
import api from '../services/api';
import { toast } from '../utils/toast';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import './MyTasks.css';

const labels = { open: 'Aberta', in_progress: 'Em andamento', done: 'Concluída', cancelled: 'Cancelada' };
const blank = { title: '', description: '', kind: 'task', dueAt: '', status: 'open', assigneeId: '', teamId: '', contactId: '', ticketId: '', serviceOrderId: '' };
const localDate = value => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const dateLabel = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem prazo';

export default function MyTasks() {
  const [params] = useSearchParams();
  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('active');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [waiting, setWaiting] = useState({ items: [] });
  const [options, setOptions] = useState({ users: [], teams: [], contacts: [], tickets: [], serviceOrders: [] });
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [tasksResponse, waitingResponse] = await Promise.all([api.get('/tasks', { params: { scope, status, overdue, page } }), api.get('/tasks/waiting', { params: { scope } })]);
      setData(tasksResponse.data); setWaiting(waitingResponse.data);
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível carregar as pendências.'); }
    finally { setLoading(false); }
  }, [scope, status, overdue, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!form) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      api.get('/tasks/options', { params: { q: search }, signal: controller.signal }).then(({ data: result }) => {
        setOptions(result);
        setForm(current => current ? { ...current, assigneeId: current.assigneeId || result.currentUserId } : null);
      }).catch(err => { if (err.code !== 'ERR_CANCELED') toast.error('Não foi possível carregar os vínculos.'); });
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [Boolean(form), search]);
  useEffect(() => {
    if (params.get('ticketId')) setForm({ ...blank, ticketId: params.get('ticketId'), contactId: params.get('contactId') || '', kind: 'callback' });
  }, [params]);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  function edit(item) { setSearch(''); setForm({ ...blank, ...item, dueAt: localDate(item.dueAt) }); }
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try {
      const body = Object.fromEntries(Object.keys(blank).map(key => [key, form[key] || null]));
      body.dueAt = form.dueAt ? new Date(form.dueAt).toISOString() : null;
      if (form.id) await api.patch(`/tasks/${form.id}`, body); else await api.post('/tasks', body);
      setForm(null); toast.success('Pendência salva.'); await load();
    } catch (err) { toast.error(err.response?.data?.error || 'Não foi possível salvar a pendência.'); }
    finally { setSaving(false); }
  }
  async function complete(item) {
    setSaving(true);
    try { await api.patch(`/tasks/${item.id}`, { status: 'done' }); toast.success('Pendência concluída.'); await load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Não foi possível concluir a pendência.'); }
    finally { setSaving(false); }
  }
  function optionList(key, selectedId, label) {
    const values = options[key];
    return <>{selectedId && !values.some(item => item.id === selectedId) && <option value={selectedId}>Vínculo atual ({selectedId})</option>}{values.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</>;
  }
  return <div className="my-tasks">
    <PageHeader title="Minhas pendências" subtitle="Organize retornos prometidos, tarefas e conversas que aguardam sua resposta." actions={<><ActionButton variant="secondary" onClick={load} disabled={loading}><RefreshCw size={16} />Atualizar</ActionButton><ActionButton onClick={() => edit(blank)}><Plus size={16} />Nova pendência</ActionButton></>} />
    <div className="task-filters">
      <label>Responsabilidade<select value={scope} onChange={e => { setScope(e.target.value); setPage(1); }}><option value="mine">Minhas</option><option value="team">Equipes que posso acessar</option></select></label>
      <label>Situação<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">Em aberto</option><option value="all">Todas</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="task-checkbox"><input type="checkbox" checked={overdue} onChange={e => { setOverdue(e.target.checked); setPage(1); }} />Somente atrasadas</label>
    </div>
    {error && <p role="alert" className="task-error">{error}</p>}
    {loading ? <p role="status">Carregando pendências…</p> : <>
      <p className="task-muted">{data.total} pendência(s) no filtro</p>
      <div className="task-list">{data.items.map(item => {
        const late = item.dueAt && new Date(item.dueAt) < new Date() && ['open', 'in_progress'].includes(item.status);
        return <article key={item.id} className={`task-card${late ? ' task-late' : ''}`}>
          <div className="task-card-main"><div className="task-badges"><span>{item.kind === 'callback' ? 'Retorno prometido' : 'Tarefa'}</span><span>{labels[item.status]}</span>{late && <strong>Atrasada</strong>}</div><h2>{item.title}</h2>{item.description && <p className="task-description">{item.description}</p>}<p className="task-muted">{item.assignee?.name} {item.team ? `· ${item.team.name}` : ''} · {dateLabel(item.dueAt)}</p>
          <div className="task-links">{item.contact && <span>Cliente: {item.contact.name}</span>}{item.ticketId && <Link to={`/inbox?ticketId=${encodeURIComponent(item.ticketId)}`}>Abrir conversa</Link>}{item.serviceOrder && <span>O.S. {item.serviceOrder.externalId || item.serviceOrder.id}</span>}</div></div>
          <div className="task-actions"><ActionButton variant="secondary" size="sm" onClick={() => edit(item)}><Pencil size={15} />Editar</ActionButton>{['open', 'in_progress'].includes(item.status) && <ActionButton size="sm" disabled={saving} onClick={() => complete(item)}><Check size={15} />Concluir</ActionButton>}</div>
        </article>;
      })}{!data.items.length && <div className="task-card">Nenhuma pendência neste filtro.</div>}</div>
      {data.total > 50 && <div className="task-actions"><ActionButton variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</ActionButton><span>Página {page} de {Math.ceil(data.total / 50)}</span><ActionButton variant="secondary" disabled={page * 50 >= data.total} onClick={() => setPage(p => p + 1)}>Próxima</ActionButton></div>}
      <h2 className="task-section-title">Clientes aguardando resposta</h2><p className="task-muted">Conversas abertas com mensagem do cliente após a última resposta humana.</p>
      {waiting.truncated && <p role="status">Exibindo os 100 clientes aguardando há mais tempo. Consulte a caixa de entrada para a lista completa.</p>}
      <div className="task-list">{waiting.items.map(ticket => <article key={ticket.id} className="task-card"><div><h3>{ticket.contact?.name}</h3><p className="task-muted">Desde {dateLabel(ticket.waitingSince)} · {ticket.agent?.name || 'Sem responsável'}{ticket.slaDueAt ? ` · SLA: ${dateLabel(ticket.slaDueAt)}` : ''}</p></div><Link to={`/inbox?ticketId=${encodeURIComponent(ticket.id)}`}>Responder</Link></article>)}{!waiting.items.length && <p>Nenhum cliente aguardando resposta neste escopo.</p>}</div>
    </>}
    {form && <div className="task-modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !saving) setForm(null); }}><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onKeyDown={e => { if (e.key === 'Escape' && !saving) setForm(null); }}><div className="task-modal-heading"><h2 id="task-form-title">{form.id ? 'Editar pendência' : 'Nova pendência'}</h2><button type="button" aria-label="Fechar" disabled={saving} onClick={() => setForm(null)}><X size={20} /></button></div>
      <form onSubmit={save} className="task-form">
        <label>Título<input autoFocus required maxLength={200} value={form.title} onChange={e => change('title', e.target.value)} /></label>
        <label>Descrição<textarea rows={3} maxLength={5000} value={form.description || ''} onChange={e => change('description', e.target.value)} /></label>
        <div className="task-form-grid"><label>Tipo<select value={form.kind} onChange={e => change('kind', e.target.value)}><option value="task">Tarefa</option><option value="callback">Retorno prometido</option></select></label><label>Prazo<input type="datetime-local" required={form.kind === 'callback'} value={form.dueAt} onChange={e => change('dueAt', e.target.value)} /></label>
        <label>Responsável<select required value={form.assigneeId || ''} onChange={e => change('assigneeId', e.target.value)}><option value="">Selecione</option>{optionList('users', form.assigneeId, item => item.name)}</select></label><label>Equipe<select value={form.teamId || ''} onChange={e => change('teamId', e.target.value)}><option value="">Sem equipe</option>{optionList('teams', form.teamId, item => item.name)}</select></label></div>
        <label>Situação<select value={form.status} onChange={e => change('status', e.target.value)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <fieldset><legend>Vínculos opcionais</legend><label>Buscar por nome do cliente<input value={search} placeholder="Digite para localizar clientes, conversas e O.S." onChange={e => setSearch(e.target.value)} /></label><p className="task-muted">Até 50 resultados por lista. Refine a busca para localizar outros registros.</p>
        <label>Cliente<select value={form.contactId || ''} onChange={e => setForm(current => ({ ...current, contactId: e.target.value, ticketId: '', serviceOrderId: '' }))}><option value="">Sem vínculo</option>{optionList('contacts', form.contactId, item => item.name)}</select></label>
        <label>Conversa<select value={form.ticketId || ''} onChange={e => { const ticket = options.tickets.find(t => t.id === e.target.value); setForm(current => ({ ...current, ticketId: e.target.value, contactId: ticket?.contactId || current.contactId, serviceOrderId: '' })); }}><option value="">Sem vínculo</option>{optionList('tickets', form.ticketId, item => `${item.contact?.name} · ${item.id.slice(-6)}`)}</select></label>
        <label>Ordem de serviço<select value={form.serviceOrderId || ''} onChange={e => { const os = options.serviceOrders.find(item => item.id === e.target.value); setForm(current => ({ ...current, serviceOrderId: e.target.value, contactId: os?.contactId || current.contactId, ticketId: os?.ticketId || current.ticketId })); }}><option value="">Sem vínculo</option>{optionList('serviceOrders', form.serviceOrderId, item => `${item.externalId || item.id.slice(-6)} · ${item.contact?.name}`)}</select></label></fieldset>
        <div className="task-actions"><ActionButton variant="secondary" disabled={saving} onClick={() => setForm(null)}>Cancelar</ActionButton><ActionButton type="submit" loading={saving}>Salvar pendência</ActionButton></div>
      </form></section></div>}
  </div>;
}
