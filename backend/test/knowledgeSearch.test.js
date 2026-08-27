const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/lib/prisma');
const geminiService = require('../src/services/geminiService');
const {
  buildKnowledgeContext,
  editDistance,
  fuzzyTokenMatch,
  lexicalSimilarity,
  searchTenantKnowledge,
  selectRelevantKnowledge,
  translateForRetrieval,
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

// --- Recuperação multilíngue (pergunta pt-BR x manual em inglês) -------------

test('getEmbedding envia taskType ao pedido de embedding apenas quando informado', async (context) => {
  const originalFetch = global.fetch;
  const previousModels = process.env.GEMINI_EMBED_MODELS;
  context.after(() => {
    global.fetch = originalFetch;
    if (previousModels === undefined) delete process.env.GEMINI_EMBED_MODELS;
    else process.env.GEMINI_EMBED_MODELS = previousModels;
  });
  process.env.GEMINI_EMBED_MODELS = 'gemini-embedding-001';

  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  const withTask = await geminiService.getEmbedding('fake-key', 'trocar o fusor', { taskType: 'RETRIEVAL_QUERY' });
  const withoutTask = await geminiService.getEmbedding('fake-key', 'trocar o fusor');

  assert.deepEqual(withTask, [0.1, 0.2, 0.3]);
  assert.deepEqual(withoutTask, [0.1, 0.2, 0.3]);
  assert.match(calls[0].url, /batchEmbedContents/);
  assert.equal(calls[0].body.requests[0].taskType, 'RETRIEVAL_QUERY');
  assert.ok(calls[0].body.requests[0].outputDimensionality >= 1);
  assert.equal(calls[1].body.requests[0].taskType, undefined);
});

test('seletor pontua cada item pelo melhor dos vetores de consulta', () => {
  const item = { id: 'doc', question: 'Fuser unit', answer: 'Remove the rear cover.', tags: 'fuser', embedding: [1, 0] };
  // Vetor original ortogonal (cosseno 0); a tradução alinha (cosseno 1).
  const semanticOnly = selectRelevantKnowledge([item], 'zzz qqq', [0, 1], { limit: 3 });
  assert.deepEqual(semanticOnly, []);
  const withTranslation = selectRelevantKnowledge([item], 'zzz qqq', [0, 1], { limit: 3, extraEmbeddings: [[1, 0]] });
  assert.equal(withTranslation.length, 1);
  assert.equal(withTranslation[0].semantic, 1);
});

test('manual de modelo diferente nao e barrado: aparece com pontuacao penalizada', () => {
  const q = { question: '303-403 Extended FAX Not Detected', answer: 'Reset the Main Controller or switch the power off then on.', tags: 'MANUAL XEROX 7830', embedding: [1, 0] };
  const match = { ...q, id: 'certo', modelRelevant: true };
  const mismatch = { ...q, id: 'penalizado', modelRelevant: false };
  const queryVector = [1, 0]; // cosseno 1 nos dois itens
  const matches = selectRelevantKnowledge([match, mismatch], '303-403', queryVector, { limit: 5 });
  assert.deepEqual(matches.map((item) => item.id), ['certo', 'penalizado']);
  assert.ok(matches[1].score < matches[0].score, 'o item sem match de modelo perde posicao');
  assert.ok(matches[1].relevant, 'mas continua elegivel, nao e filtrado');
});

test('limiar cross-lingual menor vale só para itens em idioma diferente da pergunta', () => {
  const base = { question: 'Fuser unit maintenance', answer: 'Remove the rear cover and the two screws.', tags: 'fuser', embedding: [1, 0] };
  const items = [
    { ...base, id: 'en', language: 'en' },
    { ...base, id: 'pt', language: 'pt-BR' },
  ];
  // Vetor de consulta com cosseno ~0,58: acima do corte cross-lingual (0,55),
  // abaixo do corte padrão (0,64).
  const queryVector = [0.58, Math.sqrt(1 - 0.58 * 0.58)];
  const matches = selectRelevantKnowledge(items, 'zzz qqq', queryVector, { limit: 5, queryLanguage: 'pt-BR' });
  assert.deepEqual(matches.map((item) => item.id), ['en']);
  assert.ok(Math.abs(matches[0].semantic - 0.58) < 1e-6);
});

test('translateForRetrieval limpa aspas, ignora eco e degrada sem quebrar', async (context) => {
  const original = geminiService.generateText;
  context.after(() => { geminiService.generateText = original; });

  geminiService.generateText = async () => '"Replace the fuser unit"';
  assert.equal(await translateForRetrieval('k', 'trocar a unidade do fusor'), 'Replace the fuser unit');

  geminiService.generateText = async () => 'trocar o fusor';
  assert.equal(await translateForRetrieval('k', 'trocar o fusor'), null);

  geminiService.generateText = async () => '';
  assert.equal(await translateForRetrieval('k', 'trocar o fusor'), null);

  geminiService.generateText = async () => { throw new Error('quota'); };
  assert.equal(await translateForRetrieval('k', 'trocar o fusor'), null);

  let called = false;
  geminiService.generateText = async () => { called = true; return 'x'; };
  assert.equal(await translateForRetrieval('k', '   '), null);
  assert.equal(called, false);
});

test('searchTenantKnowledge traduz a consulta quando há manual em outro idioma', { concurrency: false }, async (context) => {
  const restore = {
    knowledge: prisma.knowledge.findMany,
    chunk: prisma.knowledgeChunk.findMany,
    getEmbedding: geminiService.getEmbedding,
    generateText: geminiService.generateText,
  };
  context.after(() => {
    prisma.knowledge.findMany = restore.knowledge;
    prisma.knowledgeChunk.findMany = restore.chunk;
    geminiService.getEmbedding = restore.getEmbedding;
    geminiService.generateText = restore.generateText;
  });

  const chunkFor = (language) => ([{
    id: 'c1', content: 'Fuser replacement steps', section: 'Fuser', pageStart: 3, pageEnd: 3, embedding: [1, 0, 0],
    document: {
      id: 'd1', title: 'Service Manual', category: 'MANUAL', audience: 'TECHNICIAN',
      manufacturer: null, equipmentModel: null, version: '1', language,
    },
  }]);

  const run = async (language, translate) => {
    const embedCalls = [];
    let translateCalls = 0;
    prisma.knowledge.findMany = async () => [];
    prisma.knowledgeChunk.findMany = async () => chunkFor(language);
    geminiService.getEmbedding = async (_key, _text, options) => { embedCalls.push(options); return [1, 0, 0]; };
    geminiService.generateText = async () => { translateCalls += 1; return translate(); };
    const result = await searchTenantKnowledge({ tenantId: 't1', apiKey: 'k', query: 'passos para trocar o fusor', audience: 'TECHNICIAN' });
    return { result, embedCalls, translateCalls };
  };

  const foreign = await run('en', () => 'fuser replacement steps');
  assert.equal(foreign.translateCalls, 1);
  assert.equal(foreign.embedCalls.length, 2);
  assert.deepEqual(foreign.embedCalls[0], { taskType: 'RETRIEVAL_QUERY' });
  assert.equal(foreign.result.crossLanguage, true);
  assert.equal(foreign.result.matches.length, 1);

  const portuguese = await run('pt-BR', () => 'nunca chamado');
  assert.equal(portuguese.translateCalls, 0);
  assert.equal(portuguese.embedCalls.length, 1);
  assert.equal(portuguese.result.crossLanguage, false);

  const brokenTranslation = await run('en', () => { throw new Error('quota'); });
  assert.equal(brokenTranslation.embedCalls.length, 1);
  assert.equal(brokenTranslation.result.crossLanguage, false);
  assert.equal(brokenTranslation.result.searched, true);
});

test('conteúdo armazenado usa taskType de documento e a consulta usa taskType de busca', () => {
  const docService = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'knowledgeDocumentService.js'), 'utf8');
  assert.match(docService, /getEmbedding\([^;]*RETRIEVAL_DOCUMENT/);
  const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'knowledgeController.js'), 'utf8');
  assert.equal((controller.match(/RETRIEVAL_DOCUMENT/g) || []).length, 3);
  const searchService = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'knowledgeSearchService.js'), 'utf8');
  assert.match(searchService, /getEmbedding\([^;]*RETRIEVAL_QUERY/);
});
