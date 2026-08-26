import React, { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  Globe2,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { toast } from '../utils/toast';
import {
  getQuickResponses,
  createQuickResponse,
  updateQuickResponse,
  deleteQuickResponse,
  getTeams,
} from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';

const CATEGORIES = [
  { value: 'all', label: 'Todos' },
  { value: 'GENERAL', label: 'Geral' },
  { value: 'SUPPORT', label: 'Atendimento' },
  { value: 'BILLING', label: 'Cobrança' },
  { value: 'CAMPAIGN', label: 'Campanhas' },
  { value: 'TECHNICAL', label: 'Técnico / O.S.' },
];

const SCOPES = [
  { value: 'PERSONAL', label: 'Pessoal', icon: <UsersRound size={14} /> },
  { value: 'TEAM', label: 'Equipe', icon: <UsersRound size={14} /> },
  { value: 'GLOBAL', label: 'Toda a empresa', icon: <Globe2 size={14} /> },
];

function normalize(item) {
  return {
    ...item,
    shortcut: String(item.shortcut || item.name || '').replace(/^\/+/, ''),
    message: item.message ?? item.body ?? '',
    category: String(item.category || 'GENERAL').toUpperCase(),
    scope: String(item.scope || 'GLOBAL').toUpperCase(),
    usageCount: Number(item.usageCount ?? item.uses ?? 0) || 0,
    favorite: Boolean(item.favorite || item.isFavorite || item.pinned),
  };
}

function sampleMessage(body) {
  return String(body || '')
    .replaceAll('[nome]', 'Maria')
    .replaceAll('{{nome}}', 'Maria')
    .replaceAll('[cliente]', 'Cliente exemplo')
    .replaceAll('{{cliente}}', 'Cliente exemplo')
    .replaceAll('[numero_os]', '91535')
    .replaceAll('{{numero_os}}', '91535');
}

export default function QuickResponses() {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [scope, setScope] = useState('all');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [modal, setModal] = useState(false);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ id: null, shortcut: '', message: '', category: 'GENERAL', scope: 'GLOBAL', teamId: '' });
  const [teams, setTeams] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [pinned, setPinned] = useState(() => {
    try { return JSON.parse(localStorage.getItem('quick-response-pins') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    load();
    getTeams().then(({ data }) => setTeams(Array.isArray(data) ? data : data?.teams || [])).catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    try { localStorage.setItem('quick-response-pins', JSON.stringify(pinned)); } catch { /* storage bloqueado */ }
  }, [pinned]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await getQuickResponses();
      const rows = Array.isArray(data) ? data : data?.responses || [];
      setResponses(rows.map(normalize));
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível carregar os modelos de mensagem.');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setForm({ id: null, shortcut: '', message: '', category: 'GENERAL', scope: 'GLOBAL', teamId: '' });
    setPreview(null);
    setModal(true);
  }

  function openEdit(item) {
    setForm({ id: item.id, shortcut: item.shortcut, message: item.message, category: item.category, scope: item.scope, teamId: item.teamId || '' });
    setPreview(null);
    setModal(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const shortcut = form.shortcut.trim().replace(/\s+/g, '-');
    if (!shortcut || !form.message.trim()) return toast.info('Informe o atalho e a mensagem completa.');
    if (form.scope === 'TEAM' && !(form.teamId || teams[0]?.id)) return toast.info('Você precisa participar de uma equipe para usar o escopo de equipe.');
    setSaving(true);
    try {
      if (form.scope === 'TEAM' && !(form.teamId || teams[0]?.id)) return toast.info('Selecione a equipe que terá acesso ao modelo.');
      const payload = { shortcut, message: form.message.trim(), category: form.category, scope: form.scope, ...(form.scope === 'TEAM' ? { teamId: form.teamId || teams[0].id } : {}) };
      if (form.id) {
        try {
          await updateQuickResponse(form.id, payload);
        } catch (error) {
          // Servidores antigos não têm PATCH: recriar mantém a edição disponível sem quebrar a tela.
          if (![404, 405].includes(error.response?.status)) throw error;
          await deleteQuickResponse(form.id);
          await createQuickResponse(payload);
        }
        toast.success('Modelo atualizado.');
      } else {
        await createQuickResponse(payload);
        toast.success('Modelo criado.');
      }
      setModal(false);
      load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar o modelo.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(item) {
    if (deletingId) return;
    toast.confirm(`Excluir o modelo "/${item.shortcut}"? Essa ação não pode ser desfeita.`, async () => {
      setDeletingId(item.id);
      try {
        await deleteQuickResponse(item.id);
        setPinned((items) => items.filter((id) => id !== item.id));
        setResponses((items) => items.filter((row) => row.id !== item.id));
        toast.success('Modelo excluído.');
      } catch (error) {
        toast.error(error.response?.data?.error || 'Não foi possível excluir o modelo.');
      } finally {
        setDeletingId(null);
      }
    });
  }

  async function toggleFavorite(item) {
    const next = !(pinned.includes(item.id) || item.favorite);
    setPinned((items) => next ? [...items, item.id] : items.filter((id) => id !== item.id));
    setResponses((items) => items.map((row) => row.id === item.id ? { ...row, favorite: next } : row));
    try {
      await updateQuickResponse(item.id, { favorite: next });
    } catch (error) {
      // O pin local funciona em instalações antigas. Não desfazemos a preferência do usuário.
      if (![404, 405].includes(error.response?.status)) toast.warning('Preferência salva apenas neste navegador.');
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return responses
      .filter((item) => category === 'all' || item.category === category)
      .filter((item) => scope === 'all' || item.scope === scope)
      .filter((item) => !onlyFavorites || pinned.includes(item.id) || item.favorite)
      .filter((item) => !term || item.shortcut.toLowerCase().includes(term) || item.message.toLowerCase().includes(term));
  }, [responses, search, category, scope, onlyFavorites, pinned]);

  const usageTotal = responses.reduce((sum, item) => sum + item.usageCount, 0);
  const favoriteTotal = responses.filter((item) => pinned.includes(item.id) || item.favorite).length;

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Agilidade operacional"
        title="Modelos de mensagem"
        subtitle="Respostas oficiais com atalhos, categorias e escopos para cada equipe responder com consistência."
        actions={<ActionButton onClick={openCreate}><Plus size={18} /> Novo modelo</ActionButton>}
        compact
      />

      <div style={s.metrics}>
        <div style={s.metric}><MessageSquare size={17} /><div><strong>{responses.length}</strong><span>modelos ativos</span></div></div>
        <div style={s.metric}><Star size={17} /><div><strong>{favoriteTotal}</strong><span>favoritos</span></div></div>
        <div style={s.metric}><Send size={17} /><div><strong>{usageTotal}</strong><span>usos registrados</span></div></div>
      </div>

      <div style={s.toolbar}>
        <div style={s.searchBox}><Search size={17} style={s.searchIcon} /><input aria-label="Buscar modelos" style={s.searchInput} placeholder="Buscar por atalho ou conteúdo" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select aria-label="Filtrar categoria" style={s.filterSelect} value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">Todos os escopos</option>{SCOPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <button type="button" style={{ ...s.favoriteFilter, ...(onlyFavorites ? s.favoriteFilterActive : {}) }} onClick={() => setOnlyFavorites((value) => !value)}><Star size={15} fill={onlyFavorites ? 'currentColor' : 'none'} /> Favoritos</button>
      </div>
      <div style={s.categoryTabs} role="tablist" aria-label="Categorias de modelos">{CATEGORIES.map((item) => <button type="button" role="tab" aria-selected={category === item.value} key={item.value} style={{ ...s.categoryTab, ...(category === item.value ? s.categoryTabActive : {}) }} onClick={() => setCategory(item.value)}>{item.label}{item.value !== 'all' ? <span style={s.categoryCount}>{responses.filter((row) => row.category === item.value).length}</span> : null}</button>)}</div>

      <div style={s.grid}>
        {loading ? <div style={s.empty}>Carregando modelos...</div> : filtered.length === 0 ? <div style={s.emptyCard}><MessageSquare size={22} /><div style={s.emptyTitle}>Nenhum modelo encontrado</div><div style={s.emptyText}>Ajuste os filtros ou crie um novo modelo de resposta.</div><ActionButton onClick={openCreate} style={{ marginTop: '1rem' }}><Plus size={16} /> Criar modelo</ActionButton></div> : filtered.map((item) => {
          const isPinned = pinned.includes(item.id) || item.favorite;
          return <article key={item.id} style={{ ...s.card, ...(isPinned ? s.cardPinned : {}) }}>
            <div style={s.cardHeader}><div style={s.shortcut} title={`/${item.shortcut}`}>/{item.shortcut}</div><div style={s.cardActions}><button type="button" aria-label={isPinned ? 'Desafixar modelo' : 'Fixar modelo'} title={isPinned ? 'Desafixar' : 'Fixar'} style={{ ...s.iconBtn, color: isPinned ? 'var(--accent)' : 'var(--text-muted)' }} onClick={() => toggleFavorite(item)}><Pin size={16} fill={isPinned ? 'currentColor' : 'none'} /></button><button type="button" aria-label="Editar modelo" title="Editar" style={s.iconBtn} onClick={() => openEdit(item)}><Pencil size={16} /></button><button type="button" aria-label="Excluir modelo" title="Excluir" style={{ ...s.iconBtn, color: 'var(--danger-text)' }} onClick={() => handleDelete(item)} disabled={deletingId === item.id}><Trash2 size={16} /></button></div></div>
            <div style={s.cardBody}>{item.message}</div>
            <div style={s.cardFooter}><span style={s.metaBadge}><Tag size={13} /> {CATEGORIES.find((entry) => entry.value === item.category)?.label || item.category}</span><span style={s.metaBadge}>{SCOPES.find((entry) => entry.value === item.scope)?.label || item.scope}</span><span style={s.usage}><Send size={12} /> {item.usageCount} usos</span><button type="button" style={s.previewLink} onClick={() => setPreview(item)}><Eye size={14} /> Pré-visualizar</button></div>
          </article>;
        })}
      </div>

      {modal ? <div style={s.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(false); }}><div style={s.modal} role="dialog" aria-modal="true" aria-labelledby="quick-response-title"><div style={s.modalHeader}><div><p style={s.modalKicker}>{form.id ? 'Editar modelo' : 'Novo modelo'}</p><h3 id="quick-response-title" style={s.modalTitle}>{form.id ? 'Atualizar resposta' : 'Cadastrar resposta oficial'}</h3></div><button type="button" style={s.closeBtn} aria-label="Fechar" onClick={() => setModal(false)}><X size={17} /></button></div><form onSubmit={handleSubmit} style={s.form}><div style={s.field}><label style={s.label} htmlFor="quick-shortcut">Atalho</label><div style={s.inputWrapper}><span style={s.prefix}>/</span><input id="quick-shortcut" style={s.inputWithPrefix} value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value.replace(/\s/g, '') })} required placeholder="faturas" /></div></div><div style={s.twoCols}><div style={s.field}><label style={s.label} htmlFor="quick-category">Categoria</label><select id="quick-category" style={s.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.filter((item) => item.value !== 'all').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div style={s.field}><label style={s.label} htmlFor="quick-scope">Disponível para</label><select id="quick-scope" style={s.input} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>{SCOPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div><div style={s.field}><label style={s.label} htmlFor="quick-message">Mensagem completa</label><textarea id="quick-message" style={s.textarea} rows={7} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required placeholder="Escreva o modelo completo aqui..." /><p style={s.hint}>Use [nome], [cliente] ou [numero_os]. No chat, digite “/” para encontrar o atalho.</p></div>{form.message ? <div style={s.inlinePreview}><div style={s.inlinePreviewHead}><strong>Prévia para o cliente</strong><span>Exemplo</span></div><p>{sampleMessage(form.message)}</p></div> : null}<div style={s.modalFooter}><ActionButton variant="secondary" type="button" onClick={() => setModal(false)}>Cancelar</ActionButton><ActionButton type="submit" loading={saving}>{form.id ? 'Salvar alterações' : 'Criar modelo'}</ActionButton></div></form></div></div> : null}
      {preview ? <div style={s.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div style={{ ...s.modal, maxWidth: '32rem' }} role="dialog" aria-modal="true" aria-labelledby="preview-title"><div style={s.modalHeader}><div><p style={s.modalKicker}>Pré-visualização</p><h3 id="preview-title" style={s.modalTitle}>/{preview.shortcut}</h3></div><button type="button" style={s.closeBtn} aria-label="Fechar" onClick={() => setPreview(null)}><X size={17} /></button></div><div style={s.previewBody}><div style={s.previewRecipient}><div style={s.avatar}>{(preview.shortcut || 'M').slice(0, 1).toUpperCase()}</div><div><strong>Maria — exemplo</strong><small>Mensagem do atendimento</small></div></div><div style={s.bubble}>{sampleMessage(preview.message)}</div><p style={s.hint}>As variáveis serão substituídas pelos dados reais do contato quando usadas.</p></div></div></div> : null}
    </div>
  );
}

const s = {
  container: { padding: 'var(--space-10)', flex: 1, overflowY: 'auto', background: 'var(--bg-base)', color: 'var(--text-main)', boxSizing: 'border-box' },
  metrics: { display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: 'var(--space-6)' },
  metric: { display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: '10rem', flex: '1 1 10rem', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', padding: '0.75rem 0.9rem', color: 'var(--accent)' },
  toolbar: { display: 'flex', gap: '0.65rem', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap' },
  searchBox: { position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 20rem', minWidth: '14rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' },
  searchIcon: { position: 'absolute', left: '0.8rem', color: 'var(--text-dim)' },
  searchInput: { width: '100%', background: 'transparent', border: 0, padding: '0.82rem 0.8rem 0.82rem 2.35rem', color: 'var(--text-main)', outline: 'none', fontSize: 'var(--text-sm)' },
  filterSelect: { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-main)', padding: '0.8rem', fontSize: 'var(--text-sm)' },
  favoriteFilter: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)', color: 'var(--text-muted)', padding: '0.75rem 0.85rem', cursor: 'pointer', fontWeight: 700 },
  favoriteFilterActive: { color: 'var(--accent)', borderColor: 'var(--accent)' },
  categoryTabs: { display: 'flex', gap: '0.3rem', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', marginBottom: 'var(--space-6)' },
  categoryTab: { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--text-muted)', padding: '0.65rem 0.75rem', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 750 },
  categoryTabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  categoryCount: { borderRadius: 999, background: 'var(--bg-panel)', padding: '0.12rem 0.4rem', fontSize: '0.68rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-5)' },
  card: { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 },
  cardPinned: { borderColor: 'var(--accent-border)', boxShadow: '0 0 0 1px var(--accent-border)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.7rem' },
  cardActions: { display: 'flex', gap: '0.25rem' },
  iconBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-panel)', color: 'var(--text-muted)', cursor: 'pointer' },
  shortcut: { display: 'inline-flex', maxWidth: '75%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'var(--accent-light)', color: 'var(--accent)', padding: '0.35rem 0.65rem', borderRadius: 'var(--radius-pill)', fontSize: 'var(--text-xs)', fontWeight: 800, border: '1px solid var(--accent-border)' },
  cardBody: { color: 'var(--text-main)', fontSize: 'var(--text-sm)', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', flex: 1 },
  cardFooter: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem' },
  metaBadge: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 700 },
  usage: { display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-dim)', fontSize: '0.68rem', marginLeft: 'auto' },
  previewLink: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 750 },
  empty: { padding: '5rem', textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' },
  emptyCard: { gridColumn: '1 / -1', background: 'var(--bg-panel)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-10)', textAlign: 'center', color: 'var(--text-muted)' },
  emptyTitle: { marginTop: '0.8rem', marginBottom: '0.4rem', color: 'var(--text-main)', fontWeight: 800, fontSize: 'var(--text-lg)' },
  emptyText: { fontSize: 'var(--text-sm)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(6px)', padding: '1rem' },
  modal: { background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: '38rem', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto', border: '1px solid var(--border-color)', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' },
  modalHeader: { padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)' },
  modalKicker: { margin: '0 0 0.3rem', color: 'var(--accent)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' },
  modalTitle: { margin: 0, fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text-main)' },
  closeBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' },
  form: { padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: '1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.8rem' },
  label: { fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  inputWrapper: { position: 'relative', display: 'flex', alignItems: 'center' },
  prefix: { position: 'absolute', left: '0.85rem', color: 'var(--accent)', fontWeight: 800 },
  inputWithPrefix: { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem 0.9rem 0.85rem 1.9rem', color: 'var(--text-main)', outline: 'none' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.85rem 0.9rem', color: 'var(--text-main)', outline: 'none' },
  textarea: { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.9rem', color: 'var(--text-main)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', fontSize: 'var(--text-sm)', lineHeight: 1.55 },
  hint: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)', lineHeight: 1.45, margin: 0 },
  inlinePreviewHead: { display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: '0.35rem' },
  inlinePreview: { border: '1px solid var(--border-color)', background: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', padding: '0.8rem' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.2rem' },
  previewBody: { padding: 'var(--space-6)' },
  avatar: { width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 800 },
  previewRecipient: { display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.9rem' },
  bubble: { background: 'var(--accent-light)', border: '1px solid var(--accent-border)', borderRadius: '0.8rem 0.8rem 0.8rem 0.2rem', color: 'var(--text-main)', padding: '0.9rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 },
};
