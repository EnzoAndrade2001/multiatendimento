const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');

test('Gemini remains the default provider for existing tenants', () => {
  const config = aiService.providerConfig({ geminiKey: 'gemini-secret' });
  assert.equal(config.provider, 'gemini');
  assert.equal(config.key, 'gemini-secret');
  assert.equal(aiService.hasConfiguredProvider({ geminiKey: 'gemini-secret' }), true);
});

test('OpenAI and Claude use their own key; model is explicit > catalog > automático', () => {
  const openai = aiService.providerConfig({ aiProvider: 'openai', openaiKey: 'openai-secret', aiModel: 'gpt-test' });
  assert.equal(openai.provider, 'openai');
  assert.equal(openai.key, 'openai-secret');
  assert.equal(openai.model, 'gpt-test');
  const claude = aiService.providerConfig({ aiProvider: 'claude', anthropicKey: 'claude-secret', aiModel: 'claude-test' });
  assert.equal(claude.provider, 'anthropic');
  assert.equal(claude.model, 'claude-test');

  // Sem modelo escolhido: primeiro do catálogo descoberto.
  const fromCatalog = aiService.providerConfig({
    aiProvider: 'openai', openaiKey: 'k',
    aiModelCatalog: { openai: { models: [{ id: 'gpt-catalog' }] } },
  });
  assert.equal(fromCatalog.model, 'gpt-catalog');

  // Sem catálogo: cai no fallback estático, mas o provedor continua configurado
  // (o usuário não precisa saber o nome do modelo).
  const auto = aiService.providerConfig({ aiProvider: 'openai', openaiKey: 'k' });
  assert.ok(auto.model && typeof auto.model === 'string');
  assert.equal(aiService.hasConfiguredProvider({ aiProvider: 'openai', openaiKey: 'k' }), true);
  // Sem chave nenhuma: não configurado.
  assert.equal(aiService.hasConfiguredProvider({ aiProvider: 'openai' }), false);
});

test('resolveCapabilityEngine: Claude puro degrada embedding/áudio mas mantém visão', () => {
  const pure = { aiProvider: 'anthropic', anthropicKey: 'a' };
  assert.equal(aiService.resolveCapabilityEngine(pure, 'embedding').engine, null);
  assert.equal(aiService.resolveCapabilityEngine(pure, 'audio').engine, null);
  assert.equal(aiService.resolveCapabilityEngine(pure, 'vision').engine, 'anthropic');
  assert.equal(aiService.resolveCapabilityEngine(pure, 'document').engine, 'anthropic');

  const withAux = { aiProvider: 'anthropic', anthropicKey: 'a', aiAuxProvider: 'openai', openaiKey: 'o' };
  assert.equal(aiService.resolveCapabilityEngine(withAux, 'embedding').engine, 'openai');
  assert.equal(aiService.resolveCapabilityEngine(withAux, 'audio').engine, 'openai');

  // OpenAI como provedor principal atende tudo sozinho.
  const openaiOnly = { aiProvider: 'openai', openaiKey: 'o' };
  for (const cap of ['embedding', 'audio', 'vision', 'document']) {
    assert.equal(aiService.resolveCapabilityEngine(openaiOnly, cap).engine, 'openai');
  }
});

test('conversation history is normalized for provider-neutral chat APIs', () => {
  assert.deepEqual(aiService.__testing.historyMessages([
    { body: 'Olá', fromMe: false },
    { body: 'Como posso ajudar?', fromBot: true },
  ]), [
    { role: 'user', content: 'Olá' },
    { role: 'assistant', content: 'Como posso ajudar?' },
  ]);
});
