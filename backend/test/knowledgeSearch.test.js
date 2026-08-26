const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const geminiService = require('../src/services/geminiService');
const {
  buildKnowledgeContext,
  editDistance,
  fuzzyTokenMatch,
  lexicalSimilarity,
  selectRelevantKnowledge,
} = require('../src/services/knowledgeSearchService');

test('filtro tolera inversão simples no fabricante sem liberar palavras diferentes', () => {
  assert.equal(editDistance('xerox', 'xerxo'), 1);
  assert.equal(fuzzyTokenMatch('XERXO', 'qual gramatura usar na Xerox 7830'), true);
  assert.equal(fuzzyTokenMatch('RICOH', 'qual gramatura usar na Xerox 7830'), false);
});

const KNOWLEDGES = [
  {
    id: 'sc542',
    question: 'Erro SC 542',
    answer: 'Acesse o módulo de serviço, reinicie o fusor e desligue e ligue o equipamento.',
    tags: 'sc542, fusor, ricoh',
    embedding: null,
  },
  {
    id: 'boleto',
    question: 'Segunda via de boleto',
    answer: 'Encaminhar ao setor financeiro.',
    tags: 'financeiro, cobrança',
    embedding: null,
  },
];

test('frase natural sem pronome interrogativo encontra conhecimento por palavras', () => {
  const matches = selectRelevantKnowledge(KNOWLEDGES, 'minha ricoh apresentou sc 542', null);
  assert.equal(matches[0].id, 'sc542');
  assert.equal(matches[0].method, 'keywords');
});

test('tags ajudam a localizar variações que o cliente realmente escreve', () => {
  assert.ok(lexicalSimilarity('problema no fusor da máquina', KNOWLEDGES[0]) >= 0.34);
});

test('conteúdo irrelevante não é injetado no prompt', () => {
  const matches = selectRelevantKnowledge(KNOWLEDGES, 'boa noite, obrigado pelo atendimento', null);
  assert.deepEqual(matches, []);
});

test('contexto deixa claro que a base não autoriza promessas operacionais', () => {
  const context = buildKnowledgeContext([{ ...KNOWLEDGES[0], score: 0.9 }]);
  assert.match(context, /BASE DE CONHECIMENTO OFICIAL/);
  assert.match(context, /não invente procedimentos/);
  assert.match(context, /prazo, SLA ou confirmação operacional/);
});

test('similaridade rejeita embeddings antigos com dimensão incompatível', () => {
  assert.equal(geminiService.cosineSimilarity([1, 2, 3], [1, 2]), 0);
});

test('webhook consulta a base sem depender do filtro antigo de palavras-chave', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8');
  assert.doesNotMatch(source, /shouldUseKnowledgeSearch/);
  assert.match(source, /searchTenantKnowledge/);
  assert.match(source, /searched:\s*true/);
});
