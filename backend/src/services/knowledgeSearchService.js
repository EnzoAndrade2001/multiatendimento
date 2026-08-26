const prisma = require('../lib/prisma');
const geminiService = require('./geminiService');

const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'ela', 'ele',
  'em', 'essa', 'esse', 'esta', 'este', 'eu', 'me', 'meu', 'minha', 'na', 'nas', 'no',
  'nos', 'o', 'os', 'ou', 'para', 'por', 'pra', 'que', 'se', 'sem', 'um', 'uma',
]);

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function lexicalSimilarity(query, knowledge) {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) return 0;

  const question = normalizeText(knowledge.question);
  const documentTokens = new Set(tokenize(`${knowledge.question || ''} ${knowledge.answer || ''} ${knowledge.tags || ''}`));
  const tagTokens = new Set(tokenize(knowledge.tags || ''));
  const overlap = queryTokens.filter((token) => documentTokens.has(token)).length;
  const tagOverlap = queryTokens.filter((token) => tagTokens.has(token)).length;
  let score = overlap / queryTokens.length;
  score += Math.min(0.2, (tagOverlap / queryTokens.length) * 0.3);

  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length >= 6 && (question.includes(normalizedQuery) || normalizedQuery.includes(question))) {
    score = Math.max(score, 0.95);
  }

  return Math.min(score, 1);
}

function thresholdFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function selectRelevantKnowledge(knowledges, query, queryEmbedding, { limit = 3 } = {}) {
  const semanticMinimum = thresholdFromEnv('KNOWLEDGE_SEMANTIC_MIN_SCORE', 0.64);
  const lexicalMinimum = thresholdFromEnv('KNOWLEDGE_LEXICAL_MIN_SCORE', 0.34);
  return knowledges
    .map((knowledge) => {
      const lexical = lexicalSimilarity(query, knowledge);
      const semantic = queryEmbedding && Array.isArray(knowledge.embedding)
        ? geminiService.cosineSimilarity(queryEmbedding, knowledge.embedding)
        : 0;
      const score = semantic > 0 ? (semantic * 0.8) + (lexical * 0.2) : lexical;
      const relevant = semantic >= semanticMinimum || lexical >= lexicalMinimum;
      const method = semantic > 0 && lexical > 0 ? 'hybrid' : semantic > 0 ? 'semantic' : 'keywords';
      return { ...knowledge, score, semantic, lexical, method, relevant };
    })
    .filter((item) => item.relevant)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function searchTenantKnowledge({ tenantId, apiKey, query, limit = 3 }) {
  const knowledges = await prisma.knowledge.findMany({
    where: { tenantId, active: true },
    select: { id: true, question: true, answer: true, tags: true, embedding: true },
  });

  let queryEmbedding = null;
  let embeddingError = null;
  if (apiKey && knowledges.some((item) => Array.isArray(item.embedding))) {
    try {
      queryEmbedding = await geminiService.getEmbedding(apiKey, query);
      if (!queryEmbedding) embeddingError = 'Embedding indisponível; busca por palavras aplicada.';
    } catch (error) {
      embeddingError = error.message;
    }
  }

  const matches = selectRelevantKnowledge(knowledges, query, queryEmbedding, { limit });
  return {
    searched: true,
    totalActive: knowledges.length,
    indexed: knowledges.filter((item) => Array.isArray(item.embedding)).length,
    matches,
    embeddingError,
  };
}

function buildKnowledgeContext(matches) {
  if (!matches.length) return '';
  return `\n\n[BASE DE CONHECIMENTO OFICIAL DA EMPRESA]:
Use somente os itens pertinentes à solicitação atual. Não complete lacunas, não invente procedimentos e não transforme exemplos em promessa de prazo, SLA ou confirmação operacional.
${matches.map((item, index) => `Item ${index + 1}\nPergunta/tópico: ${item.question}\nResposta oficial: ${item.answer}`).join('\n---\n')}`;
}

module.exports = {
  buildKnowledgeContext,
  lexicalSimilarity,
  normalizeText,
  searchTenantKnowledge,
  selectRelevantKnowledge,
};
