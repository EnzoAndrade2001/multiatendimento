const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ThinkingLevel } = require('@google/genai');
const { chat, draftServiceOrder, __testing } = require('../src/services/geminiService');

test('chat usa Gemini 3.7 e mantém fallbacks estáveis', () => {
  const previous = process.env.GEMINI_CHAT_MODELS;
  delete process.env.GEMINI_CHAT_MODELS;
  try {
    assert.deepEqual(__testing.getProfileModels('chat'), [
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-2.5-flash',
    ]);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_CHAT_MODELS;
    else process.env.GEMINI_CHAT_MODELS = previous;
  }
});

test('tarefas leves usam Flash-Lite e não o modelo principal', () => {
  const previous = process.env.GEMINI_LIGHT_MODELS;
  delete process.env.GEMINI_LIGHT_MODELS;
  try {
    assert.equal(__testing.getProfileModels('light')[0], 'gemini-3.5-flash-lite');
  } finally {
    if (previous === undefined) delete process.env.GEMINI_LIGHT_MODELS;
    else process.env.GEMINI_LIGHT_MODELS = previous;
  }
});

test('Gemini 3.7 usa thinking baixo e não recebe parâmetros antigos', () => {
  const config = __testing.generationConfig('gemini-3.7-flash', { profile: 'chat' });
  assert.equal(config.thinkingConfig.thinkingLevel, ThinkingLevel.LOW);
  assert.equal(config.temperature, undefined);
  assert.equal(config.topK, undefined);
});

test('Gemini 2.5 permanece compatível como fallback', () => {
  const config = __testing.generationConfig('gemini-2.5-flash', { profile: 'chat' });
  assert.equal(config.thinkingConfig.thinkingBudget, 0);
  assert.equal(config.temperature, 0.1);
  assert.equal(config.topK, 1);
});

test('backend não mantém dependência do SDK legado', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies['@google/generative-ai'], undefined);
  assert.equal(packageJson.dependencies['@google/genai'], '2.19.0');
});

test('SDK novo envia chat ao 3.7 com configuração compatível', async (context) => {
  const originalFetch = global.fetch;
  const previousModels = process.env.GEMINI_CHAT_MODELS;
  context.after(() => {
    global.fetch = originalFetch;
    if (previousModels === undefined) delete process.env.GEMINI_CHAT_MODELS;
    else process.env.GEMINI_CHAT_MODELS = previousModels;
  });
  process.env.GEMINI_CHAT_MODELS = 'gemini-3.7-flash';

  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Resposta segura' }] }, finishReason: 'STOP' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chat('fake-key', 'Siga as regras.', [], 'Olá');
  assert.equal(result, 'Resposta segura');
  assert.match(captured.url, /gemini-3\.7-flash/);
  assert.equal(captured.body.generationConfig.thinkingConfig.thinkingLevel, ThinkingLevel.LOW);
  assert.equal(captured.body.generationConfig.temperature, undefined);
});

test('rascunho de O.S. usa perfil leve e resposta curta', async (context) => {
  const originalFetch = global.fetch;
  const previousModels = process.env.GEMINI_LIGHT_MODELS;
  context.after(() => {
    global.fetch = originalFetch;
    if (previousModels === undefined) delete process.env.GEMINI_LIGHT_MODELS;
    else process.env.GEMINI_LIGHT_MODELS = previousModels;
  });
  process.env.GEMINI_LIGHT_MODELS = 'gemini-3.5-flash-lite';

  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: '{"defect":"papel preso","equipmentId":"eq-1"}' }] }, finishReason: 'STOP' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await draftServiceOrder(
    'fake-key',
    [{ fromMe: false, body: 'A impressora estÃ¡ com papel preso.' }],
    [{ id: 'eq-1', model: 'Canon G6010' }],
  );

  assert.deepEqual(result, { defect: 'papel preso', equipmentId: 'eq-1' });
  assert.match(captured.url, /gemini-3\.5-flash-lite/);
  assert.equal(captured.body.generationConfig.maxOutputTokens, 250);
  assert.equal(captured.body.generationConfig.responseMimeType, 'application/json');
});
