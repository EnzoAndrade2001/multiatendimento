const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESPONSE_ORIGINS,
  classifyResponseOrigin,
  formatResponseOrigin,
} = require('../src/services/aiResponseAuditService');

test('classifica resposta com correspondência da base como RAG', () => {
  const result = classifyResponseOrigin({ found: true });
  assert.equal(result.origin, RESPONSE_ORIGINS.RAG);
  assert.deepEqual(result.sources, [RESPONSE_ORIGINS.RAG]);
});

test('registra contexto do iLux e fallback geral como origem mista', () => {
  const result = classifyResponseOrigin({ equipmentCount: 1, currentNotes: 'Cliente prefere contato pela manhã' });
  assert.equal(result.origin, RESPONSE_ORIGINS.MIXED);
  assert.deepEqual(result.sources, [RESPONSE_ORIGINS.ILUX_DATA, RESPONSE_ORIGINS.LLM_GENERAL]);
});

test('classifica resposta sem fonte oficial como conhecimento geral', () => {
  const result = classifyResponseOrigin({ responseModel: 'gemini-3.7-flash' });
  assert.equal(result.origin, RESPONSE_ORIGINS.LLM_GENERAL);
  assert.equal(result.responseModel, 'gemini-3.7-flash');
  assert.equal(formatResponseOrigin(result.origin), 'Conhecimento geral da IA');
});
