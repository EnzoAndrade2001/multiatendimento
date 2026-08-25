const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const controller = require('../src/controllers/internalMessageController');
const router = require('../src/routes/internalMessages');
const fs = require('fs');
const path = require('path');
const { mediaPath } = require('../src/utils/uploads');

function responseRecorder() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function req(body = {}) {
  return { body, params: {}, query: {}, user: { tenantId: 'tenant-a', userId: 'sender', role: 'agent', permissions: ['internal_chat.view'] } };
}

test('chaves de conversa aceitam apenas direct ou team com id simples', () => {
  assert.deepEqual(controller.parseConversationKey('direct:user-1'), { kind: 'direct', id: 'user-1', key: 'direct:user-1' });
  assert.deepEqual(controller.parseConversationKey('team:team-1'), { kind: 'team', id: 'team-1', key: 'team:team-1' });
  assert.equal(controller.parseConversationKey('direct:user:extra'), null);
  assert.equal(controller.parseConversationKey('public:any'), null);
});

test('rotas v2 e fallback legado permanecem publicados', () => {
  const routes = router.stack.filter((layer) => layer.route).map((layer) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods).sort(),
  }));
  for (const expected of [
    '/conversations', '/conversations/:key/messages', '/conversations/:key/read',
    '/conversations/:key/pin', '/messages', '/messages/:id/thread',
    '/messages/attachment',
    '/messages/:id/reactions', '/messages/:id/reactions/:emoji', '/',
  ]) assert.equal(routes.some((route) => route.path === expected), true, `rota ausente: ${expected}`);
});

test('conversa direta consulta destinatario ativo dentro do tenant', { concurrency: false }, async () => {
  const original = prisma.user.findFirst;
  let receivedWhere;
  prisma.user.findFirst = async ({ where }) => { receivedWhere = where; return { id: 'peer', name: 'Peer', role: 'agent' }; };
  try {
    const conversation = await controller.resolveConversation(req(), 'direct:peer');
    assert.equal(conversation.key, 'direct:peer');
    assert.deepEqual(receivedWhere, { id: 'peer', tenantId: 'tenant-a', active: true });
    assert.equal(await controller.resolveConversation(req(), 'direct:sender'), null);
  } finally { prisma.user.findFirst = original; }
});

test('membro acessa canal da equipe e estranho recebe negacao', { concurrency: false }, async () => {
  const original = prisma.team.findFirst;
  prisma.team.findFirst = async ({ where }) => ({ id: where.id, name: 'Suporte', members: [{ userId: 'sender' }] });
  try {
    assert.equal((await controller.resolveConversation(req(), 'team:support')).kind, 'team');
    const stranger = req(); stranger.user.userId = 'stranger';
    assert.equal(await controller.resolveConversation(stranger, 'team:support'), null);
  } finally { prisma.team.findFirst = original; }
});

test('envio direto incrementa unread na chave vista pelo destinatario', { concurrency: false }, async () => {
  const originals = {
    userFind: prisma.user.findFirst,
    messageCreate: prisma.internalMessage.create,
    stateUpsert: prisma.internalConversationState.upsert,
  };
  const states = [];
  prisma.user.findFirst = async () => ({ id: 'receiver', name: 'Receiver', role: 'agent' });
  prisma.internalMessage.create = async ({ data }) => ({ id: 'message', createdAt: new Date(), ...data, reactions: [], reads: [] });
  prisma.internalConversationState.upsert = async (operation) => { states.push(operation); return operation.create; };
  try {
    const response = responseRecorder();
    await controller.sendMessage(req({ receiverId: 'receiver', body: 'Olá' }), response);
    assert.equal(response.statusCode, 201);
    assert.equal(states.length, 1);
    assert.equal(states[0].create.conversationKey, 'direct:sender');
    assert.equal(states[0].create.userId, 'receiver');
  } finally {
    prisma.user.findFirst = originals.userFind;
    prisma.internalMessage.create = originals.messageCreate;
    prisma.internalConversationState.upsert = originals.stateUpsert;
  }
});

test('envio exige exatamente um alvo e tipo conhecido', async () => {
  const both = responseRecorder();
  await controller.sendMessage(req({ receiverId: 'one', teamId: 'two', body: 'x' }), both);
  assert.equal(both.statusCode, 400);
  const invalidType = responseRecorder();
  await controller.sendMessage(req({ receiverId: 'one', body: 'x', type: 'arquivo' }), invalidType);
  assert.equal(invalidType.statusCode, 400);
});

test('anexo interno fica vinculado à mensagem com nome original seguro', { concurrency: false }, async () => {
  const originals = {
    userFind: prisma.user.findFirst,
    messageCreate: prisma.internalMessage.create,
    stateUpsert: prisma.internalConversationState.upsert,
    auditCreate: prisma.privacyAuditLog.create,
  };
  let storedData;
  prisma.user.findFirst = async () => ({ id: 'receiver', name: 'Receiver', role: 'agent' });
  prisma.internalMessage.create = async ({ data }) => {
    storedData = data;
    return { id: 'attachment-message', createdAt: new Date(), ...data, reactions: [], reads: [] };
  };
  prisma.internalConversationState.upsert = async (operation) => operation.create;
  prisma.privacyAuditLog.create = async ({ data }) => ({ id: 'audit', ...data });
  const request = req({ receiverId: 'receiver', body: '' });
  request.file = {
    originalname: '../relatorio.pdf', mimetype: 'application/pdf',
    size: 14, buffer: Buffer.from('%PDF-1.4\n%%EOF'),
  };
  try {
    const response = responseRecorder();
    await controller.sendMessage(request, response);
    assert.equal(response.statusCode, 201);
    assert.equal(storedData.attachmentName, 'relatorio.pdf');
    assert.equal(storedData.attachmentMimeType, 'application/pdf');
    assert.match(storedData.attachmentUrl, /^\/uploads\/media\/internal-.+\.pdf$/);
  } finally {
    if (storedData?.attachmentUrl) fs.rmSync(path.join(mediaPath, path.basename(storedData.attachmentUrl)), { force: true });
    prisma.user.findFirst = originals.userFind;
    prisma.internalMessage.create = originals.messageCreate;
    prisma.internalConversationState.upsert = originals.stateUpsert;
    prisma.privacyAuditLog.create = originals.auditCreate;
  }
});
