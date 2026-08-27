const prisma = require('../lib/prisma');
const geminiService = require('./geminiService');

const STOP_WORDS = new Set(['a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'ela', 'ele', 'em', 'essa', 'esse', 'esta', 'este', 'eu', 'me', 'meu', 'minha', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por', 'pra', 'que', 'se', 'sem', 'um', 'uma']);

function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokenize(value) { return normalizeText(value).split(/\s+/).filter((token) => token.length >= 2 && !STOP_WORDS.has(token)); }

function editDistance(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  const matrix = Array.from({ length: a.length + 1 }, (_, row) => Array.from({ length: b.length + 1 }, (_, column) => row || column));
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(matrix[row - 1][column] + 1, matrix[row][column - 1] + 1, matrix[row - 1][column - 1] + cost);
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}

function fuzzyTokenMatch(reference, candidateText) {
  const references = tokenize(reference).filter((token) => token.length >= 4);
  const candidates = tokenize(candidateText).filter((token) => token.length >= 4);
  return references.some((expected) => candidates.some((candidate) => {
    if (expected === candidate) return true;
    const tolerance = Math.min(2, Math.max(1, Math.floor(Math.max(expected.length, candidate.length) / 5)));
    return editDistance(expected, candidate) <= tolerance;
  }));
}

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

// Idioma da consulta do usuario. Tecnicos perguntam em portugues; a etapa de
// resposta ja responde em pt-BR a partir de contexto em qualquer idioma.
const QUERY_LANGUAGE = 'pt-BR';

// pt / pt-BR / pt_br -> "pt" ; en / en-US -> "en". Comparamos so o idioma base.
function languageTag(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-').split('-')[0];
}
function isPortuguese(value) {
  return languageTag(value) === 'pt';
}

// Pergunta chega em portugues, mas ha manuais so em ingles. Traduzimos a
// consulta apenas para a busca (nao afeta a resposta enviada ao usuario). Se a
// traducao falhar ou nao mudar nada, seguimos so com a consulta original.
async function translateForRetrieval(apiKey, query) {
  const text = String(query || '').trim();
  if (!text) return null;
  try {
    const translated = await geminiService.generateText(
      apiKey,
      `Translate the text below to English. Output only the translation, with no quotes and no extra words.\n\n${text}`,
      { profile: 'light', maxOutputTokens: 60 },
    );
    const clean = String(translated || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!clean || normalizeText(clean) === normalizeText(text)) return null;
    return clean;
  } catch (error) {
    console.warn('[knowledge] falha ao traduzir consulta para ingles:', error.message);
    return null;
  }
}

function selectRelevantKnowledge(items, query, queryEmbedding, { limit = 3, extraEmbeddings = [], queryLanguage } = {}) {
  const semanticMinimum = thresholdFromEnv('KNOWLEDGE_SEMANTIC_MIN_SCORE', 0.64);
  const lexicalMinimum = thresholdFromEnv('KNOWLEDGE_LEXICAL_MIN_SCORE', 0.34);
  // Similaridade cross-lingual real (pergunta pt-BR x manual em ingles) costuma
  // cair para 0,55-0,63. Para itens cujo idioma difere do da pergunta usamos um
  // corte semantico menor; nunca maior que o corte padrao.
  const crossLangMinimum = Math.min(semanticMinimum, thresholdFromEnv('KNOWLEDGE_SEMANTIC_MIN_SCORE_CROSSLANG', 0.55));
  const queryVectors = [queryEmbedding, ...extraEmbeddings].filter((vector) => Array.isArray(vector) && vector.length);
  const queryTag = queryLanguage ? languageTag(queryLanguage) : null;
  return items.map((item) => {
    const lexical = lexicalSimilarity(query, item);
    // Com traducao ativa cada item e pontuado pelo melhor dos vetores de consulta.
    const semantic = queryVectors.length && Array.isArray(item.embedding)
      ? Math.max(...queryVectors.map((vector) => geminiService.cosineSimilarity(vector, item.embedding)))
      : 0;
    const crossLang = Boolean(queryTag && item.language && languageTag(item.language) !== queryTag);
    const semanticCut = crossLang ? crossLangMinimum : semanticMinimum;
    const score = semantic > 0 ? (semantic * 0.8) + (lexical * 0.2) : lexical;
    return { ...item, score, semantic, lexical, method: semantic > 0 && lexical > 0 ? 'hybrid' : semantic > 0 ? 'semantic' : 'keywords', relevant: semantic >= semanticCut || lexical >= lexicalMinimum };
  }).filter((item) => item.relevant).sort((a, b) => b.score - a.score).slice(0, limit);
}

