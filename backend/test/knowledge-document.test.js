const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkPages, formatProcessingError, validateSignature } = require('../src/services/knowledgeDocumentService');

test('valida assinatura real do PDF e rejeita arquivo disfarçado', () => {
  assert.equal(validateSignature(Buffer.from('%PDF-1.7 arquivo'), 'application/pdf'), true);
  assert.equal(validateSignature(Buffer.from('arquivo executável'), 'application/pdf'), false);
});

test('divide manual extenso preservando página e ordem', () => {
  const chunks = chunkPages([{ page: 7, text: `ERRO SC 542\n${'Procedimento técnico aprovado. '.repeat(220)}` }]);
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map((item) => item.position), chunks.map((_, index) => index));
  assert.ok(chunks.every((item) => item.pageStart === 7 && item.pageEnd === 7));
  assert.match(chunks[0].section, /ERRO SC 542/);
});

test('aceita apenas imagens com assinatura compatível', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.equal(validateSignature(png, 'image/png'), true);
  assert.equal(validateSignature(Buffer.from('not png'), 'image/png'), false);
});

test('nao expoe detalhes internos do banco ao falhar processamento', () => {
  const message = formatProcessingError(new Error('Invalid tx.knowledgeChunk.createMany() invocation: Transaction already closed'));
  assert.match(message, /limite de seguranca/i);
  assert.doesNotMatch(message, /createMany|Transaction/i);
});

test('preserva orientacao segura e acionavel para arquivo grande sem texto', () => {
  const error = new Error('O arquivo nao possui texto pesquisavel. Envie um PDF pesquisavel ou divida o manual.');
  error.publicMessage = true;
  assert.match(formatProcessingError(error), /PDF pesquisavel/i);
});
