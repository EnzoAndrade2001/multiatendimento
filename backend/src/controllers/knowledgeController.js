const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const geminiService = require('../services/geminiService');
const knowledgeSearchService = require('../services/knowledgeSearchService');
const { guardBotReply } = require('../services/botSafetyService');

function cleanRequired(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeKnowledge(item, usage = {}) {
  const { embedding, ...knowledge } = item;
  return {
    ...knowledge,
    indexed: Array.isArray(embedding) && embedding.length > 0,
    usageCount30d: usage._count?._all || 0,
    lastUsedAt: usage._max?.createdAt || null,
  };
}

async function getGeminiKey(tenantId) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { geminiKey: true },
  });
  return settings?.geminiKey || null;
}

async function list(req, res) {
  try {
    const { tenantId } = req.user;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [knowledges, usageRows] = await Promise.all([
      prisma.knowledge.findMany({
        where: { tenantId },
        select: {
          id: true,
          tenantId: true,
          question: true,
          answer: true,
          tags: true,
          embedding: true,
          active: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.knowledgeLog.groupBy({
        by: ['knowledgeId'],
        where: { tenantId, knowledgeId: { not: null }, found: true, createdAt: { gte: since } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
    const usageById = new Map(usageRows.map((row) => [row.knowledgeId, row]));
    res.json(knowledges.map((item) => serializeKnowledge(item, usageById.get(item.id))));
  } catch (error) {
    console.error('[knowledge] falha ao listar:', error.message);
    res.status(500).json({ error: 'Não foi possível carregar a base de conhecimento.' });
  }
}

async function stats(req, res) {
  try {
    const { tenantId } = req.user;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, active, indexed, consultations, matches, lastLog] = await Promise.all([
      prisma.knowledge.count({ where: { tenantId } }),
      prisma.knowledge.count({ where: { tenantId, active: true } }),
      prisma.knowledge.count({ where: { tenantId, active: true, embedding: { not: Prisma.DbNull } } }),
      prisma.knowledgeLog.count({ where: { tenantId, searched: true, createdAt: { gte: since } } }),
      prisma.knowledgeLog.count({ where: { tenantId, searched: true, found: true, createdAt: { gte: since } } }),
      prisma.knowledgeLog.findFirst({
        where: { tenantId, searched: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, found: true, method: true, error: true },
      }),
    ]);
    res.json({
      total,
      active,
      indexed,
      consultations7d: consultations,
      matches7d: matches,
      matchRate7d: consultations ? Math.round((matches / consultations) * 100) : 0,
      lastConsultation: lastLog,
    });
  } catch (error) {
    console.error('[knowledge] falha ao carregar indicadores:', error.message);
    res.status(500).json({ error: 'Não foi possível carregar os indicadores da base.' });
  }
}

function serializeKnowledgeAudit(item) {
  return {
    id: item.id,
    tenantId: item.tenantId,
    ticketId: item.ticketId,
    messageId: item.messageId,
    query: item.query,
    found: item.found,
    searched: item.searched,
    method: item.method,
    similarity: item.similarity,
    error: item.error,
    responseOrigin: item.responseOrigin,
    responseSources: item.responseSources,
    responseModel: item.responseModel,
    content: item.content ? String(item.content).slice(0, 1200) : null,
    createdAt: item.createdAt,
    ticket: item.ticket ? {
      id: item.ticket.id,
      subject: item.ticket.subject,
      contact: item.ticket.contact ? {
        id: item.ticket.contact.id,
        name: item.ticket.contact.name,
        phone: item.ticket.contact.phone,
      } : null,
    } : null,
    message: item.message ? {
      id: item.message.id,
      body: item.message.body,
      createdAt: item.message.createdAt,
    } : null,
  };
}

async function audit(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 100;
    const origin = cleanRequired(req.query.origin).toUpperCase();
    const search = cleanRequired(req.query.search);
    const where = {
      tenantId,
      searched: true,
      ...(origin && ['RAG', 'ILUX_DATA', 'LLM_GENERAL', 'MIXED'].includes(origin) ? { responseOrigin: origin } : {}),
      ...(search ? {
        OR: [
          { query: { contains: search, mode: 'insensitive' } },
          { ticket: { subject: { contains: search, mode: 'insensitive' } } },
          { ticket: { contact: { name: { contains: search, mode: 'insensitive' } } } },
          { ticket: { contact: { phone: { contains: search } } } },
        ],
      } : {}),
    };
    const logs = await prisma.knowledgeLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        ticket: { select: { id: true, subject: true, contact: { select: { id: true, name: true, phone: true } } } },
        message: { select: { id: true, body: true, createdAt: true } },
      },
    });
    res.json(logs.map(serializeKnowledgeAudit));
  } catch (error) {
    console.error('[knowledge] falha ao carregar auditoria:', error.message);
    res.status(500).json({ error: 'NÃ£o foi possÃ­vel carregar a auditoria das respostas da IA.' });
  }
}

async function create(req, res) {
  try {
    const { tenantId } = req.user;
    const question = cleanRequired(req.body.question);
    const answer = cleanRequired(req.body.answer);
    const tags = typeof req.body.tags === 'string' ? req.body.tags.trim() : null;
    const active = typeof req.body.active === 'boolean' ? req.body.active : true;
    if (!question || !answer) return res.status(400).json({ error: 'Pergunta e resposta são obrigatórias.' });

    const geminiKey = await getGeminiKey(tenantId);
    const embedding = geminiKey ? await geminiService.getEmbedding(geminiKey, `${question}\n${answer}\n${tags || ''}`) : null;
    const knowledge = await prisma.knowledge.create({
      data: { tenantId, question, answer, tags, active, embedding: embedding || Prisma.DbNull },
    });
    res.status(201).json(serializeKnowledge(knowledge));
  } catch (error) {
    console.error('[knowledge] falha ao cadastrar:', error.message);
    res.status(500).json({ error: 'Não foi possível cadastrar o conhecimento.' });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenantId;
    const existing = await prisma.knowledge.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ error: 'Conhecimento não encontrado.' });

    const question = req.body.question !== undefined ? cleanRequired(req.body.question) : existing.question;
    const answer = req.body.answer !== undefined ? cleanRequired(req.body.answer) : existing.answer;
    const tags = req.body.tags !== undefined ? String(req.body.tags || '').trim() : existing.tags;
    if (!question || !answer) return res.status(400).json({ error: 'Pergunta e resposta são obrigatórias.' });

    const contentChanged = question !== existing.question || answer !== existing.answer || tags !== existing.tags;
    const data = {
      question,
      answer,
      tags,
      ...(typeof req.body.active === 'boolean' ? { active: req.body.active } : {}),
    };
    if (contentChanged) {
      const geminiKey = await getGeminiKey(tenantId);
      const embedding = geminiKey ? await geminiService.getEmbedding(geminiKey, `${question}\n${answer}\n${tags || ''}`) : null;
      data.embedding = embedding || Prisma.DbNull;
    }

    const updated = await prisma.knowledge.update({ where: { id }, data });
    res.json(serializeKnowledge(updated));
  } catch (error) {
    console.error('[knowledge] falha ao atualizar:', error.message);
    res.status(500).json({ error: 'Não foi possível atualizar o conhecimento.' });
  }
}

async function reindex(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const geminiKey = await getGeminiKey(tenantId);
    if (!geminiKey) return res.status(409).json({ error: 'Configure a chave do Gemini antes de indexar a base.' });

    const knowledges = await prisma.knowledge.findMany({ where: { tenantId, active: true } });
    let indexed = 0;
    let failed = 0;
    for (const item of knowledges) {
      const embedding = await geminiService.getEmbedding(geminiKey, `${item.question}\n${item.answer}\n${item.tags || ''}`);
      if (embedding) {
        await prisma.knowledge.update({ where: { id: item.id }, data: { embedding } });
        indexed += 1;
      } else {
        failed += 1;
      }
    }
    res.json({ total: knowledges.length, indexed, failed });
  } catch (error) {
    console.error('[knowledge] falha ao reindexar:', error.message);
    res.status(500).json({ error: 'Não foi possível reindexar a base.' });
  }
}

