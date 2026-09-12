const test = require('node:test');
const assert = require('node:assert/strict');

const verifyWebhookSecret = require('../src/middlewares/verifyWebhookSecret');
const { repairInvalidEvolutionSettings } = require('../src/services/startupEvolutionSettingsService');
const { SECRET_PLACEHOLDER, filterSettingsInput, filterSettingsOutput } = require('../src/auth/settingsAccess');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function requestWithHeaders(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { header: (name) => normalized[name.toLowerCase()] };
}

test('settings mascara secrets autorizados e nao os entrega ao navegador', () => {
  const user = { role: 'superadmin', permissions: ['connections.manage', 'settings.bot.manage', 'settings.agent.manage', 'leads.manage'] };
  assert.deepEqual(filterSettingsOutput(user, {
    evolutionKey: 'evolution-secret', geminiKey: 'gemini-secret', serpApiKey: 'serp-secret',
    firebirdApiKey: 'firebird-secret', firebirdClientToken: 'sync-secret',
  }), {
    evolutionKey: SECRET_PLACEHOLDER, geminiKey: SECRET_PLACEHOLDER, serpApiKey: SECRET_PLACEHOLDER,
    firebirdApiKey: SECRET_PLACEHOLDER, firebirdClientToken: SECRET_PLACEHOLDER,
  });
});

test('settings ignora secrets vazios ou mascarados para preservar valores atuais', () => {
  const user = { role: 'superadmin', permissions: ['connections.manage', 'settings.bot.manage', 'settings.agent.manage', 'leads.manage'] };
  assert.deepEqual(filterSettingsInput(user, {
    evolutionUrl: 'https://evolution.example', evolutionKey: '', geminiKey: '   ',
    serpApiKey: SECRET_PLACEHOLDER, firebirdApiKey: null, firebirdClientToken: 'novo-token',
  }), { evolutionUrl: 'https://evolution.example', firebirdClientToken: 'novo-token' });
});

test('webhook falha fechado quando WEBHOOK_SECRET nao esta configurado', () => {
  const previous = process.env.WEBHOOK_SECRET;
  const previousAllowUnsigned = process.env.ALLOW_UNSIGNED_WEBHOOKS;
  delete process.env.WEBHOOK_SECRET;
  delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
  try {
    const response = responseRecorder();
    verifyWebhookSecret(requestWithHeaders(), response, () => assert.fail('nao deveria autorizar'));
    assert.equal(response.statusCode, 503);
  } finally {
    if (previous !== undefined) process.env.WEBHOOK_SECRET = previous;
    if (previousAllowUnsigned !== undefined) process.env.ALLOW_UNSIGNED_WEBHOOKS = previousAllowUnsigned;
  }
});

test('webhook falha fechado e aceita header ou bearer quando secret esta configurado', () => {
  const previous = process.env.WEBHOOK_SECRET;
  process.env.WEBHOOK_SECRET = 'webhook-test-secret';
  try {
    const denied = responseRecorder();
    verifyWebhookSecret(requestWithHeaders(), denied, () => assert.fail('nao deveria autorizar'));
    assert.equal(denied.statusCode, 401);

    const wrongSecret = responseRecorder();
    verifyWebhookSecret(
      requestWithHeaders({ 'x-webhook-secret': 'segredo-incorreto' }),
      wrongSecret,
      () => assert.fail('nao deveria autorizar segredo incorreto'),
    );
    assert.equal(wrongSecret.statusCode, 401);

    for (const headers of [
      { 'x-webhook-secret': 'webhook-test-secret' },
      { authorization: 'Bearer webhook-test-secret' },
    ]) {
      let called = false;
      verifyWebhookSecret(requestWithHeaders(headers), responseRecorder(), () => { called = true; });
      assert.equal(called, true);
    }
  } finally {
    if (previous === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = previous;
  }
});

test('startup-fix nao consulta nem sobrescreve configuracoes sem defaults completos', async () => {
  let queried = false;
  const prisma = { tenantSettings: { findMany: async () => { queried = true; return []; } } };
  const result = await repairInvalidEvolutionSettings(
    prisma, { DEFAULT_EVOLUTION_URL: 'https://evolution.example' }, { warn() {}, log() {} },
  );
  assert.deepEqual(result, { skipped: true, updated: 0 });
  assert.equal(queried, false);
});

test('startup-fix usa somente defaults do ambiente para corrigir URL invalida', async () => {
  const updates = [];
  const prisma = { tenantSettings: {
    findMany: async () => [{ id: 'settings-1' }],
    update: async (operation) => { updates.push(operation); },
  } };
  const result = await repairInvalidEvolutionSettings(prisma, {
    DEFAULT_EVOLUTION_URL: 'https://evolution.example', DEFAULT_EVOLUTION_KEY: 'env-secret',
  }, { warn() {}, log() {} });
  assert.deepEqual(result, { skipped: false, updated: 1 });
  assert.deepEqual(updates, [{
    where: { id: 'settings-1' },
    data: { evolutionUrl: 'https://evolution.example', evolutionKey: 'env-secret' },
  }]);
});
