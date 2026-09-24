import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Pencil, Plus, Search, Shield, Trash2, UserRound, UserX, X } from 'lucide-react';
import { toast } from '../utils/toast';
import api, { getUsers, createUser, updateUser, deleteUser, getTeams, uploadUserAvatar, removeUserAvatar } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import ActionButton from '../components/ui/ActionButton';
import { ACCESS_PROFILES, PERMISSION_GROUPS, PERMISSION_LABELS } from '../auth/permissions';
import UserAvatar from '../components/ui/UserAvatar';

const EMPTY_FORM = { name: '', email: '', password: '', phone: '', role: 'agent', active: true, firebirdSupportName: '', accessProfile: 'agent', permissions: ACCESS_PROFILES.agent.permissions, homePage: '/inbox' };
const HOME_PAGES = [
  { value: '/dashboard', label: 'Dashboard', permission: 'dashboard.view' },
  { value: '/inbox', label: 'Atendimento', permission: 'inbox.view' },
  { value: '/crm', label: 'CRM', permission: 'crm.view' },
  { value: '/billing-reports', label: 'Relatórios de cobrança', permission: 'billing.view' },
  { value: '/settings', label: 'Minha conta', permission: null },
];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [, setTeams] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [{ data: uData }, { data: tData }, { data: techsData }] = await Promise.all([
        getUsers(), 
        getTeams(),
        api.get('/os/technicians').catch(() => ({ data: [] }))
      ]);
      setUsers(uData);
      setTeams(tData);
      setTechnicians(techsData);
    } catch (err) {
      toast.error('Não foi possível carregar os usuários. Recarregue a página.');
    } finally {
      setLoading(false);
    }
  }

  function openModal(user = null) {
    if (user) {
      setModal(user);
      const accessProfile = user.accessProfile || (user.role === 'admin' ? 'admin' : 'agent');
      setForm({ name: user.name, email: user.email, password: '', phone: user.phone || '', avatarUrl: user.avatarUrl || '', role: user.role, active: user.active, firebirdSupportName: user.firebirdSupportName || '', accessProfile, permissions: Array.isArray(user.permissions) ? user.permissions : ACCESS_PROFILES[accessProfile]?.permissions || [], homePage: user.homePage || ACCESS_PROFILES[accessProfile]?.homePage || '/inbox' });
      return;
    }

    setModal('new');
    setForm({ ...EMPTY_FORM, permissions: [...EMPTY_FORM.permissions] });
  }

  function selectProfile(accessProfile) {
    const selected = ACCESS_PROFILES[accessProfile] || ACCESS_PROFILES.agent;
    setForm((current) => ({
      ...current,
      accessProfile,
      role: accessProfile === 'admin' ? 'admin' : 'agent',
      permissions: [...selected.permissions],
      homePage: selected.homePage,
    }));
  }

  function togglePermission(permission) {
    setForm((current) => {
      const permissions = current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission];
      const allowedHomePages = HOME_PAGES.filter((page) => !page.permission || permissions.includes(page.permission));
      return {
        ...current,
        accessProfile: 'personalizado',
        role: 'agent',
        permissions,
        homePage: allowedHomePages.some((page) => page.value === current.homePage)
          ? current.homePage
          : (allowedHomePages[0]?.value || ''),
      };
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal === 'new') {
        await createUser(form);
      } else {
        await updateUser(modal.id, form);
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível salvar o usuário. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(user) {
    if (pendingId) return;
    setPendingId(user.id);
    try {
      await updateUser(user.id, { active: !user.active });
      load();
    } catch {
      toast.error('Não foi possível atualizar o status do usuário.');
    } finally {
      setPendingId(null);
    }
  }

  async function handleUserAvatarUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || modal === 'new') {
      if (file && modal === 'new') toast.info('Salve o usuário antes de adicionar uma foto.');
      return;
    }
    setAvatarUploading(true);
    try {
      const { data } = await uploadUserAvatar(modal.id, file);
      setForm((current) => ({ ...current, avatarUrl: data.avatarUrl || '' }));
      setUsers((current) => current.map((user) => user.id === modal.id ? { ...user, avatarUrl: data.avatarUrl || '' } : user));
      setModal((current) => (current && current !== 'new' ? { ...current, avatarUrl: data.avatarUrl || '' } : current));
      toast.success('Foto do usuário atualizada.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível atualizar a foto do usuário.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleUserAvatarRemove() {
    if (avatarUploading || modal === 'new') return;
    setAvatarUploading(true);
    try {
      const { data } = await removeUserAvatar(modal.id);
      setForm((current) => ({ ...current, avatarUrl: '' }));
      setUsers((current) => current.map((user) => user.id === modal.id ? { ...user, avatarUrl: '' } : user));
      setModal((current) => (current && current !== 'new' ? { ...current, avatarUrl: '' } : current));
      toast.success('Foto do usuário removida.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Não foi possível remover a foto do usuário.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleDelete(user) {
    toast.confirm(
      `Excluir o usuário ${user.name}? Essa ação remove o acesso dele e desvincula atendimentos anteriores.`,
      async () => {
        if (pendingId) return;
        setPendingId(user.id);
        try {
          await deleteUser(user.id);
          toast.success('Usuário excluído com sucesso');
          load();
        } catch (err) {
          toast.error(err.response?.data?.error || 'Não foi possível excluir o usuário.');
        } finally {
          setPendingId(null);
        }
      }
    );
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? user.active : !user.active);
      return matchesSearch && matchesStatus;
    });
  }, [users, search, statusFilter]);

  return (
    <div style={s.container}>
      <PageHeader
        kicker="Administração"
        title="Gestão de usuários"
        subtitle="Controle acessos, funções e disponibilidade da equipe."
        actions={<ActionButton onClick={() => openModal()}><Plus size={16} /> Adicionar usuário</ActionButton>}
        compact
      />

      <section style={s.filterBar}>
        <div style={s.searchWrap}>
          <Search size={16} style={s.searchIcon} />
          <input
            style={s.searchInput}
            placeholder="Pesquisar por nome ou e-mail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Todos os status</option>
          <option value="active">Apenas ativos</option>
          <option value="inactive">Arquivados</option>
        </select>
      </section>

      <div style={s.tableCard}>
        {loading ? (
          <div style={s.empty}>Carregando usuários...</div>
        ) : filtered.length === 0 ? (
          <div style={s.empty}>
            {users.length === 0
              ? 'Nenhum usuário cadastrado ainda. Clique em "Adicionar usuário" para criar o primeiro acesso.'
              : 'Nenhum usuário encontrado para esse filtro. Ajuste a busca ou o status selecionado.'}
          </div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>Nome</th>
                <th style={s.th}>E-mail</th>
                <th style={s.th}>Cargo</th>
                <th style={s.th}>Status</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const isAdmin = user.role === 'admin';
                const profile = user.accessProfile || (isAdmin ? 'admin' : 'agent');
                return (
                  <tr key={user.id} style={s.tr}>
                    <td style={s.td}>
                      <div style={s.nameCell}>
                        <UserAvatar user={user} size={34} style={s.avatar} />
                        <div style={s.nameInfo}>
                          <div style={s.nameText} title={user.name}>{user.name}</div>
                          <div style={s.metaText}>{user.active ? 'Disponível' : 'Arquivado'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={s.td}>
                      <span style={s.emailText} title={user.email}>{user.email}</span>
                    </td>
                    <td style={s.td}>
                      <span
                        style={{
                          ...s.roleBadge,
                          ...(isAdmin ? s.roleBadgeAdmin : s.roleBadgeAgent),
                        }}
                      >
                        {isAdmin ? <Shield size={14} /> : <UserRound size={14} />}
                        {ACCESS_PROFILES[profile]?.label || (isAdmin ? 'Administrador' : 'Atendente')}
                      </span>
                    </td>
                    <td style={s.td}>
                      <div style={s.statusCell}>
                        <span style={{ ...s.statusDot, ...(user.active ? s.statusActive : s.statusInactive) }} />
                        <span style={user.active ? s.statusTextActive : s.statusTextInactive}>
                          {user.active ? 'Ativo' : 'Arquivado'}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <div style={s.actionGroup}>
                        <button style={s.actionBtn} onClick={() => openModal(user)} title="Editar">
                          <Pencil size={16} />
                        </button>
                        <button
                          style={{ ...s.actionBtn, ...(user.active ? s.actionWarn : s.actionSuccess) }}
                          onClick={() => handleToggleStatus(user)}
                          disabled={pendingId === user.id}
                          title={user.active ? 'Arquivar' : 'Reativar'}
                        >
                          {user.active ? <UserX size={16} /> : <BadgeCheck size={16} />}
                        </button>
                        <button
                          style={{ ...s.actionBtn, ...s.actionDanger }}
                          onClick={() => handleDelete(user)}
                          disabled={pendingId === user.id}
                          title="Excluir usuário"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <div>
                <p style={s.modalKicker}>{modal === 'new' ? 'Novo cadastro' : 'Editar acesso'}</p>
                <h3 style={s.modalTitle}>{modal === 'new' ? 'Adicionar usuário' : 'Atualizar usuário'}</h3>
              </div>
              <button style={s.closeBtn} onClick={() => setModal(null)} aria-label="Fechar">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSave} style={s.form}>
              <div style={s.profilePhotoCard}>
                <UserAvatar user={form} name={form.name} size={60} style={s.profilePhoto} />
                <div style={s.profilePhotoInfo}>
                  <strong>Foto do perfil</strong>
                  <span style={s.metaText}>JPG, PNG ou WebP, até 2 MB.</span>
                  <div style={s.profilePhotoActions}>
                    <label htmlFor="managed-user-avatar-upload" style={{ ...s.actionBtn, width: 'auto', cursor: avatarUploading || modal === 'new' ? 'not-allowed' : 'pointer', opacity: avatarUploading || modal === 'new' ? 0.65 : 1 }}>
                      {avatarUploading ? 'Enviando...' : 'Escolher foto'}
                    </label>
                    <input id="managed-user-avatar-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUserAvatarUpload} disabled={avatarUploading || modal === 'new'} style={{ display: 'none' }} />
                    {form.avatarUrl ? <button type="button" style={{ ...s.actionBtn, ...s.actionDanger, width: 'auto' }} onClick={handleUserAvatarRemove} disabled={avatarUploading}>Remover</button> : null}
                  </div>
                </div>
              </div>

              <div style={s.formGrid}>
                <div style={s.field}>
                  <label style={s.label}>Nome completo</label>
                  <input
                    style={s.input}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="Ex: Joao Silva"
                  />
                </div>

                <div style={s.field}>
                  <label style={s.label}>E-mail de acesso</label>
                  <input
                    style={s.input}
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    placeholder="email@empresa.com"
                  />
                </div>

                <div style={s.field}>
                  <label style={s.label}>WhatsApp do técnico (opcional)</label>
                  <input
                    style={s.input}
                    type="tel"
                    inputMode="tel"
                    value={form.phone || ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="Ex: 5551999999999"
                  />
                  <span style={s.fieldHint}>Usado somente para reconhecer este usuário como técnico autorizado no Assistente Técnico. Informe DDI + DDD + número.</span>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Senha {modal !== 'new' && '(deixe em branco para manter)'}</label>
                  <input
                    style={s.input}
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={modal === 'new'}
                    placeholder="********"
                  />
                </div>

                <div style={s.field}>
                  <label style={s.label}>Perfil de acesso</label>
                  <select style={s.input} value={form.accessProfile} onChange={(e) => selectProfile(e.target.value)}>
                    {Object.entries(ACCESS_PROFILES).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
                  </select>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Página inicial após o login</label>
                  <select style={s.input} value={form.homePage} onChange={(e) => setForm({ ...form, homePage: e.target.value })}>
                    {HOME_PAGES.filter((page) => !page.permission || form.permissions.includes(page.permission)).map((page) => <option key={page.value} value={page.value}>{page.label}</option>)}
                  </select>
                </div>

                <div style={s.field}>
                  <label style={s.label}>Atendente ILUX WEB (Nome Exato)</label>
                  <select style={s.input} value={form.firebirdSupportName} onChange={(e) => setForm({ ...form, firebirdSupportName: e.target.value })}>
                    <option value="">Nenhum / Mesmo do sistema</option>
                    {technicians.map(t => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <section style={s.permissionSection}>
                <div style={s.permissionHeader}>
                  <div><strong>Permissões deste usuário</strong><p>Escolha um perfil pronto ou ajuste ações individualmente.</p></div>
                  <span style={s.permissionCount}>{form.permissions.length} permissões</span>
                </div>
                <div style={s.permissionGrid}>
                  {PERMISSION_GROUPS.map((group) => (
                    <fieldset key={group.label} style={s.permissionGroup} disabled={form.accessProfile === 'admin'}>
                      <legend style={s.permissionLegend}>{group.label}</legend>
                      {group.keys.map((permission) => (
                        <label key={permission} style={s.permissionItem}>
                          <input type="checkbox" checked={form.permissions.includes(permission)} onChange={() => togglePermission(permission)} />
                          <span>{PERMISSION_LABELS[permission]}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
              </section>

              <div style={s.modalFooter}>
                <button type="button" style={s.cancelBtn} onClick={() => setModal(null)}>
                  Cancelar
                </button>
                <button type="submit" style={s.saveBtn} disabled={saving}>
                  {saving ? 'Processando...' : modal === 'new' ? 'Criar usuário' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  container: {
    padding: 'var(--space-10)',
    flex: 1,
    overflowY: 'auto',
    background: 'var(--bg-base)',
    color: 'var(--text-main)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1.5rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
  },
  kicker: {
    margin: '0 0 0.4rem',
    color: 'var(--accent)',
    fontSize: '0.78rem',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: '1.9rem',
    fontWeight: 800,
    color: 'var(--text-main)',
    margin: '0 0 0.55rem',
    letterSpacing: '-0.03em',
    fontFamily: 'var(--font-display)',
  },
  subtitle: {
    margin: 0,
    fontSize: '0.95rem',
    color: 'var(--text-muted)',
    maxWidth: '40rem',
    lineHeight: 1.6,
  },
  addBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.55rem',
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    border: '1px solid var(--accent)',
    padding: '0.85rem 1.2rem',
    borderRadius: '14px',
    cursor: 'pointer',
    fontWeight: 800,
    fontSize: '0.92rem',
  },
  filterBar: {
    display: 'flex',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-6)',
    flexWrap: 'wrap',
  },
  searchWrap: {
    position: 'relative',
    flex: '1 1 18rem',
  },
  searchIcon: {
    position: 'absolute',
    left: 'var(--space-4)',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-dim)',
  },
  searchInput: {
    width: '100%',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4) var(--space-3) var(--space-10)',
    color: 'var(--text-main)',
    outline: 'none',
    fontSize: 'var(--text-md)',
  },
  select: {
    minWidth: '13rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4)',
    color: 'var(--text-main)',
    outline: 'none',
    cursor: 'pointer',
    fontSize: 'var(--text-md)',
  },
  tableCard: {
    background: 'var(--bg-surface)',
    borderRadius: '20px',
    border: '1px solid var(--border-color)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
  },
  thead: {
    background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border-color)',
  },
  th: {
    padding: '1.15rem 1.4rem',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  tr: {
    borderBottom: '1px solid var(--border-color)',
  },
  td: {
    padding: '1.2rem 1.4rem',
    fontSize: 'var(--text-md)',
    color: 'var(--text-main)',
    verticalAlign: 'middle',
  },
  nameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.9rem',
    minWidth: 0,
  },
  nameInfo: {
    minWidth: 0,
    maxWidth: '14rem',
  },
  profilePhotoCard: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.9rem 1rem', borderRadius: '14px', background: 'var(--bg-base)', border: '1px solid var(--border-color)' },
  profilePhoto: { background: 'var(--accent)', color: 'var(--text-inverse)', borderRadius: '50%' },
  profilePhotoInfo: { minWidth: 0, display: 'grid', gap: '.3rem' },
  profilePhotoActions: { display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.2rem' },
  avatar: {
    width: '38px',
    height: '38px',
    borderRadius: '12px',
    background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '0.95rem',
    flexShrink: 0,
  },
  nameText: {
    fontWeight: 700,
    color: 'var(--text-main)',
    marginBottom: '0.2rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaText: {
    fontSize: '0.8rem',
    color: 'var(--text-dim)',
  },
  emailText: {
    display: 'block',
    maxWidth: '16rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  roleBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    padding: '0.42rem 0.8rem',
    borderRadius: '999px',
    fontSize: '0.78rem',
    fontWeight: 700,
    border: '1px solid transparent',
  },
  roleBadgeAdmin: {
    background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    color: 'var(--accent)',
    borderColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  roleBadgeAgent: {
    background: 'var(--bg-panel)',
    color: 'var(--text-muted)',
    borderColor: 'var(--border-color)',
  },
  statusCell: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.55rem',
    fontSize: '0.86rem',
    fontWeight: 700,
  },
  statusDot: {
    width: '9px',
    height: '9px',
    borderRadius: '50%',
  },
  statusActive: {
    background: '#2fb171',
    boxShadow: '0 0 10px rgba(47, 177, 113, 0.45)',
  },
  statusInactive: {
    background: 'var(--text-dim)',
  },
  statusTextActive: {
    color: 'var(--text-main)',
  },
  statusTextInactive: {
    color: 'var(--text-muted)',
  },
  actionGroup: {
    display: 'flex',
    gap: '0.55rem',
    justifyContent: 'flex-end',
  },
  actionBtn: {
    width: '38px',
    height: '38px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    borderRadius: '12px',
  },
  actionWarn: {
    color: '#d16f55',
  },
  actionSuccess: {
    color: '#2fb171',
  },
  actionDanger: {
    color: '#d85f5f',
    background: 'color-mix(in srgb, #d85f5f 10%, var(--bg-panel))',
  },
  empty: {
    padding: '4rem 1.5rem',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '0.95rem',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1.5rem',
    backdropFilter: 'blur(6px)',
  },
  modal: {
    background: 'var(--bg-surface)',
    borderRadius: '24px',
    width: '100%',
    maxWidth: '64rem',
    maxHeight: '92vh',
    overflowY: 'auto',
    border: '1px solid var(--border-color)',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.28)',
  },
  modalHeader: {
    padding: '1.5rem 1.8rem',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
  },
  modalKicker: {
    margin: '0 0 0.35rem',
    color: 'var(--accent)',
    fontSize: '0.74rem',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  modalTitle: {
    margin: 0,
    fontSize: '1.2rem',
    fontWeight: 800,
    color: 'var(--text-main)',
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-dim)',
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    cursor: 'pointer',
  },
  form: {
    padding: '1.8rem',
    display: 'grid',
    gap: '1.5rem',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.2rem',
  },
  permissionSection: { border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1rem', background: 'var(--bg-base)' },
  permissionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', color: 'var(--text-main)' },
  permissionCount: { color: 'var(--accent)', background: 'var(--accent-light)', border: '1px solid var(--accent-border)', borderRadius: 999, padding: '.35rem .65rem', fontSize: '.75rem', fontWeight: 800, whiteSpace: 'nowrap' },
  permissionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '.8rem' },
  permissionGroup: { display: 'grid', alignContent: 'start', gap: '.45rem', border: '1px solid var(--border-color)', borderRadius: 12, padding: '.75rem', margin: 0, minWidth: 0 },
  permissionLegend: { color: 'var(--text-main)', fontSize: '.78rem', fontWeight: 800, padding: '0 .35rem' },
  permissionItem: { display: 'flex', alignItems: 'flex-start', gap: '.55rem', color: 'var(--text-muted)', fontSize: '.78rem', lineHeight: 1.35, cursor: 'pointer' },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
  },
  label: {
    fontSize: '0.78rem',
    fontWeight: 800,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  fieldHint: {
    color: 'var(--text-dim)',
    fontSize: '0.72rem',
    lineHeight: 1.45,
  },
  input: {
    background: 'var(--bg-base)',
    border: '1px solid var(--border-color)',
    borderRadius: '14px',
    padding: '0.9rem 1rem',
    color: 'var(--text-main)',
    fontSize: '0.95rem',
    outline: 'none',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.85rem',
    marginTop: '1.8rem',
  },
  cancelBtn: {
    padding: '0.9rem 1.3rem',
    borderRadius: '14px',
    border: '1px solid var(--border-color)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontWeight: 700,
  },
  saveBtn: {
    padding: '0.9rem 1.3rem',
    borderRadius: '14px',
    border: '1px solid var(--accent)',
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    cursor: 'pointer',
    fontWeight: 800,
  },
};
