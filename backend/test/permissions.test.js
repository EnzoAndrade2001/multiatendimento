const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const {
  PERMISSIONS,
  PROFILE_PERMISSIONS,
  normalizePermissionList,
  resolveUserAccess,
  resolveHomePage,
} = require('../src/auth/permissions');
const requirePermission = require('../src/middlewares/requirePermission');
const authenticate = require('../src/middlewares/authenticate');
const requireTicketAccess = require('../src/middlewares/requireTicketAccess');
const prisma = require('../src/lib/prisma');
const { filterSettingsInput, filterSettingsOutput } = require('../src/auth/settingsAccess');
const filterSettingsAccess = require('../src/middlewares/filterSettingsAccess');
const requireSupportAccess = require('../src/middlewares/requireSupportAccess');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('catalogo nao possui chaves duplicadas e admin recebe acesso total', () => {
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  assert.deepEqual(resolveUserAccess({ role: 'admin', accessProfile: 'agent' }), {
    profile: 'admin',
    permissions: [...PERMISSIONS],
  });
  assert.deepEqual(PROFILE_PERMISSIONS.admin, PERMISSIONS);
});

test('perfil personalizado aceita somente chaves conhecidas e remove duplicatas', () => {
  const access = resolveUserAccess({
    role: 'agent',
    accessProfile: 'personalizado',
    permissions: ['crm.view', 'nao.existe', 'crm.view', 'billing.view'],
  });
  assert.deepEqual(access, {
    profile: 'personalizado',
    permissions: ['crm.view', 'billing.view'],
  });
  assert.deepEqual(normalizePermissionList('not-json'), []);
});

test('pagina inicial sempre pertence aos modulos liberados para o usuario', () => {
  const financial = resolveUserAccess({ role: 'agent', accessProfile: 'financeiro' });
  assert.equal(resolveHomePage('/billing-reports', financial), '/billing-reports');
  assert.equal(resolveHomePage('/users', financial), '/dashboard');
  assert.equal(resolveHomePage('/inbox', { permissions: [] }), '/settings');
});

test('requirePermission aceita qualquer chave solicitada e nega sem permissao', () => {
  let called = false;
  requirePermission('billing.view', 'billing.reprocess')(
    { user: { role: 'agent', permissions: ['billing.view'] } },
    responseRecorder(),
    () => { called = true; },
  );
  assert.equal(called, true);

  const res = responseRecorder();
  requirePermission('users.manage')(
    { user: { role: 'agent', permissions: ['crm.view'] } },
    res,
    () => assert.fail('nao deveria autorizar'),
  );
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body.requiredPermissions, ['users.manage']);
});

test('configuracoes sao filtradas por campo, inclusive segredos', () => {
  const attendanceUser = { role: 'agent', permissions: ['settings.attendance.manage'] };
  assert.deepEqual(filterSettingsInput(attendanceUser, {
    outOfOfficeMessage: 'fora do horario',
    companyName: 'nao pode alterar',
    evolutionKey: 'nao pode alterar',
  }), { outOfOfficeMessage: 'fora do horario' });
  assert.deepEqual(filterSettingsOutput(attendanceUser, {
    tenantId: 'tenant',
    outOfOfficeMessage: 'fora do horario',
    evolutionKey: 'segredo',
  }), { tenantId: 'tenant', outOfOfficeMessage: 'fora do horario' });
});

test('configuracoes tecnicas ficam restritas ao superadmin de suporte', () => {
  const admin = { role: 'admin', permissions: ['settings.bot.manage', 'settings.agent.manage', 'connections.manage', 'revenue.view'] };
  assert.deepEqual(filterSettingsInput(admin, {
    botEnabled: true,
    evolutionKey: 'secret',
    firebirdApiKey: 'secret',
    kpiContractValue: 100,
  }), { botEnabled: true });
  assert.deepEqual(filterSettingsOutput(admin, {
    tenantId: 'tenant', botEnabled: true, evolutionKey: 'secret', firebirdApiKey: 'secret',
  }), { tenantId: 'tenant', botEnabled: true });

  const support = { role: 'superadmin', permissions: [] };
  assert.deepEqual(filterSettingsInput(support, { evolutionKey: 'new-secret' }), { evolutionKey: 'new-secret' });
  assert.deepEqual(filterSettingsOutput(support, { evolutionKey: 'stored-secret' }), { evolutionKey: '********' });
});