async function searchTenantKnowledge({ tenantId, apiKey, query, limit = 3, equipments = [], audience = 'CUSTOMER' }) {
  const requestedAudience = String(audience || 'CUSTOMER').toUpperCase();
  // Atendentes e técnicos podem consultar respostas gerais do cliente, além
  // do material reservado ao seu público. Clientes continuam isolados.
  const documentAudience = requestedAudience === 'TECHNICIAN'
    ? { in: ['TECHNICIAN', 'CUSTOMER'] }
    : requestedAudience === 'AGENT'
      ? { in: ['AGENT', 'CUSTOMER'] }
      : 'CUSTOMER';
  const [answers, documentChunks] = await Promise.all([
    prisma.knowledge.findMany({ where: { tenantId, active: true }, select: { id: true, question: true, answer: true, tags: true, embedding: true } }),
    prisma.knowledgeChunk.findMany({
      where: { tenantId, document: { status: 'PUBLISHED', audience: documentAudience } },
      select: { id: true, content: true, section: true, pageStart: true, pageEnd: true, embedding: true, document: { select: { id: true, title: true, category: true, audience: true, manufacturer: true, equipmentModel: true, version: true, language: true } } },
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
      language: chunk.document.language,
      sourceType: 'document', sourceTitle: chunk.document.title, category: chunk.document.category, audience: chunk.document.audience,
      pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, version: chunk.document.version,
      modelRelevant: !metadata || normalizedEquipments.some((equipment) => {
        const model = normalizeText(chunk.document.equipmentModel || '');
        if (model) return equipment.includes(model) || tokenize(model).filter((token) => token.length >= 3).every((token) => equipment.includes(token));
        return fuzzyTokenMatch(chunk.document.manufacturer || '', equipment);
      }) || (() => {
        const model = normalizeText(chunk.document.equipmentModel || '');
        if (model) return normalizedQuery.includes(model) || tokenize(model).filter((token) => token.length >= 3).every((token) => normalizedQuery.includes(token));
        return fuzzyTokenMatch(chunk.document.manufacturer || '', normalizedQuery);
      })(),
    };
  }).filter((item) => item.modelRelevant);
  const searchable = [...answers.map((item) => ({ ...item, sourceType: 'answer', category: 'ANSWER' })), ...technicalItems];
  // Se ha manual publicado em outro idioma, a pergunta (em portugues) tambem e
  // traduzida para ingles e cada item passa a ser pontuado pelo melhor dos dois
  // vetores. Base 100% em portugues nao paga a traducao.
  const hasForeignDoc = technicalItems.some((item) => item.language && !isPortuguese(item.language));
  let queryEmbedding = null;
  let embeddingError = null;
  const extraEmbeddings = [];
  if (apiKey && searchable.some((item) => Array.isArray(item.embedding))) {
    try { queryEmbedding = await geminiService.getEmbedding(apiKey, query, { taskType: 'RETRIEVAL_QUERY' }); if (!queryEmbedding) embeddingError = 'Embedding indisponível; busca por palavras aplicada.'; }
    catch (error) { embeddingError = error.message; }
    if (queryEmbedding && hasForeignDoc) {
      const englishQuery = await translateForRetrieval(apiKey, query);
      if (englishQuery) {
        try {
          const englishEmbedding = await geminiService.getEmbedding(apiKey, englishQuery, { taskType: 'RETRIEVAL_QUERY' });
          if (englishEmbedding) extraEmbeddings.push(englishEmbedding);
        } catch (error) { console.warn('[knowledge] falha ao embutir traducao da consulta:', error.message); }
      }
    }
  }
  const boost = { ANSWER: 0.08, PROCEDURE: 0.05, MANUAL: 0.02, PORTFOLIO: 0 };
  const matches = selectRelevantKnowledge(searchable, query, queryEmbedding, { limit: Math.max(limit * 3, 9), extraEmbeddings, queryLanguage: QUERY_LANGUAGE })
    .map((item) => ({ ...item, score: Math.min(1, item.score + (boost[item.category] || 0)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
  return { searched: true, audience: requestedAudience, totalActive: searchable.length, activeAnswers: answers.length, publishedChunks: technicalItems.length, indexed: searchable.filter((item) => Array.isArray(item.embedding)).length, crossLanguage: extraEmbeddings.length > 0, matches, embeddingError };
}

function buildKnowledgeContext(matches, { audience = 'CUSTOMER' } = {}) {
  if (!matches.length) return '';
  const items = [
    ...(String(audience).toUpperCase() === 'TECHNICIAN'
      ? ['Modo tecnico autorizado: priorize diagnostico e manuais publicados; informe a pagina quando houver e sinalize riscos.']
      : []),
    ...matches.map((item, index) => {
    if (item.sourceType === 'document') {
      const page = item.pageStart ? `, página ${item.pageStart}${item.pageEnd && item.pageEnd !== item.pageStart ? `-${item.pageEnd}` : ''}` : '';
      return `Item ${index + 1}\nFonte técnica: ${item.sourceTitle}${item.version ? `, versão ${item.version}` : ''}${page}\nTrecho aprovado: ${item.answer}`;
    }
    return `Item ${index + 1}\nPergunta/tópico: ${item.question}\nResposta oficial: ${item.answer}`;
    }),
  ];
  return `\n\n[BASE DE CONHECIMENTO OFICIAL DA EMPRESA]:\nUse somente os itens pertinentes à solicitação atual. Não complete lacunas, não invente procedimentos e não transforme exemplos em promessa de prazo, SLA ou confirmação operacional.\n${items.join('\n---\n')}`;
}

module.exports = { buildKnowledgeContext, editDistance, fuzzyTokenMatch, isPortuguese, languageTag, lexicalSimilarity, normalizeText, searchTenantKnowledge, selectRelevantKnowledge, translateForRetrieval };
