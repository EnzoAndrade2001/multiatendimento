const prisma = require('../lib/prisma');
const geminiService = require('./geminiService');

const STOP_WORDS = new Set(['a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'ela', 'ele', 'em', 'essa', 'esse', 'esta', 'este', 'eu', 'me', 'meu', 'minha', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por', 'pra', 'que', 'se', 'sem', 'um', 'uma']);

function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokenize(value) { return normalizeText(value).split(/\s+/).filter((token) => token.length >= 2 && !STOP_WORDS.has(token)); }

function lexicalSimilarity(query, knowledge) {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) return 0;
  const question = normalizeText(knowledge.question);
  const documentTokens = new Set(tokenize(`${knowledge.question || ''} ${knowledge.answer || ''} ${knowledge.tags || ''}`));
  const tagTokens = new Set(tokenize(knowledge.tags || ''));
  const overlap = queryTokens.filter((token) => documentTokens.has(token)).length;
  const tagOverlap = queryTokens.filter((token) => tagTokens.has(token)).length;
  let score = (overlap / queryTokens.length) + Math.min(0.2, (tagOverlap / queryTokens.length) * 0.3);
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length >= 6 && (question.includes(normalizedQuery) || normalizedQuery.includes(question))) score = Math.max(score, 0.95);
  return Math.min(score, 1);
}

function thresholdFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function selectRelevantKnowledge(items, query, queryEmbedding, { limit = 3 } = {}) {
  const semanticMinimum = thresholdFromEnv('KNOWLEDGE_SEMANTIC_MIN_SCORE', 0.64);
  const lexicalMinimum = thresholdFromEnv('KNOWLEDGE_LEXICAL_MIN_SCORE', 0.34);
  return items.map((item) => {
    const lexical = lexicalSimilarity(query, item);
    const semantic = queryEmbedding && Array.isArray(item.embedding) ? geminiService.cosineSimilarity(queryEmbedding, item.embedding) : 0;
    const score = semantic > 0 ? (semantic * 0.8) + (lexical * 0.2) : lexical;
    return { ...item, score, semantic, lexical, method: semantic > 0 && lexical > 0 ? 'hybrid' : semantic > 0 ? 'semantic' : 'keywords', relevant: semantic >= semanticMinimum || lexical >= lexicalMinimum };
  }).filter((item) => item.relevant).sort((a, b) => b.score - a.score).slice(0, limit);
}

async function searchTenantKnowledge({ tenantId, apiKey, query, limit = 3, equipments = [], audience = 'CUSTOMER' }) {
  const [answers, documentChunks] = await Promise.all([
    prisma.knowledge.findMany({ where: { tenantId, active: true }, select: { id: true, question: true, answer: true, tags: true, embedding: true } }),
    prisma.knowledgeChunk.findMany({
      where: { tenantId, document: { status: 'PUBLISHED', audience } },
      select: { id: true, content: true, section: true, pageStart: true, pageEnd: true, embedding: true, document: { select: { id: true, title: true, category: true, manufacturer: true, equipmentModel: true, version: true } } },
    }),
  ]);
  const normalizedEquipments = equipments.map((item) => normalizeText(`${item.manufacturer || ''} ${item.model || ''}`)).filter(Boolean);
  const normalizedQuery = normalizeText(query);
  const technicalItems = documentChunks.map((chunk) => {
    const metadata = `${chunk.document.manufacturer || ''} ${chunk.document.equipmentModel || ''}`.trim();
    return {
      id: `document:${chunk.id}`, chunkId: chunk.id, documentId: chunk.document.id,
      question: `${chunk.document.title}${chunk.section ? ` — ${chunk.section}` : ''}`,
      answer: chunk.content, tags: `${chunk.document.category} ${metadata}`, embedding: chunk.embedding,
      sourceType: 'document', sourceTitle: chunk.document.title, category: chunk.document.category,
      pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, version: chunk.document.version,
      modelRelevant: !metadata || normalizedEquipments.some((equipment) => {
        const model = normalizeText(chunk.document.equipmentModel || '');
        if (model) return equipment.includes(model) || tokenize(model).filter((token) => token.length >= 3).every((token) => equipment.includes(token));
        return tokenize(chunk.document.manufacturer || '').some((token) => equipment.includes(token));
      }) || (() => {
        const model = normalizeText(chunk.document.equipmentModel || '');
        if (model) return normalizedQuery.includes(model) || tokenize(model).filter((token) => token.length >= 3).every((token) => normalizedQuery.includes(token));
        return tokenize(chunk.document.manufacturer || '').some((token) => normalizedQuery.includes(token));
      })(),
    };
  }).filter((item) => item.modelRelevant);
  const searchable = [...answers.map((item) => ({ ...item, sourceType: 'answer', category: 'ANSWER' })), ...technicalItems];
  let queryEmbedding = null;
  let embeddingError = null;
  if (apiKey && searchable.some((item) => Array.isArray(item.embedding))) {
    try { queryEmbedding = await geminiService.getEmbedding(apiKey, query); if (!queryEmbedding) embeddingError = 'Embedding indisponível; busca por palavras aplicada.'; }
    catch (error) { embeddingError = error.message; }
  }
  const boost = { ANSWER: 0.08, PROCEDURE: 0.05, MANUAL: 0.02, PORTFOLIO: 0 };
  const matches = selectRelevantKnowledge(searchable, query, queryEmbedding, { limit: Math.max(limit * 3, 9) })
    .map((item) => ({ ...item, score: Math.min(1, item.score + (boost[item.category] || 0)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
  return { searched: true, totalActive: searchable.length, activeAnswers: answers.length, publishedChunks: technicalItems.length, indexed: searchable.filter((item) => Array.isArray(item.embedding)).length, matches, embeddingError };
}

function buildKnowledgeContext(matches) {
  if (!matches.length) return '';
  const items = matches.map((item, index) => {
    if (item.sourceType === 'document') {
      const page = item.pageStart ? `, página ${item.pageStart}${item.pageEnd && item.pageEnd !== item.pageStart ? `-${item.pageEnd}` : ''}` : '';
      return `Item ${index + 1}\nFonte técnica: ${item.sourceTitle}${item.version ? `, versão ${item.version}` : ''}${page}\nTrecho aprovado: ${item.answer}`;
    }
    return `Item ${index + 1}\nPergunta/tópico: ${item.question}\nResposta oficial: ${item.answer}`;
  });
  return `\n\n[BASE DE CONHECIMENTO OFICIAL DA EMPRESA]:\nUse somente os itens pertinentes à solicitação atual. Não complete lacunas, não invente procedimentos e não transforme exemplos em promessa de prazo, SLA ou confirmação operacional.\n${items.join('\n---\n')}`;
}

module.exports = { buildKnowledgeContext, lexicalSimilarity, normalizeText, searchTenantKnowledge, selectRelevantKnowledge };