test('tentativa direta de gravar campo tecnico retorna 403', () => {
  const req = { user: { role: 'admin', permissions: ['settings.bot.manage'] }, body: { botEnabled: true, geminiKey: 'secret' } };
  const res = responseRecorder();
  filterSettingsAccess(req, res, () => assert.fail('nao deveria autorizar'));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body.fields, ['geminiKey']);

  let called = false;
  requireSupportAccess({ user: { role: 'superadmin', supportMode: true } }, responseRecorder(), () => { called = true; });
  assert.equal(called, true);
});

test('acesso direto ao ticket respeita responsavel e equipe', { concurrency: false }, async () => {
  const previousTicketFind = prisma.ticket.findFirst;
  const previousTeamFind = prisma.teamMember.findFirst;
  prisma.ticket.findFirst = async () => ({ id: 'ticket', agentId: 'outro', teamId: 'equipe' });
  prisma.teamMember.findFirst = async ({ where }) => (
    where.userId === 'membro' && where.teamId === 'equipe' ? { id: 'membership' } : null
  );
  try {
    const allowedReq = {
      params: { id: 'ticket' },
      user: { userId: 'membro', tenantId: 'tenant', role: 'agent', permissions: ['inbox.view'] },
    };
    let called = false;
    await requireTicketAccess(allowedReq, responseRecorder(), () => { called = true; });
    assert.equal(called, true);

    const deniedReq = {
      params: { id: 'ticket' },
      user: { userId: 'estranho', tenantId: 'tenant', role: 'agent', permissions: ['inbox.view'] },
    };
    const deniedRes = responseRecorder();
    await requireTicketAccess(deniedReq, deniedRes, () => assert.fail('nao deveria acessar ticket de outra equipe'));
    assert.equal(deniedRes.statusCode, 403);
  } finally {
    prisma.ticket.findFirst = previousTicketFind;
    prisma.teamMember.findFirst = previousTeamFind;
  }
});

test('authenticate recarrega perfil atual do banco e ignora role/tenant antigos do JWT', { concurrency: false }, async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousFindUnique = prisma.user.findUnique;
  process.env.JWT_SECRET = 'permission-test-secret';
  prisma.user.findUnique = async () => ({
    id: 'user-current', tenantId: 'tenant-current', role: 'agent', active: true,
    accessProfile: 'financeiro', permissions: null, tenant: { active: true },
  });

  try {
    const token = jwt.sign(
      { userId: 'user-current', tenantId: 'tenant-old', role: 'admin' },
      process.env.JWT_SECRET,
    );
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = responseRecorder();
    let called = false;
    await authenticate(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.user.tenantId, 'tenant-current');
    assert.equal(req.user.role, 'agent');
    assert.equal(req.user.accessProfile, 'financeiro');
    assert.equal(req.user.permissions.includes('billing.reprocess'), true);
    assert.equal(req.user.permissions.includes('users.manage'), false);
  } finally {
    prisma.user.findUnique = previousFindUnique;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('authenticate bloqueia imediatamente usuario desativado', { concurrency: false }, async () => {
  const previousSecret = process.env.JWT_SECRET;
  const previousFindUnique = prisma.user.findUnique;
  process.env.JWT_SECRET = 'permission-test-secret';
  prisma.user.findUnique = async () => ({
    id: 'disabled', tenantId: 'tenant', role: 'agent', active: false,
    accessProfile: 'agent', permissions: null, tenant: { active: true },
  });

  try {
    const token = jwt.sign({ userId: 'disabled' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = responseRecorder();
    await authenticate(req, res, () => assert.fail('usuario inativo nao pode prosseguir'));
    assert.equal(res.statusCode, 401);
  } finally {
    prisma.user.findUnique = previousFindUnique;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
