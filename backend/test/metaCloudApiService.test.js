const test = require('node:test');
const assert = require('node:assert/strict');
const metaCloudApi = require('../src/services/metaCloudApiService');

test('graphVersion usa o padrao e respeita a env', () => {
  const original = process.env.META_GRAPH_VERSION;
  delete process.env.META_GRAPH_VERSION;
  assert.equal(metaCloudApi.graphVersion(), 'v20.0');
  process.env.META_GRAPH_VERSION = 'v23.0';
  assert.equal(metaCloudApi.graphVersion(), 'v23.0');
  if (original === undefined) delete process.env.META_GRAPH_VERSION;
  else process.env.META_GRAPH_VERSION = original;
});

test('subscribeAppToWaba exige wabaId e accessToken', async () => {
  await assert.rejects(() => metaCloudApi.subscribeAppToWaba({ accessToken: 'x' }), /WABA ID/);
  await assert.rejects(() => metaCloudApi.subscribeAppToWaba({ wabaId: '123' }), /access token/);
});

test('graphErrorDetail extrai a mensagem da Graph API', () => {
  assert.equal(
    metaCloudApi.graphErrorDetail({ response: { data: { error: { message: 'Invalid OAuth access token.' } } } }),
    'Invalid OAuth access token.',
  );
  assert.equal(metaCloudApi.graphErrorDetail({ message: 'socket hang up' }), 'socket hang up');
});