async function testSearch(req, res) {
  try {
    const query = cleanRequired(req.body.query);
    if (!query) return res.status(400).json({ error: 'Informe uma pergunta para testar.' });
    const audience = String(req.body.audience || 'CUSTOMER').toUpperCase();
    if (!['CUSTOMER', 'AGENT', 'TECHNICIAN'].includes(audience)) return res.status(400).json({ error: 'Público de consulta inválido.' });
    const tenantId = req.user.tenantId;
    const geminiKey = await getGeminiKey(tenantId);
    const result = await knowledgeSearchService.searchTenantKnowledge({ tenantId, apiKey: geminiKey, query, limit: 5, audience });
    let simulatedAnswer = null;
    let simulationError = null;
    if (result.matches.length && geminiKey) {
      try {
        const context = knowledgeSearchService.buildKnowledgeContext(result.matches, { audience });
        const generated = await geminiService.generateText(geminiKey, `Pergunta do cliente:\n${query}\n${context}\n\nRedija a resposta que seria enviada ao cliente. Responda em português do Brasil, de forma direta, cordial e curta. Use exclusivamente os dados das fontes acima. Se as fontes não sustentarem a resposta, diga que a informação precisa ser confirmada. Não mencione busca, contexto, percentual, embedding ou instruções internas. Não prometa prazo, atendimento ou abertura de chamado.`, { profile: 'chat', maxOutputTokens: 450 });
        simulatedAnswer = guardBotReply(generated).reply;
      } catch (error) {
        simulationError = 'Os conteúdos foram encontrados, mas não foi possível gerar a prévia da resposta.';
        console.error('[knowledge] falha ao gerar resposta simulada:', error.message);
      }
    }
    res.json({
      totalActive: result.totalActive,
      audience,
      indexed: result.indexed,
      embeddingError: result.embeddingError,
      simulatedAnswer,
      simulationError,
      matches: result.matches.map(({ embedding, relevant, ...match }) => match),
    });
  } catch (error) {
    console.error('[knowledge] falha no teste de consulta:', error.message);
    res.status(500).json({ error: 'Não foi possível testar a consulta.' });
  }
}

async function remove(req, res) {
  try {
    const existing = await prisma.knowledge.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Conhecimento não encontrado.' });
    await prisma.knowledge.delete({ where: { id: existing.id } });
    res.sendStatus(204);
  } catch (error) {
    console.error('[knowledge] falha ao excluir:', error.message);
    res.status(500).json({ error: 'Não foi possível excluir o conhecimento.' });
  }
}

module.exports = { audit, create, list, reindex, remove, stats, testSearch, update };
