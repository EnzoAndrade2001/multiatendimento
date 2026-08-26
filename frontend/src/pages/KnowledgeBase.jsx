import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BookOpen, CheckCircle2, Download, FileText, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import { toast } from '../utils/toast';
import {
  createKnowledge,
  deleteKnowledge,
  getKnowledge,
  getKnowledgeStats,
  reindexKnowledge,
  testKnowledgeSearch,
  updateKnowledge,
  deleteKnowledgeDocument,
  downloadKnowledgeDocument,
  getKnowledgeDocuments,
  publishKnowledgeDocument,
  reprocessKnowledgeDocument,
  unpublishKnowledgeDocument,
  uploadKnowledgeDocument,
} from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import SurfaceCard from '../components/ui/SurfaceCard';
import EmptyState from '../components/ui/EmptyState';
import ModalShell from '../components/ui/ModalShell';

const EMPTY_FORM = { question: '', answer: '', tags: '', active: true };
const EMPTY_DOCUMENT = { title: '', description: '', category: 'MANUAL', audience: 'CUSTOMER', manufacturer: '', equipmentModel: '', version: '', language: 'pt-BR', supersedesId: '', file: null };

export default function KnowledgeBase() {
  const [data, setData] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [reindexing, setReindexing] = useState(false);
  const [testQuery, setTestQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [tab, setTab] = useState('answers');
  const [documents, setDocuments] = useState([]);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [documentForm, setDocumentForm] = useState(EMPTY_DOCUMENT);
  const [documentBusy, setDocumentBusy] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!documents.some((item) => item.status === 'PROCESSING')) return undefined;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [documents]);

  async function load() {
    setLoading(true);
    try {
      const [knowledgeResult, statsResult, documentsResult] = await Promise.allSettled([getKnowledge(), getKnowledgeStats(), getKnowledgeDocuments()]);
      if (knowledgeResult.status === 'rejected') throw knowledgeResult.reason;
      setData(knowledgeResult.value.data);
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data);
      if (documentsResult.status === 'fulfilled') setDocuments(documentsResult.value.data);
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar a base de conhecimento. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDocumentUpload(event) {
    event.preventDefault();
    if (!documentForm.file || documentBusy) return;
    setDocumentBusy(true);
    try {
      const payload = new FormData();
      Object.entries(documentForm).forEach(([key, value]) => { if (key !== 'file' && value) payload.append(key, value); });
      payload.append('file', documentForm.file);
      await uploadKnowledgeDocument(payload);
      toast.success('Documento recebido. O processamento continuará em segundo plano.');
      setShowDocumentModal(false);
      setDocumentForm(EMPTY_DOCUMENT);
      await load();
    } catch (error) { toast.error(error.response?.data?.error || 'Não foi possível enviar o documento.'); }
    finally { setDocumentBusy(false); }
  }

  async function documentAction(action, item) {
    setDocumentBusy(true);
    try {
      if (action === 'publish') await publishKnowledgeDocument(item.id);
      if (action === 'unpublish') await unpublishKnowledgeDocument(item.id);
      if (action === 'reprocess') await reprocessKnowledgeDocument(item.id);
      if (action === 'delete') await deleteKnowledgeDocument(item.id);
      if (action === 'download') {
        const response = await downloadKnowledgeDocument(item.id);
        const url = URL.createObjectURL(response.data);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.originalName; anchor.click(); URL.revokeObjectURL(url);
      } else {
        toast.success(action === 'publish' ? 'Documento publicado para consulta.' : action === 'unpublish' ? 'Documento retirado das respostas.' : action === 'delete' ? 'Documento excluído.' : 'Reprocessamento iniciado.');
        await load();
      }
    } catch (error) { toast.error(error.response?.data?.error || 'Não foi possível concluir a ação.'); }
    finally { setDocumentBusy(false); }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const response = editing ? await updateKnowledge(editing.id, form) : await createKnowledge(form);
      setShowModal(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      if (!response.data.indexed) toast.warning('Conhecimento salvo, mas ainda não foi indexado. Use “Reindexar base”.');
      else toast.success(editing ? 'Conhecimento atualizado.' : 'Conhecimento cadastrado.');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar o conhecimento.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReindex() {
    if (reindexing) return;
    setReindexing(true);
    try {
      const response = await reindexKnowledge();
      const { indexed, failed } = response.data;
      if (failed) toast.warning(`${indexed} item(ns) indexado(s) e ${failed} com falha.`);
      else toast.success(`${indexed} item(ns) indexado(s) com sucesso.`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível reindexar a base.');
    } finally {
      setReindexing(false);
    }
  }

  async function handleTest(event) {
    event.preventDefault();
    if (!testQuery.trim() || testing) return;
    setTesting(true);
    try {
      const response = await testKnowledgeSearch(testQuery.trim());
      setTestResult(response.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível testar a consulta.');
    } finally {
      setTesting(false);
    }
  }

  function handleDelete(item) {
    const label = item.question?.length > 80 ? `${item.question.slice(0, 80)}...` : item.question;
    toast.confirm(`Excluir "${label}"? Essa ação não pode ser desfeita.`, async () => {
      setDeletingId(item.id);
      try {
        await deleteKnowledge(item.id);
        toast.success('Conhecimento excluído.');
        await load();
      } catch (error) {
        toast.error(error.response?.data?.error || 'Não foi possível excluir o conhecimento.');
      } finally {
        setDeletingId(null);
      }
    });
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({ question: item.question, answer: item.answer, tags: item.tags || '', active: item.active });
    setShowModal(true);
  }

  const indicators = [
    { label: 'Conhecimentos ativos', value: stats?.active ?? '—', detail: `${stats?.total ?? 0} cadastrado(s)`, icon: BookOpen },
    { label: 'Itens indexados', value: stats?.indexed ?? '—', detail: 'Prontos para busca semântica', icon: CheckCircle2 },
    { label: 'Consultas em 7 dias', value: stats?.consultations7d ?? '—', detail: 'Toda resposta da IA consulta a base', icon: Activity },
    { label: 'Base utilizada', value: stats ? `${stats.matchRate7d}%` : '—', detail: `${stats?.matches7d ?? 0} correspondência(s)`, icon: Search },
  ];

  return (
    <div style={s.page}>
      <PageHeader
        kicker="Treinamento da IA"
        title="Base de conhecimento"
        subtitle="Cadastre respostas oficiais, confira a indexação e teste exatamente o que o bot encontrará."
        actions={<div style={s.headerActions}>
          <ActionButton variant="secondary" onClick={() => { setShowTest((value) => !value); setTestResult(null); }}>
            <Search size={17} /> Testar consulta
          </ActionButton>
          <ActionButton variant="secondary" onClick={handleReindex} loading={reindexing}>
            <RefreshCw size={17} /> Reindexar base
          </ActionButton>
          <ActionButton onClick={tab === 'answers' ? openCreate : () => setShowDocumentModal(true)}>{tab === 'answers' ? <Plus size={18} /> : <Upload size={18} />} {tab === 'answers' ? 'Novo conhecimento' : 'Anexar documento'}</ActionButton>
        </div>}
      />

      <div style={s.tabs}>
        <button type="button" style={{ ...s.tab, ...(tab === 'answers' ? s.tabActive : {}) }} onClick={() => setTab('answers')}><BookOpen size={17} /> Respostas oficiais</button>
        <button type="button" style={{ ...s.tab, ...(tab === 'documents' ? s.tabActive : {}) }} onClick={() => setTab('documents')}><FileText size={17} /> Manuais e portfólios <span style={s.tabCount}>{documents.length}</span></button>
      </div>

      {tab === 'answers' ? <><div style={s.statsGrid}>
        {indicators.map(({ label, value, detail, icon: Icon }) => (
          <SurfaceCard key={label} style={s.statCard}>
            <div style={s.statTop}><span style={s.statLabel}>{label}</span><Icon size={18} color="var(--accent)" /></div>
            <strong style={s.statValue}>{value}</strong>
            <span style={s.statDetail}>{detail}</span>
          </SurfaceCard>
        ))}
      </div>

      {showTest ? (
        <SurfaceCard style={s.testPanel}>
          <div>
            <h3 style={s.panelTitle}>Simular pergunta do cliente</h3>
            <p style={s.panelText}>O teste não envia mensagem. Ele mostra quais conteúdos seriam entregues à IA e a relevância encontrada.</p>
          </div>
          <form onSubmit={handleTest} style={s.testForm}>
            <input style={s.input} value={testQuery} onChange={(event) => setTestQuery(event.target.value)} placeholder="Ex: Minha máquina apresentou o erro SC 542" />
            <ActionButton type="submit" loading={testing}><Search size={17} /> Consultar</ActionButton>
          </form>
          {testResult ? (
            <div style={s.testResults}>
              {testResult.matches.length ? testResult.matches.map((match) => (
                <div key={match.id} style={s.testMatch}>
                  <div style={s.matchHeader}>
                    <strong>{match.question}</strong>
                    <span style={s.score}>{Math.round(match.score * 100)}% · {match.method}</span>
                  </div>
                  <p style={s.matchAnswer}>{match.answer}</p>
                </div>
              )) : <div style={s.noMatch}><AlertTriangle size={18} /> Nenhum conteúdo relevante foi encontrado. Cadastre ou ajuste um conhecimento para essa pergunta.</div>}
            </div>
          ) : null}
        </SurfaceCard>
      ) : null}

      {loading ? <div style={s.loading}>Carregando...</div> : (
        <div style={s.grid}>
          {data.map((item) => (
            <SurfaceCard key={item.id} style={s.card}>
              <div style={s.statusRow}>
                <span style={s.cardStatus}><span style={{ ...s.statusDot, background: item.active ? 'var(--success)' : 'var(--text-dim)' }} />{item.active ? 'Ativo' : 'Inativo'}</span>
                <span style={{ ...s.indexBadge, ...(item.indexed ? s.indexed : s.notIndexed) }}>{item.indexed ? 'Indexado' : 'Não indexado'}</span>
              </div>
              <h3 style={s.cardTitle} title={item.question}>{item.question}</h3>
              <p style={s.cardAnswer} title={item.answer}>{item.answer}</p>
              {item.tags ? <div style={s.tags}>{item.tags.split(',').filter(Boolean).map((tag) => <span key={tag} style={s.tag}>{tag.trim()}</span>)}</div> : null}
              <div style={s.usage}>Usado {item.usageCount30d || 0} vez(es) nos últimos 30 dias{item.lastUsedAt ? ` · última em ${new Date(item.lastUsedAt).toLocaleDateString('pt-BR')}` : ''}</div>
              <div style={s.cardActions}>
                <ActionButton variant="secondary" style={s.actionBtn} disabled={deletingId === item.id} onClick={() => openEdit(item)}>Editar</ActionButton>
                <ActionButton variant="danger" style={s.actionBtn} loading={deletingId === item.id} onClick={() => handleDelete(item)}>Excluir</ActionButton>
              </div>
            </SurfaceCard>
          ))}
          {!data.length ? <EmptyState icon={<BookOpen size={22} />} title="Nenhum conhecimento cadastrado" description="Cadastre perguntas, procedimentos e respostas oficiais para orientar a IA." action={<ActionButton onClick={openCreate}><Plus size={18} /> Novo conhecimento</ActionButton>} style={{ gridColumn: '1 / -1' }} /> : null}
        </div>
      )}

      {showModal ? (
        <ModalShell kicker={editing ? 'Editar conhecimento' : 'Novo conhecimento'} title={editing ? 'Atualizar base da IA' : 'Cadastrar base da IA'} onClose={() => setShowModal(false)} maxWidth="36rem">
          <form onSubmit={handleSave} style={s.modalBody}>
            <label style={s.label}>Pergunta, erro ou tópico</label>
            <input style={s.input} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="Ex: O que fazer quando aparecer o erro SC 542?" required />
            <span style={s.fieldHelp}>Inclua o código, modelo ou termo que o cliente normalmente usaria.</span>
            <label style={s.label}>Resposta oficial</label>
            <textarea style={{ ...s.input, minHeight: 170, resize: 'vertical' }} value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} placeholder="Escreva o procedimento aprovado, com limites claros e sem promessas que dependam do iLux." required />
            <label style={s.label}>Palavras-chave (opcional)</label>
            <input style={s.input} value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="sc542, fusor, ricoh, erro de impressão" />
            <label style={s.activeOption}>
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
              <span style={{ display: 'grid', gap: 'var(--space-1)' }}><strong>Disponível para o bot</strong><small style={{ color: 'var(--text-muted)' }}>Desmarque para manter este conteúdo salvo sem utilizá-lo nas respostas.</small></span>
            </label>
            <div style={s.modalFooter}><ActionButton variant="secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancelar</ActionButton><ActionButton type="submit" loading={saving}>Salvar e indexar</ActionButton></div>
          </form>
        </ModalShell>
      ) : null}</> : (
        <div style={s.documentGrid}>
          {documents.map((item) => (
            <SurfaceCard key={item.id} style={s.card}>
              <div style={s.statusRow}><span style={s.cardStatus}><FileText size={16} />{item.category}</span><span style={{ ...s.indexBadge, ...(item.status === 'PUBLISHED' ? s.indexed : item.status === 'FAILED' ? s.notIndexed : {}) }}>{item.status}</span></div>
              <div><h3 style={s.cardTitle}>{item.title}</h3><p style={s.panelText}>{item.originalName}</p></div>
              <div style={s.documentMeta}><span>Público: <strong>{item.audience}</strong></span><span>{item.pageCount || 0} pág. · {item.chunkCount || 0} trechos</span>{item.version ? <span>Versão {item.version}</span> : null}</div>
              {(item.manufacturer || item.equipmentModel) ? <div style={s.tags}><span style={s.tag}>{[item.manufacturer, item.equipmentModel].filter(Boolean).join(' ')}</span></div> : null}
              {item.processingError ? <div style={s.noMatch}><AlertTriangle size={17} /> {item.processingError}</div> : null}
              <div style={s.usage}>Usado {item.usageCount30d || 0} vez(es) nos últimos 30 dias. Apenas documentos CUSTOMER e publicados podem orientar o bot.</div>
              <div style={s.cardActions}>
                <ActionButton variant="secondary" style={s.actionBtn} onClick={() => documentAction('download', item)}><Download size={15} /> Baixar</ActionButton>
                {item.status === 'DRAFT' ? <ActionButton style={s.actionBtn} onClick={() => documentAction('publish', item)}>Publicar</ActionButton> : null}
                {item.status === 'PUBLISHED' ? <ActionButton variant="secondary" style={s.actionBtn} onClick={() => documentAction('unpublish', item)}>Retirar</ActionButton> : null}
                {item.status === 'FAILED' ? <ActionButton style={s.actionBtn} onClick={() => documentAction('reprocess', item)}>Reprocessar</ActionButton> : null}
                {!['PUBLISHED', 'PROCESSING'].includes(item.status) ? <ActionButton variant="danger" style={s.actionBtn} onClick={() => documentAction('delete', item)}>Excluir</ActionButton> : null}
              </div>
            </SurfaceCard>
          ))}
          {!documents.length ? <EmptyState icon={<FileText size={22} />} title="Nenhum documento técnico" description="Anexe manuais, procedimentos e portfólios. Revise o processamento antes de publicar para o bot." action={<ActionButton onClick={() => setShowDocumentModal(true)}><Upload size={18} /> Anexar documento</ActionButton>} style={{ gridColumn: '1 / -1' }} /> : null}
        </div>
      )}

      {showDocumentModal ? <ModalShell kicker="Base documental" title="Anexar manual ou portfólio" onClose={() => setShowDocumentModal(false)} maxWidth="42rem">
        <form onSubmit={handleDocumentUpload} style={s.modalBody}>
          <label style={s.label}>Título</label><input style={s.input} required value={documentForm.title} onChange={(e) => setDocumentForm({ ...documentForm, title: e.target.value })} placeholder="Ex: Manual técnico Ricoh MP C3004" />
          <div style={s.formGrid}><label style={s.fieldGroup}><span style={s.label}>Categoria</span><select style={s.input} value={documentForm.category} onChange={(e) => setDocumentForm({ ...documentForm, category: e.target.value })}><option value="MANUAL">Manual</option><option value="PROCEDURE">Procedimento</option><option value="PORTFOLIO">Portfólio</option></select></label><label style={s.fieldGroup}><span style={s.label}>Quem pode usar</span><select style={s.input} value={documentForm.audience} onChange={(e) => setDocumentForm({ ...documentForm, audience: e.target.value })}><option value="CUSTOMER">Bot com clientes</option><option value="AGENT">Somente atendentes</option><option value="TECHNICIAN">Somente técnicos</option></select></label></div>
          <div style={s.formGrid}><label style={s.fieldGroup}><span style={s.label}>Fabricante</span><input style={s.input} value={documentForm.manufacturer} onChange={(e) => setDocumentForm({ ...documentForm, manufacturer: e.target.value })} placeholder="Ricoh" /></label><label style={s.fieldGroup}><span style={s.label}>Modelo do equipamento</span><input style={s.input} value={documentForm.equipmentModel} onChange={(e) => setDocumentForm({ ...documentForm, equipmentModel: e.target.value })} placeholder="MP C3004" /></label></div>
          <div style={s.formGrid}><label style={s.fieldGroup}><span style={s.label}>Versão</span><input style={s.input} value={documentForm.version} onChange={(e) => setDocumentForm({ ...documentForm, version: e.target.value })} /></label><label style={s.fieldGroup}><span style={s.label}>Arquivo (máx. 25 MB)</span><input style={s.input} type="file" required accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp" onChange={(e) => setDocumentForm({ ...documentForm, file: e.target.files?.[0] || null })} /></label></div>
          <label style={s.fieldGroup}><span style={s.label}>Substitui uma versão anterior? (opcional)</span><select style={s.input} value={documentForm.supersedesId} onChange={(e) => setDocumentForm({ ...documentForm, supersedesId: e.target.value })}><option value="">Não, é um documento novo</option>{documents.filter((item) => item.status !== 'REPLACED').map((item) => <option key={item.id} value={item.id}>{item.title}{item.version ? ` — versão ${item.version}` : ''}</option>)}</select><small style={s.fieldHelp}>Ao publicar a nova versão, a anterior será retirada automaticamente das respostas.</small></label>
          <div style={s.noMatch}><AlertTriangle size={17} /> O arquivo será processado como rascunho. Ele só passa a orientar o bot depois que um administrador clicar em Publicar.</div>
          <div style={s.modalFooter}><ActionButton variant="secondary" onClick={() => setShowDocumentModal(false)}>Cancelar</ActionButton><ActionButton type="submit" loading={documentBusy}><Upload size={17} /> Enviar e processar</ActionButton></div>
        </form>
      </ModalShell> : null}
    </div>
  );
}

const s = {
  page: { padding: 'var(--space-10)', background: 'var(--bg-base)', flex: 1, overflowY: 'auto', color: 'var(--text-main)', minHeight: '100%' },
  headerActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' },
  tabs: { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--border-color)' },
  tab: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: 'var(--text-muted)', padding: 'var(--space-3) var(--space-4)', cursor: 'pointer', fontWeight: 800, fontFamily: 'inherit' },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  tabCount: { borderRadius: 999, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', padding: '1px 7px', fontSize: 'var(--text-xs)' },
  loading: { textAlign: 'center', padding: 'var(--space-12)', color: 'var(--text-muted)' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' },
  statCard: { gap: 'var(--space-2)', padding: 'var(--space-5)' },
  statTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' },
  statValue: { fontSize: 'var(--text-2xl)', color: 'var(--text-main)' },
  statDetail: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
  testPanel: { marginBottom: 'var(--space-6)', gap: 'var(--space-4)' },
  panelTitle: { margin: 0, fontSize: 'var(--text-lg)' },
  panelText: { margin: 'var(--space-1) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' },
  testForm: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 'var(--space-3)' },
  testResults: { display: 'grid', gap: 'var(--space-3)' },
  testMatch: { border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--bg-base)' },
  matchHeader: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' },
  score: { color: 'var(--success)', whiteSpace: 'nowrap', fontSize: 'var(--text-xs)', fontWeight: 800 },
  matchAnswer: { margin: 'var(--space-2) 0 0', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.6 },
  noMatch: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--warning-text)', padding: 'var(--space-4)', background: 'var(--warning-light)', borderRadius: 'var(--radius-md)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 'var(--space-6)' },
  documentGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-6)' },
  documentMeta: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
  card: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: '100%', minWidth: 0 },
  statusRow: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' },
  cardStatus: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em' },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  indexBadge: { borderRadius: '999px', padding: '3px 9px', fontSize: 'var(--text-xs)', fontWeight: 800 },
  indexed: { color: 'var(--success-text)', background: 'var(--success-light)' },
  notIndexed: { color: 'var(--danger-text)', background: 'var(--danger-light)' },
  cardTitle: { margin: 0, fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text-main)', overflowWrap: 'break-word' },
  cardAnswer: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)', flex: 1, margin: 0, overflowWrap: 'break-word', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' },
  tag: { background: 'var(--accent-light)', color: 'var(--accent)', padding: '2px var(--space-2)', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700, border: '1px solid var(--accent-border)' },
  usage: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  cardActions: { display: 'flex', gap: 'var(--space-3)', borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-4)' },
  actionBtn: { minWidth: '6rem' },
  modalBody: { padding: '1.8rem', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--space-4)' },
  fieldGroup: { display: 'grid', gap: 'var(--space-2)' },
  label: { fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  fieldHelp: { marginTop: 'calc(var(--space-3) * -1)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
  activeOption: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', cursor: 'pointer' },
  input: { width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', color: 'var(--text-main)', outline: 'none', fontSize: 'var(--text-md)', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 'var(--leading-relaxed)' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '0.85rem', marginTop: 'var(--space-2)' },
};
