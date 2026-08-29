const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');

test('Gemini remains the default provider for existing tenants', () => {
  const config = aiService.providerConfig({ geminiKey: 'gemini-secret' });
  assert.equal(config.provider, 'gemini');
  assert.equal(config.key, 'gemini-secret');
  assert.equal(aiService.hasConfiguredProvider({ geminiKey: 'gemini-secret' }), true);
});

test('OpenAI and Claude require their own key and selected model', () => {
  const openai = aiService.providerConfig({ aiProvider: 'openai', openaiKey: 'openai-secret', aiModel: 'gpt-test' });
  assert.equal(openai.provider, 'openai');
  assert.equal(openai.key, 'openai-secret');
  assert.equal(openai.model, 'gpt-test');
  const claude = aiService.providerConfig({ aiProvider: 'claude', anthropicKey: 'claude-secret', aiModel: 'claude-test' });
  assert.equal(claude.provider, 'anthropic');
  assert.equal(claude.model, 'claude-test');
  assert.equal(aiService.hasConfiguredProvider({ aiProvider: 'openai', openaiKey: 'only-a-key' }), false);
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
