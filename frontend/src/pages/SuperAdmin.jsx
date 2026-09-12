import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Building2, Copy, KeyRound, LogIn, MessageSquare, PackageCheck, Pencil, Plus, Power, RotateCw, Server, Upload, Users, Wifi } from 'lucide-react';
import { toast } from '../utils/toast';
import {
  getTenants, createTenant, updateTenant, uploadFile, getMediaUrl,
  getTenantUsers, createTenantUser, updateTenantUser, getFirebirdAgents,
  startSupportSession,
  getFeatureCatalog, getTenantEntitlements, updateTenantEntitlements,
  updateProductPlan, updateProductPlanFeatures,
  getSupportUsers, createSupportUser, updateSupportUser,
} from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import SurfaceCard from '../components/ui/SurfaceCard';
import EmptyState from '../components/ui/EmptyState';
import ModalShell from '../components/ui/ModalShell';

export default function SuperAdmin() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    plan: 'trial',
    primaryColor: '#D4AF37',
    logoUrl: '',
    maxConnections: 1,
    maxUsers: 5,
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [usersModal, setUsersModal] = useState(null);
  const [fbAgents, setFbAgents] = useState(null);
  const [featureCatalog, setFeatureCatalog] = useState({ features: [], plans: [] });
  const [entitlementsModal, setEntitlementsModal] = useState(null);
  const [plansModal, setPlansModal] = useState(false);
  const [supportUsers, setSupportUsers] = useState([]);
  const [supportModal, setSupportModal] = useState(false);
  const isManager = (localStorage.getItem('supportLevel') || 'manager') === 'manager';

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [tenantsResult, agentsResult, featuresResult, supportResult] = await Promise.allSettled([getTenants(), getFirebirdAgents(), getFeatureCatalog(), getSupportUsers()]);
      if (tenantsResult.status === 'fulfilled') {
        setTenants(tenantsResult.value.data);
      } else {
        throw tenantsResult.reason;
      }
      // O inventário do agente é secundário: uma falha aqui não derruba a tela.
      if (agentsResult.status === 'fulfilled') setFbAgents(agentsResult.value.data);
      if (featuresResult.status === 'fulfilled') {
        const payload = featuresResult.value.data || {};
        setFeatureCatalog({
          features: Array.isArray(payload) ? payload : (payload.features || []),
          plans: payload.plans || payload.productPlans || [],
        });
      }
      if (supportResult.status === 'fulfilled') setSupportUsers(supportResult.value.data || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível carregar as empresas. Verifique sua conexão ou permissão de acesso.');
    } finally {
      setLoading(false);
    }
  }

  async function accessAsSupport(tenant) {
    const reason = window.prompt(`Motivo do acesso técnico à empresa ${tenant.name}:`);
    if (!reason) return;
    if (reason.trim().length < 5) return toast.error('Informe um motivo com pelo menos 5 caracteres.');
    try {
      const masterToken = localStorage.getItem('token');
      const { data } = await startSupportSession(tenant.id, reason.trim());
      localStorage.setItem('supportMasterToken', masterToken);
      localStorage.setItem('supportMasterTenantId', localStorage.getItem('tenantId') || '');
      localStorage.setItem('supportMasterTenantName', localStorage.getItem('tenantName') || '');
      localStorage.setItem('token', data.token);
      localStorage.setItem('tenantId', tenant.id);
      localStorage.setItem('tenantName', tenant.name);
      window.location.assign('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível iniciar a sessão de suporte.');
    }
  }

  function openModal(tenant = null) {
    if (tenant) {
      setModal(tenant);
      setForm({
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        primaryColor: tenant.primaryColor || '#D4AF37',
        logoUrl: tenant.logoUrl || '',
        maxConnections: tenant.maxConnections || 1,
        maxUsers: tenant.maxUsers || 5,
        adminName: '',
        adminEmail: '',
        adminPassword: '',
      });
      return;
    }

    setModal('new');
    setForm({
      name: '',
      slug: '',
      plan: 'trial',
      primaryColor: '#D4AF37',
      logoUrl: '',
      maxConnections: 1,
      maxUsers: 5,
      adminName: '',
      adminEmail: '',
      adminPassword: '',
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (modal === 'new') {
      if (!form.adminName.trim() || !form.adminEmail.trim() || form.adminPassword.length < 6) {
        toast.error('Informe nome, e-mail e uma senha (mín. 6 caracteres) para o primeiro acesso da empresa.');
        return;
      }
    }
    setSaving(true);
    try {
      if (modal === 'new') {
        await createTenant(form);
        toast.success(`Empresa criada. Login em /${form.slug}/login com ${form.adminEmail.trim().toLowerCase()}.`);
      } else {
        await updateTenant(modal.id, form);
      }
      setModal(null);
      load();
    } catch (e) {
      toast.error(
        e.response?.data?.error ||
          (modal === 'new'
            ? 'Não foi possível criar a empresa. Verifique os dados e tente novamente.'
            : 'Não foi possível salvar as alterações da empresa.')
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(tenant) {
    if (pendingId) return;

    const applyToggle = async () => {
      setPendingId(tenant.id);
      try {
        await updateTenant(tenant.id, { active: !tenant.active });
        load();
      } catch (e) {
        toast.error(e.response?.data?.error || `Não foi possível atualizar o status da empresa ${tenant.name}.`);
      } finally {
        setPendingId(null);
      }
    };

    if (tenant.active) {
      toast.confirm(
        `Bloquear o acesso da empresa "${tenant.name}"? Todos os usuários dela perderão acesso ao sistema imediatamente.`,
        applyToggle
      );
    } else {
      applyToggle();
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setSaving(true);
    try {
      const { data } = await uploadFile(file);
      setForm({ ...form, logoUrl: data.url });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível enviar a logo. Tente novamente ou informe a URL da imagem diretamente.');
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(
    () => ({
      total: tenants.length,
      active: tenants.filter((tenant) => tenant.active).length,
      totalUsers: tenants.reduce((acc, tenant) => acc + (tenant._count?.users || 0), 0),
      activeUsers: tenants.reduce((acc, tenant) => acc + (tenant.metrics?.activeUsers || 0), 0),
      connectedInstances: tenants.reduce((acc, tenant) => acc + (tenant.metrics?.connectedInstances || 0), 0),
      totalInstances: tenants.reduce((acc, tenant) => acc + (tenant._count?.instances || 0), 0),
      messages30d: tenants.reduce((acc, tenant) => acc + (tenant.metrics?.messages30d || 0), 0),
      openTickets: tenants.reduce((acc, tenant) => acc + (tenant.metrics?.openTickets || 0), 0),
      monthlyRevenue: tenants.filter((tenant) => tenant.active).reduce((acc, tenant) => {
        const plan = featureCatalog.plans.find((item) => item.code === tenant.plan);
        return acc + Number(plan?.monthlyPrice || 0);
      }, 0),
    }),
    [tenants, featureCatalog.plans]
  );

  // "há 2h", "há 5 dias"... usado tanto na coluna de atividade quanto na
  // idade da empresa (createdAt), sem depender de nenhuma lib de datas.
  function timeAgo(dateStr) {
    if (!dateStr) return 'Sem atividade';
    const diffMs = Date.now() - new Date(dateStr).getTime();
    if (diffMs < 0) return 'agora';
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'agora mesmo';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `há ${days} dia${days > 1 ? 's' : ''}`;
    const months = Math.floor(days / 30);
    if (months < 12) return `há ${months} ${months > 1 ? 'meses' : 'mês'}`;
    const years = Math.floor(months / 12);
    return `há ${years} ano${years > 1 ? 's' : ''}`;
  }

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Operacao global"
        title="Gestao SaaS"
        subtitle="Gerencie empresas, planos e limites da plataforma a partir de uma camada administrativa unica."
        actions={<div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {isManager && <ActionButton variant="secondary" onClick={() => setSupportModal(true)}><Users size={18} /> Equipe de suporte</ActionButton>}
          {isManager && <ActionButton variant="secondary" onClick={() => setPlansModal(true)}><PackageCheck size={18} /> Editar planos</ActionButton>}
          {isManager && <ActionButton onClick={() => openModal()}><Plus size={18} /> Nova empresa</ActionButton>}
        </div>}
      />

      <div style={s.statsRow}>
        <SurfaceCard style={s.statCard}>
          <PackageCheck size={18} style={s.statIcon} />
          <div style={s.statVal}>{stats.monthlyRevenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
          <div style={s.statLabel}>Receita mensal prevista</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <Users size={18} style={s.statIcon} />
          <div style={s.statVal}>{supportUsers.filter((user) => user.active).length}</div>
          <div style={s.statLabel}>Equipe de suporte ativa</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <Building2 size={18} style={s.statIcon} />
          <div style={s.statVal}>{stats.total}</div>
          <div style={s.statLabel}>Empresas totais</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <Power size={18} style={s.statIcon} />
          <div style={s.statVal}>{stats.active}</div>
          <div style={s.statLabel}>Empresas ativas</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <Users size={18} style={s.statIcon} />
          <div style={{ ...s.statVal, color: 'var(--accent)' }}>{stats.activeUsers} / {stats.totalUsers}</div>
          <div style={s.statLabel}>Usuários ativos</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <Wifi size={18} style={s.statIcon} />
          <div style={{ ...s.statVal, color: stats.connectedInstances > 0 ? 'var(--success)' : 'var(--text-main)' }}>{stats.connectedInstances} / {stats.totalInstances}</div>
          <div style={s.statLabel}>Conexões conectadas</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <MessageSquare size={18} style={s.statIcon} />
          <div style={s.statVal}>{stats.messages30d.toLocaleString('pt-BR')}</div>
          <div style={s.statLabel}>Mensagens (30 dias)</div>
        </SurfaceCard>
        <SurfaceCard style={s.statCard}>
          <Activity size={18} style={s.statIcon} />
          <div style={{ ...s.statVal, color: stats.openTickets > 0 ? 'var(--warning-text)' : 'var(--text-main)' }}>{stats.openTickets}</div>
          <div style={s.statLabel}>Conversas abertas agora</div>
        </SurfaceCard>
      </div>

      <SurfaceCard style={s.tableCard}>
        {loading ? (
          <div style={s.empty}>Carregando ecossistema...</div>
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={<Building2 size={22} />}
            title="Nenhuma empresa cadastrada"
            description="Crie a primeira empresa para iniciar a operacao multi-tenant da plataforma."
          />
        ) : (
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>Empresa</th>
                <th style={s.th}>Acesso</th>
                <th style={s.th}>Plano</th>
                <th style={s.th}>Limites</th>
                <th style={s.th}>Atividade</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} style={s.tr}>
                  <td style={s.td}>
                    <div style={s.companyCell}>
                      <div style={s.logoThumb}>
                        {tenant.logoUrl ? (
                          <img src={getMediaUrl(tenant.logoUrl)} alt={tenant.name} style={s.logoImg} />
                        ) : (
                          <Building2 size={16} />
                        )}
                      </div>
                      <div style={s.companyInfo}>
                        <div style={s.companyName} title={tenant.name}>{tenant.name}</div>
                        <div style={s.companyMeta} title={`ID: ${tenant.id}`}>Criada {timeAgo(tenant.createdAt)}</div>
                      </div>
                    </div>
                  </td>
                  <td style={s.td}>
                    <div style={s.linkCell}>
                      <code style={s.code}>{`/${tenant.slug}/login`}</code>
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/${tenant.slug}/login`;
                          navigator.clipboard.writeText(url);
                          toast.success(`Link da empresa ${tenant.name} copiado`);
                        }}
                        style={s.inlineIconBtn}
                        title="Copiar URL completa"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </td>
                  <td style={s.td}>
                    <span
                      style={{
                        ...s.badge,
                        ...(tenant.plan === 'enterprise' ? s.badgeAccent : s.badgeMuted),
                      }}
                    >
                      {(tenant.plan || 'sem plano').toUpperCase()}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={s.limitRow} title={`${tenant.metrics?.activeUsers ?? 0} usuário(s) ativo(s) de ${tenant._count?.users || 0} cadastrado(s)`}>
                      <Users size={14} />
                      {tenant._count?.users || 0} / <strong>{tenant.maxUsers}</strong>
                    </div>
                    <div style={s.limitRow} title={`${tenant.metrics?.connectedInstances ?? 0} conexão(ões) conectada(s) agora`}>
                      <Wifi size={14} style={{ color: (tenant.metrics?.connectedInstances || 0) > 0 ? 'var(--success)' : undefined }} />
                      {tenant._count?.instances || 0} / <strong>{tenant.maxConnections}</strong>
                      {(tenant.metrics?.connectedInstances || 0) > 0 && (
                        <span style={s.connectedTag}>{tenant.metrics.connectedInstances} conectada{tenant.metrics.connectedInstances > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </td>
                  <td style={s.td}>
                    <div style={s.limitRow}>
                      <MessageSquare size={14} />
                      {(tenant.metrics?.messages30d ?? 0).toLocaleString('pt-BR')} <span style={s.limitHint}>msgs/30d</span>
                    </div>
                    <div style={s.limitRow}>
                      <Activity size={14} />
                      {tenant.metrics?.openTickets ?? 0} <span style={s.limitHint}>abertas · {timeAgo(tenant.metrics?.lastActivityAt)}</span>
                    </div>
                  </td>
                  <td style={s.td}>
                    <div style={s.statusCell}>
                      <span style={{ ...s.statusDot, background: tenant.active ? 'var(--success)' : 'var(--text-dim)' }} />
                      {tenant.active ? 'Ativa' : 'Bloqueada'}
                    </div>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <div style={s.actions}>
                      <button style={s.iconBtn} onClick={() => accessAsSupport(tenant)} title={`Acessar ${tenant.name} como suporte`}>
                        <LogIn size={16} />
                      </button>
                      {isManager && <button style={s.iconBtn} onClick={() => setUsersModal(tenant)} title={`Logins de ${tenant.name}`}>
                        <KeyRound size={16} />
                      </button>}
                      {isManager && <button style={s.iconBtn} onClick={() => setEntitlementsModal(tenant)} title={`Plano e recursos de ${tenant.name}`}>
                        <PackageCheck size={16} />
                      </button>}
                      {isManager && <button style={s.iconBtn} onClick={() => openModal(tenant)} title="Editar empresa">
                        <Pencil size={16} />
                      </button>}
                      {isManager && <button
                        style={{ ...s.iconBtn, color: tenant.active ? 'var(--danger)' : 'var(--success)' }}
                        onClick={() => toggleActive(tenant)}
                        disabled={pendingId === tenant.id}
                        title={tenant.active ? `Bloquear empresa ${tenant.name}` : `Reativar empresa ${tenant.name}`}
                      >
                        <Power size={16} />
                      </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SurfaceCard>

      <SurfaceCard style={{ ...s.tableCard, marginTop: 'var(--space-5, 20px)' }}>
        <div style={s.agentFleetHeader}>
          <div>
            <div style={s.agentFleetTitle}>
              <Server size={16} />
              Agentes Firebird
            </div>
            {fbAgents ? (
              <div style={s.agentFleetMeta}>
                {fbAgents.agentCount} instalação(ões) em {fbAgents.tenantCount} empresa(s) · {fbAgents.onlineCount} online
                {fbAgents.outdatedCount > 0 ? ` · ${fbAgents.outdatedCount} desatualizada(s)` : ''}
                {fbAgents.latestVersion ? ` · publicado ${fbAgents.latestVersion}` : ''}
              </div>
            ) : (
              <div style={s.agentFleetMeta}>Inventário indisponível no momento.</div>
            )}
          </div>
          <button onClick={load} style={s.inlineIconBtn} title="Atualizar inventário de agentes" disabled={loading}>
            <RotateCw size={14} />
          </button>
        </div>

        {!fbAgents || fbAgents.agents.length === 0 ? (
          <div style={s.empty}>
            {fbAgents
              ? 'Nenhuma instalação registrou ping ainda. Cada servidor aparece aqui assim que o agente se comunicar.'
              : 'Não foi possível carregar o inventário dos agentes.'}
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>Empresa</th>
                <th style={s.th}>Servidor</th>
                <th style={s.th}>Versão</th>
                <th style={s.th}>Último ping</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {fbAgents.agents.map((agent) => (
                <tr key={agent.id} style={s.tr}>
                  <td style={s.td}>
                    <div style={s.companyName} title={agent.tenantName || ''}>{agent.tenantName || '—'}</div>
                    <div style={s.companyMeta}>{agent.tenantSlug ? `/${agent.tenantSlug}` : ''}</div>
                  </td>
                  <td style={s.td}>
                    <div style={s.companyName} title={agent.installId}>
                      {agent.identified
                        ? (agent.hostname || `Instalação ${agent.installId.slice(0, 8)}`)
                        : 'Sem identificador'}
                    </div>
                    {!agent.identified && <div style={s.companyMeta}>agente antigo · atualizar p/ individualizar</div>}
                    {agent.identified && agent.runtime === 'python' && <div style={s.companyMeta}>execução via Python</div>}
                  </td>
                  <td style={s.td}>
                    <code style={s.code}>{agent.version || 'desconhecida'}</code>
                  </td>
                  <td style={s.td}>
                    <span title={agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString('pt-BR') : ''}>
                      {timeAgo(agent.lastSeenAt)}
                    </span>
                  </td>
                  <td style={s.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        ...s.badge,
                        color: agent.online ? 'var(--success)' : 'var(--text-dim)',
                        borderColor: agent.online ? 'var(--success)' : 'var(--border-color)',
                      }}>
                        {agent.online ? 'Online' : 'Offline'}
                      </span>
                      {agent.updateAvailable && (
                        <span style={{ ...s.badge, color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                          ⚠ desatualizado
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SurfaceCard>

      {modal ? (
        <ModalShell
          kicker={modal === 'new' ? 'Nova empresa' : 'Editar empresa'}
          title={modal === 'new' ? 'Criar tenant da plataforma' : 'Atualizar tenant da plataforma'}
          onClose={() => setModal(null)}
          maxWidth="34rem"
        >
          <form onSubmit={handleSave} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Nome da empresa</label>
              <input style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ex: Brasil Ads" />
            </div>

            <div style={s.field}>
              <label style={s.label}>Slug</label>
              <input style={s.input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required placeholder="ex-brasil-ads" />
            </div>

            {modal === 'new' && (
              <div style={{ ...s.field, gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md, 12px)', background: 'var(--bg-base)' }}>
                <label style={s.label}>Acesso do administrador (primeiro login)</label>
                <input style={s.input} value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required placeholder="Nome do responsável" />
                <input style={s.input} type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required placeholder="email@empresa.com" />
                <input style={s.input} type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required placeholder="Senha (mín. 6 caracteres)" minLength={6} />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-dim)' }}>
                  A empresa acessa por <strong>/{form.slug || 'slug'}/login</strong> com esse e-mail e senha. Dá para adicionar mais logins depois no botão da chave.
                </span>
              </div>
            )}

            <div style={s.twoCols}>
              <div style={s.field}>
                <label style={s.label}>Plano SaaS</label>
                <select style={s.input} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
                  <option value="trial">Trial</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              <div style={s.field}>
                <label style={s.label}>Cor principal</label>
                <div style={s.colorRow}>
                  <input
                    type="color"
                    style={{ ...s.input, width: '48px', height: '42px', padding: 'var(--space-1)' }}
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  />
                  <input
                    style={{ ...s.input, flex: 1 }}
                    value={form.primaryColor}
                    onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                    placeholder="#HEX"
                  />
                </div>
              </div>
            </div>

            <div style={s.twoCols}>
              <div style={s.field}>
                <label style={s.label}>Max conexoes</label>
                <input type="number" style={s.input} value={form.maxConnections} onChange={(e) => setForm({ ...form, maxConnections: e.target.value })} />
              </div>
              <div style={s.field}>
                <label style={s.label}>Max usuarios</label>
                <input type="number" style={s.input} value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} />
              </div>
            </div>

            <div style={s.field}>
              <label style={s.label}>Logotipo (URL ou upload)</label>
              <div style={s.logoRow}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  value={form.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                  placeholder="https://..."
                />
                <label style={s.uploadBtn}>
                  <Upload size={14} />
                  {saving ? 'Enviando' : 'Importar'}
                  <input type="file" style={{ display: 'none' }} onChange={handleLogoUpload} accept="image/*" />
                </label>
              </div>
            </div>

            <div style={s.modalFooter}>
              <ActionButton variant="secondary" onClick={() => setModal(null)}>
                Cancelar
              </ActionButton>
              <ActionButton type="submit" disabled={saving}>
                {saving ? 'Processando...' : 'Salvar alteracoes'}
              </ActionButton>
            </div>
          </form>
        </ModalShell>
      ) : null}

      {usersModal ? (
        <LoginsModal tenant={usersModal} onClose={() => setUsersModal(null)} onChanged={load} />
      ) : null}
      {entitlementsModal ? (
        <EntitlementsModal
          tenant={entitlementsModal}
          catalog={featureCatalog}
          onClose={() => setEntitlementsModal(null)}
          onChanged={load}
        />
      ) : null}
      {plansModal ? <PlansModal catalog={featureCatalog} onClose={() => setPlansModal(false)} onChanged={load} /> : null}
      {supportModal ? <SupportUsersModal users={supportUsers} onClose={() => setSupportModal(false)} onChanged={load} /> : null}
    </div>
  );
}

function SupportUsersModal({ users, onClose, onChanged }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', supportLevel: 'support' });
  const [busy, setBusy] = useState(false);
  async function create(event) {
    event.preventDefault(); setBusy(true);
    try { await createSupportUser(form); toast.success('Usuário de suporte criado.'); setForm({ name: '', email: '', password: '', supportLevel: 'support' }); await onChanged?.(); }
    catch (error) { toast.error(error.response?.data?.error || 'Não foi possível criar o usuário.'); }
    finally { setBusy(false); }
  }
  async function toggle(user) {
    try { await updateSupportUser(user.id, { active: !user.active }); await onChanged?.(); }
    catch (error) { toast.error(error.response?.data?.error || 'Não foi possível atualizar o usuário.'); }
  }
  return <ModalShell kicker="Controle de acesso" title="Equipe de suporte" onClose={onClose} maxWidth="52rem">
    <div style={s.form}>
      <form onSubmit={create} style={s.formCard}>
        <div style={s.twoCols}><div style={s.field}><label style={s.label}>Nome</label><input required style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div style={s.field}><label style={s.label}>E-mail</label><input required type="email" style={s.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div></div>
        <div style={s.twoCols}><div style={s.field}><label style={s.label}>Senha inicial</label><input required minLength={6} type="password" style={s.input} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div><div style={s.field}><label style={s.label}>Nível</label><select style={s.input} value={form.supportLevel} onChange={(e) => setForm({ ...form, supportLevel: e.target.value })}><option value="support">Técnico de suporte</option><option value="manager">Gestor superadmin</option></select></div></div>
        <ActionButton type="submit" disabled={busy}>{busy ? 'Criando...' : 'Criar acesso'}</ActionButton>
      </form>
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>{users.map((user) => <div key={user.id} style={s.loginRow}><div><strong>{user.name}</strong><div style={s.companyMeta}>{user.email} · {user.supportLevel === 'manager' ? 'Gestor' : 'Suporte'} · último acesso {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pt-BR') : 'nunca'}</div></div><ActionButton variant="secondary" onClick={() => toggle(user)}>{user.active ? 'Desativar' : 'Ativar'}</ActionButton></div>)}</div>
      <div style={s.modalFooter}><ActionButton variant="secondary" onClick={onClose}>Fechar</ActionButton></div>
    </div>
  </ModalShell>;
}

function PlansModal({ catalog, onClose, onChanged }) {
  const [plans, setPlans] = useState(() => (catalog.plans || []).map((plan) => ({
    ...plan, monthlyPrice: Number(plan.monthlyPrice || 0),
    enabledKeys: new Set((plan.features || []).filter((item) => item.enabled !== false).map((item) => item.feature?.key || item.key || item.featureKey)),
  })));
  const [selectedId, setSelectedId] = useState(() => plans[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const selected = plans.find((plan) => plan.id === selectedId);
  const change = (field, value) => setPlans((current) => current.map((plan) => plan.id === selectedId ? { ...plan, [field]: value } : plan));
  const toggleFeature = (key) => {
    const next = new Set(selected.enabledKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    change('enabledKeys', next);
  };
  async function save() {
    if (!selected?.name?.trim()) return toast.error('Informe o nome do plano.');
    setBusy(true);
    try {
      const { data: saved } = await updateProductPlan({ code: selected.code, name: selected.name.trim(), description: selected.description || null, monthlyPrice: Number(selected.monthlyPrice || 0), position: selected.position, active: selected.active !== false, limits: selected.limits || {} });
      await updateProductPlanFeatures(saved.id || selected.id, (catalog.features || []).map((feature) => ({ featureId: feature.id, enabled: selected.enabledKeys.has(feature.key) })));
      toast.success(`Plano ${selected.name} atualizado.`);
      await onChanged?.();
    } catch (error) { toast.error(error.response?.data?.error || 'Não foi possível atualizar o plano.'); }
    finally { setBusy(false); }
  }
  return <ModalShell kicker="Configuração comercial" title="Planos e recursos padrão" onClose={onClose} maxWidth="58rem">
    <div style={s.form}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>{plans.map((plan) => <ActionButton key={plan.id} variant={plan.id === selectedId ? 'primary' : 'secondary'} onClick={() => setSelectedId(plan.id)}>{plan.name}</ActionButton>)}</div>
      {selected ? <>
        <div style={s.twoCols}>
          <div style={s.field}><label style={s.label}>Nome do plano</label><input style={s.input} value={selected.name} onChange={(e) => change('name', e.target.value)} /></div>
          <div style={s.field}><label style={s.label}>Valor mensal interno (R$)</label><input style={s.input} type="number" min="0" step="0.01" value={selected.monthlyPrice} onChange={(e) => change('monthlyPrice', e.target.value)} /></div>
        </div>
        <div style={s.field}><label style={s.label}>Descrição</label><input style={s.input} value={selected.description || ''} onChange={(e) => change('description', e.target.value)} /></div>
        <div style={s.entitlementGrid}>{(catalog.features || []).map((feature) => {
          const enabled = selected.enabledKeys.has(feature.key);
          return <button key={feature.id} type="button" onClick={() => toggleFeature(feature.key)} style={{ ...s.entitlementItem, ...(enabled ? s.entitlementEnabled : {}) }}><span style={{ textAlign: 'left' }}><strong>{feature.name}</strong><small style={s.entitlementDescription}>{feature.key}</small></span><span style={{ ...s.badge, ...(enabled ? s.badgeAccent : s.badgeMuted) }}>{enabled ? 'Incluído' : 'Não incluído'}</span></button>;
        })}</div>
        <div style={s.modalFooter}><ActionButton variant="secondary" onClick={onClose}>Fechar</ActionButton><ActionButton onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar plano'}</ActionButton></div>
      </> : <div style={s.empty}>Nenhum plano cadastrado.</div>}
    </div>
  </ModalShell>;
}

function EntitlementsModal({ tenant, catalog, onClose, onChanged }) {
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getTenantEntitlements(tenant.id)
      .then(({ data }) => {
        if (!active) return;
        const value = data?.entitlements || data || {};
        const overrides = value.featureOverrides || value.overrides || Object.fromEntries(
          (value.features || []).filter((feature) => feature.source === 'override').map((feature) => [feature.key, feature.enabled])
        );
        setModel({
          planKey: value.planKey || value.planCode || value.plan?.code || value.plan?.key || tenant.plan || 'starter',
          featureOverrides: Array.isArray(overrides)
            ? Object.fromEntries(overrides.filter((item) => item.enabled != null).map((item) => [item.featureKey || item.key, item.enabled]))
            : overrides,
          limits: { ...(value.limits || {}), maxUsers: tenant.maxUsers, maxConnections: tenant.maxConnections },
        });
      })
      .catch((error) => {
        toast.error(error.response?.data?.error || 'Não foi possível carregar os recursos da empresa.');
        onClose();
      });
    return () => { active = false; };
  }, [tenant.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const features = catalog.features || [];
  const plans = catalog.plans || [];
  const selectedPlan = plans.find((plan) => String(plan.code || plan.key || plan.id) === String(model?.planKey));
  const planFeatures = new Set((selectedPlan?.features || []).filter((item) => item.enabled !== false).map((item) => String(item.feature?.key || item.key || item.featureKey || item)));
  const effectiveEnabled = (key) => Object.prototype.hasOwnProperty.call(model?.featureOverrides || {}, key)
    ? Boolean(model.featureOverrides[key])
    : planFeatures.has(key);

  function cycleOverride(key) {
    setModel((current) => {
      const overrides = { ...current.featureOverrides };
      const inherited = planFeatures.has(key);
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) overrides[key] = !inherited;
      else if (overrides[key] === !inherited) delete overrides[key];
      else overrides[key] = !inherited;
      return { ...current, featureOverrides: overrides };
    });
  }

  async function save() {
    setBusy(true);
    try {
      if (model.planKey !== tenant.plan) await updateTenant(tenant.id, { plan: model.planKey });
      await updateTenantEntitlements(tenant.id, {
        overrides: features.map((feature) => ({
          featureId: feature.id,
          enabled: Object.prototype.hasOwnProperty.call(model.featureOverrides, feature.key)
            ? model.featureOverrides[feature.key]
            : null,
          reason: 'Configuração comercial pelo painel mestre',
        })).filter((item) => item.featureId),
      });
      const tenantLimits = {};
      if (model.limits?.maxUsers != null) tenantLimits.maxUsers = model.limits.maxUsers;
      if (model.limits?.maxConnections != null) tenantLimits.maxConnections = model.limits.maxConnections;
      if (Object.keys(tenantLimits).length) await updateTenant(tenant.id, tenantLimits);
      toast.success(`Plano e recursos de ${tenant.name} atualizados.`);
      onChanged?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Não foi possível salvar o pacote da empresa.');
    } finally { setBusy(false); }
  }

  return (
    <ModalShell kicker={`Pacote · ${tenant.name}`} title="Plano, adicionais e limites" onClose={onClose} maxWidth="48rem">
      {!model ? <div style={s.empty}>Carregando pacote contratado...</div> : (
        <div style={s.form}>
          <div style={s.field}>
            <label style={s.label}>Plano base</label>
            <select style={s.input} value={model.planKey} onChange={(event) => setModel({ ...model, planKey: event.target.value, featureOverrides: {} })}>
              {(plans.length ? plans : [{ code: 'starter', name: 'Essencial' }, { code: 'pro', name: 'Profissional' }, { code: 'enterprise', name: 'Enterprise' }]).map((plan) => (
                <option key={plan.code || plan.key || plan.id} value={plan.code || plan.key || plan.id}>{plan.name || plan.label || plan.code || plan.key}</option>
              ))}
            </select>
            <span style={s.companyMeta}>Trocar o plano restaura os recursos padrão; depois aplique exceções individuais abaixo.</span>
          </div>

          <div style={s.entitlementGrid}>
            {features.map((feature) => {
              const key = String(feature.key || feature.id);
              const overridden = Object.prototype.hasOwnProperty.call(model.featureOverrides, key);
              return (
                <button key={key} type="button" style={{ ...s.entitlementItem, ...(effectiveEnabled(key) ? s.entitlementEnabled : {}) }} onClick={() => cycleOverride(key)}>
                  <span style={{ textAlign: 'left' }}><strong>{feature.name || feature.label || key}</strong><small style={s.entitlementDescription}>{feature.description || key}</small></span>
                  <span style={{ ...s.badge, ...(overridden ? s.badgeAccent : s.badgeMuted) }}>{overridden ? (effectiveEnabled(key) ? 'Adicional' : 'Bloqueado') : 'Do plano'}</span>
                </button>
              );
            })}
          </div>

          <div style={s.twoCols}>
            {Object.entries(model.limits || {}).map(([key, value]) => (
              <div style={s.field} key={key}>
                <label style={s.label}>{key.replace(/([A-Z])/g, ' $1').replace(/^max /i, 'Máximo de ')}</label>
                <input style={s.input} type="number" min="0" value={value ?? ''} onChange={(event) => setModel({ ...model, limits: { ...model.limits, [key]: event.target.value === '' ? null : Number(event.target.value) } })} />
              </div>
            ))}
          </div>
          <div style={s.modalFooter}>
            <ActionButton variant="secondary" onClick={onClose}>Cancelar</ActionButton>
            <ActionButton onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Aplicar pacote'}</ActionButton>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function LoginsModal({ tenant, onClose, onChanged }) {
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'admin' });

  async function reload() {
    try {
      const { data } = await getTenantUsers(tenant.id);
      setUsers(data.users || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível carregar os logins.');
      setUsers([]);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [tenant.id]);

  async function addLogin(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) {
      toast.error('Preencha nome, e-mail e senha (mín. 6 caracteres).');
      return;
    }
    setBusy(true);
    try {
      await createTenantUser(tenant.id, form);
      toast.success(`Login criado. Acesso em /${tenant.slug}/login.`);
      setForm({ name: '', email: '', password: '', role: 'admin' });
      await reload();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível criar o login.');
    } finally { setBusy(false); }
  }

  async function resetPassword(user) {
    const next = window.prompt(`Nova senha para ${user.email} (mín. 6 caracteres):`);
    if (next == null) return;
    if (next.length < 6) { toast.error('A senha deve ter ao menos 6 caracteres.'); return; }
    setBusy(true);
    try {
      await updateTenantUser(tenant.id, user.id, { password: next });
      toast.success('Senha redefinida.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível redefinir a senha.');
    } finally { setBusy(false); }
  }

  async function toggleActive(user) {
    setBusy(true);
    try {
      await updateTenantUser(tenant.id, user.id, { active: !user.active });
      await reload();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível atualizar o login.');
    } finally { setBusy(false); }
  }

  return (
    <ModalShell kicker={`Logins · ${tenant.name}`} title={`Quem acessa /${tenant.slug}/login`} onClose={onClose} maxWidth="40rem">
      <div style={s.form}>
        {users == null ? (
          <p style={{ color: 'var(--text-dim)' }}>Carregando…</p>
        ) : users.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>Esta empresa ainda não tem nenhum login. Crie o primeiro abaixo.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {users.map((u) => (
              <div key={u.id} style={s.loginRow}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{u.name} <span style={s.roleTag}>{u.role}</span></div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-dim)' }}>{u.email}{u.active ? '' : ' · bloqueado'}</div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button style={s.iconBtn} title="Redefinir senha" disabled={busy} onClick={() => resetPassword(u)}><RotateCw size={15} /></button>
                  <button style={{ ...s.iconBtn, color: u.active ? 'var(--danger)' : 'var(--success)' }} title={u.active ? 'Bloquear login' : 'Reativar login'} disabled={busy} onClick={() => toggleActive(u)}><Power size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={addLogin} style={{ ...s.field, gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-color)' }}>
          <label style={s.label}>Adicionar login</label>
          <input style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome" required />
          <input style={s.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@empresa.com" required />
          <div style={s.twoCols}>
            <input style={s.input} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Senha (mín. 6)" minLength={6} required />
            <select style={s.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">Administrador</option>
              <option value="agent">Atendente</option>
            </select>
          </div>
          <div style={s.modalFooter}>
            <ActionButton variant="secondary" onClick={onClose}>Fechar</ActionButton>
            <ActionButton type="submit" disabled={busy}>{busy ? 'Processando...' : 'Criar login'}</ActionButton>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

const s = {
  container: { padding: 'var(--space-10)', flex: 1, overflowY: 'auto', background: 'var(--bg-base)', color: 'var(--text-main)' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' },
  statCard: { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' },
  statIcon: { color: 'var(--accent)' },
  statVal: { fontSize: 'var(--text-2xl)', fontWeight: 900, color: 'var(--text-main)' },
  statLabel: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 },
  tableCard: { padding: 0, overflow: 'hidden' },
  agentFleetHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)',
    padding: 'var(--space-4) var(--space-5)', borderBottom: '1px solid var(--border-color)',
  },
  agentFleetTitle: {
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--text-main)',
  },
  agentFleetMeta: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: 'var(--space-1)' },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left' },
  thead: { background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)' },
  th: { padding: 'var(--space-4) var(--space-5)', fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' },
  tr: { borderBottom: '1px solid var(--border-color)' },
  td: { padding: 'var(--space-4) var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-main)', verticalAlign: 'middle' },
  companyCell: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)' },
  companyInfo: { minWidth: 0 },
  logoThumb: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  logoImg: { width: '100%', height: '100%', objectFit: 'cover' },
  companyName: {
    fontWeight: 800,
    color: 'var(--text-main)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  companyMeta: { fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: 'var(--space-1)' },
  linkCell: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  code: {
    background: 'var(--bg-panel)',
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: '8px',
    fontSize: 'var(--text-xs)',
    color: 'var(--accent)',
    border: '1px solid var(--border-color)',
  },
  inlineIconBtn: {
    width: '34px',
    height: '34px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    color: 'var(--accent)',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  badge: { padding: 'var(--space-2) var(--space-3)', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 800, border: '1px solid transparent' },
  badgeAccent: {
    background: 'var(--accent-light)',
    color: 'var(--accent)',
    borderColor: 'var(--accent-border)',
  },
  badgeMuted: {
    background: 'var(--bg-panel)',
    color: 'var(--text-muted)',
    borderColor: 'var(--border-color)',
  },
  limitRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' },
  limitHint: { color: 'var(--text-dim)', fontSize: 'var(--text-xs)' },
  connectedTag: { background: 'var(--success-light)', color: 'var(--success)', fontSize: 'var(--text-xs)', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', marginLeft: 'var(--space-1)' },
  statusCell: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 700 },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' },
  iconBtn: {
    width: '36px',
    height: '36px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    borderRadius: '12px',
  },
  empty: { padding: 'var(--space-10) var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' },
  loginRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--border-color)', borderRadius: '12px', background: 'var(--bg-base)' },
  entitlementGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-2)' },
  entitlementItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)', background: 'var(--bg-base)', cursor: 'pointer' },
  entitlementEnabled: { borderColor: 'var(--accent-border)', background: 'var(--accent-light)', color: 'var(--text-main)' },
  entitlementDescription: { display: 'block', marginTop: '4px', color: 'var(--text-dim)', fontSize: 'var(--text-xs)', fontWeight: 500 },
  roleTag: { fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '1px 6px', marginLeft: '6px' },
  form: { padding: 'var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  label: { fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  input: {
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: '14px',
    padding: 'var(--space-4)',
    color: 'var(--text-main)',
    outline: 'none',
    fontSize: 'var(--text-md)',
    fontFamily: 'inherit',
  },
  twoCols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
  colorRow: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' },
  logoRow: { display: 'flex', gap: 'var(--space-2)', alignItems: 'stretch' },
  uploadBtn: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    borderRadius: '14px',
    padding: 'var(--space-3) var(--space-4)',
    color: 'var(--accent)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
  },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' },
};
