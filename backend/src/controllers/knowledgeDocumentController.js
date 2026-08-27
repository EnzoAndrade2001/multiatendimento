const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const documentService = require('../services/knowledgeDocumentService');

function text(value, max = 200) { return String(value || '').trim().slice(0, max); }
function serialize(item) {
  const { storageKey, checksum, chunks, ...safe } = item;
  return { ...safe, preview: chunks || undefined };
}

async function list(req, res) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [documents, usage] = await Promise.all([
      prisma.knowledgeDocument.findMany({
        where: { tenantId: req.user.tenantId },
        include: { supersedes: { select: { id: true, title: true, version: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.knowledgeLog.groupBy({ by: ['documentId'], where: { tenantId: req.user.tenantId, documentId: { not: null }, found: true, createdAt: { gte: since } }, _count: { _all: true }, _max: { createdAt: true } }),
    ]);
    const byId = new Map(usage.map((row) => [row.documentId, row]));
    res.json(documents.map((item) => ({ ...serialize(item), usageCount30d: byId.get(item.id)?._count?._all || 0, lastUsedAt: byId.get(item.id)?._max?.createdAt || null })));
  } catch (error) {
    console.error('[knowledge-document] listar:', error.message);
    res.status(500).json({ error: 'Não foi possível carregar os documentos técnicos.' });
  }
}

async function create(req, res) {
  let stored;
  try {
    if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
    const title = text(req.body.title);
    const category = text(req.body.category, 30).toUpperCase() || 'MANUAL';
    const audience = text(req.body.audience, 30).toUpperCase() || 'CUSTOMER';
    if (!title) {
      await documentService.cleanupUploadFile(req.file);
      return res.status(400).json({ error: 'Informe o título do documento.' });
    }
    if (!documentService.CATEGORIES.has(category) || !documentService.AUDIENCES.has(audience)) {
      await documentService.cleanupUploadFile(req.file);
      return res.status(400).json({ error: 'Categoria ou público inválido.' });
    }

    stored = await documentService.saveUpload(req.user.tenantId, req.file);
    const document = await prisma.knowledgeDocument.create({ data: {
      tenantId: req.user.tenantId,
      title,
      description: text(req.body.description, 2000) || null,
      category,
      audience,
      manufacturer: text(req.body.manufacturer) || null,
      equipmentModel: text(req.body.equipmentModel) || null,
      version: text(req.body.version, 80) || null,
      language: text(req.body.language, 20) || 'pt-BR',
      status: 'PROCESSING',
      originalName: path.basename(req.file.originalname).slice(0, 255),
      storageKey: stored.storageKey,
      mimeType: req.file.mimetype,
      size: req.file.size,
      checksum: stored.checksum,
      supersedesId: text(req.body.supersedesId) || null,
      createdById: req.user.userId || null,
    } });
    const queued = documentService.queueDocumentProcessing(document.id);
    if (!queued) {
      const failed = await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: 'FAILED', processingError: 'A fila de processamento esta ocupada. O arquivo foi preservado; tente reprocessar em alguns minutos.' },
      });
      return res.status(503).json({ ...serialize(failed), error: failed.processingError });
    }
    res.status(202).json(serialize(document));
  } catch (error) {
    if (stored?.storageKey) await documentService.removeStoredFile(stored.storageKey).catch(() => {});
    await documentService.cleanupUploadFile(req.file).catch(() => {});
    if (error.code === 'P2002') return res.status(409).json({ error: 'Este mesmo arquivo já foi enviado para a base.' });
    console.error('[knowledge-document] criar:', error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível receber o documento.' });
  }
}

async function detail(req, res) {
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: { chunks: { select: { id: true, content: true, section: true, pageStart: true, pageEnd: true, position: true }, orderBy: { position: 'asc' }, take: 8 } },
  });
  if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
  res.json(serialize(document));
}

async function download(req, res) {
  const document = await prisma.knowledgeDocument.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
  const filePath = documentService.resolveStorageKey(document.storageKey);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo original não encontrado no volume persistente.' });
  res.download(filePath, document.originalName);
}

async function reprocess(req, res) {
  const document = await prisma.knowledgeDocument.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (document.status === 'PROCESSING') return res.status(409).json({ error: 'O documento já está sendo processado.' });
  const claimed = await prisma.knowledgeDocument.updateMany({
    where: { id: document.id, tenantId: req.user.tenantId, status: { not: 'PROCESSING' } },
    data: { status: 'PROCESSING', processingError: null },
  });
  if (!claimed.count) return res.status(409).json({ error: 'O documento ja esta sendo processado.' });
  if (!documentService.queueDocumentProcessing(document.id)) {
    const message = 'A fila de processamento esta ocupada. O arquivo foi preservado; tente novamente em alguns minutos.';
    await prisma.knowledgeDocument.update({ where: { id: document.id }, data: { status: 'FAILED', processingError: message } });
    return res.status(503).json({ error: message });
  }
  res.status(202).json({ status: 'PROCESSING' });
}

async function update(req, res) {
  try {
    const document = await prisma.knowledgeDocument.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
    const title = text(req.body.title);
    const category = text(req.body.category, 30).toUpperCase();
    const audience = text(req.body.audience, 30).toUpperCase();
    if (!title) return res.status(400).json({ error: 'Informe o título do documento.' });
    if (!documentService.CATEGORIES.has(category) || !documentService.AUDIENCES.has(audience)) return res.status(400).json({ error: 'Categoria ou público inválido.' });
    const updated = await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        title,
        description: text(req.body.description, 2000) || null,
        category,
        audience,
        manufacturer: text(req.body.manufacturer) || null,
        equipmentModel: text(req.body.equipmentModel) || null,
        version: text(req.body.version, 80) || null,
        language: text(req.body.language, 20) || document.language,
      },
    });
    res.json(serialize(updated));
  } catch (error) {
    console.error('[knowledge-document] atualizar:', error.message);
    res.status(500).json({ error: 'Não foi possível atualizar os dados do documento.' });
  }
}

async function publish(req, res) {
  const document = await prisma.knowledgeDocument.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (!document.chunkCount || !['DRAFT', 'PUBLISHED'].includes(document.status)) return res.status(409).json({ error: 'Aguarde o processamento completo antes de publicar.' });
  await prisma.$transaction(async (tx) => {
    if (document.supersedesId) await tx.knowledgeDocument.updateMany({ where: { id: document.supersedesId, tenantId: req.user.tenantId }, data: { status: 'REPLACED' } });
    await tx.knowledgeDocument.update({ where: { id: document.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  });
  res.json({ status: 'PUBLISHED' });
}

async function unpublish(req, res) {
  const result = await prisma.knowledgeDocument.updateMany({ where: { id: req.params.id, tenantId: req.user.tenantId, status: 'PUBLISHED' }, data: { status: 'DRAFT', publishedAt: null } });
  if (!result.count) return res.status(404).json({ error: 'Documento publicado não encontrado.' });
  res.json({ status: 'DRAFT' });
}

async function remove(req, res) {
  const document = await prisma.knowledgeDocument.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!document) return res.status(404).json({ error: 'Documento não encontrado.' });
  if (document.status === 'PUBLISHED') return res.status(409).json({ error: 'Retire o documento de publicação antes de excluí-lo.' });
  await prisma.knowledgeDocument.delete({ where: { id: document.id } });
  await documentService.removeStoredFile(document.storageKey);
  res.sendStatus(204);
}

module.exports = { create, detail, download, list, publish, remove, reprocess, unpublish, update };
