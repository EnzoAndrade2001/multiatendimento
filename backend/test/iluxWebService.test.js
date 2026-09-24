const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/iluxWebService');

test('integração ILUX_WEB envia token e lê o número definitivo', async (t) => {
  const oldUrl = process.env.ILUX_WEB_URL;
  const oldToken = process.env.ILUX_WEB_SYNC_TOKEN;
  const oldFetch = global.fetch;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.ILUX_WEB_URL;
    else process.env.ILUX_WEB_URL = oldUrl;
    if (oldToken === undefined) delete process.env.ILUX_WEB_SYNC_TOKEN;
    else process.env.ILUX_WEB_SYNC_TOKEN = oldToken;
    global.fetch = oldFetch;
  });

  process.env.ILUX_WEB_URL = 'http://ilux-web.test';
  process.env.ILUX_WEB_SYNC_TOKEN = 'token-de-teste';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, text: async () => JSON.stringify({ ok: true, seqos: '92135' }) };
  };

  const response = await service.createServiceOrderInIluxWeb({ ordemServicoId: 'crm-os-1' });
  assert.equal(response.seqos, '92135');
  assert.equal(request.url, 'http://ilux-web.test/api/assistencia/os/sincronizar-lcd');
  assert.equal(request.options.headers['X-Ilux-Agente-Token'], 'token-de-teste');
  assert.deepEqual(JSON.parse(request.options.body), { ordemServicoId: 'crm-os-1' });
});

test('integração desconfigurada não tenta chamar a rede', async (t) => {
  const oldUrl = process.env.ILUX_WEB_URL;
  const oldToken = process.env.ILUX_WEB_SYNC_TOKEN;
  const oldFetch = global.fetch;
  t.after(() => {
    if (oldUrl === undefined) delete process.env.ILUX_WEB_URL;
    else process.env.ILUX_WEB_URL = oldUrl;
    if (oldToken === undefined) delete process.env.ILUX_WEB_SYNC_TOKEN;
    else process.env.ILUX_WEB_SYNC_TOKEN = oldToken;
    global.fetch = oldFetch;
  });

  delete process.env.ILUX_WEB_URL;
  delete process.env.ILUX_WEB_SYNC_TOKEN;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('não deveria chamar');
  };

  assert.equal(service.isIluxWebConfigured(), false);
  await assert.rejects(
    service.createServiceOrderInIluxWeb({}),
    /ILUX_WEB_URL não configurada/,
  );
  assert.equal(called, false);
});
