const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const geminiService = require('./geminiService');
const { knowledgePath } = require('../utils/uploads');

// A indexação de manuais pode gravar muitos vetores/chunks em uma única
// transação. O timeout padrão do Prisma (5s) é insuficiente em documentos
// maiores e fazia o arquivo terminar como FAILED mesmo após a extração bem-
// sucedida. Mantemos a gravação atômica, mas com limite configurável.
const KNOWLEDGE_TRANSACTION_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.KNOWLEDGE_TRANSACTION_TIMEOUT_MS) || 60_000,
);
const KNOWLEDGE_TRANSACTION_MAX_WAIT_MS = Math.max(
  2_000,
  Number(process.env.KNOWLEDGE_TRANSACTION_MAX_WAIT_MS) || 10_000,
);

const CATEGORIES = new Set(['PROCEDURE', 'MANUAL', 'PORTFOLIO']);
const AUDIENCES = new Set(['CUSTOMER', 'AGENT', 'TECHNICIAN']);
const MIME_EXTENSIONS = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function validateSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer.includes(Buffer.from('word/'));
  }
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'text/plain') return !buffer.subarray(0, 1024).includes(0);
  return false;
}

function cleanText(value) {
  return String(value || '').replace(/\u0000/g, '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function parseOcrPages(text) {
  const parts = cleanText(text).split(/\[P[ÁA]GINA\s+(\d+)\]/i);
  if (parts.length < 3) return [{ page: null, text: cleanText(text) }];
  const pages = [];
  for (let i = 1; i < parts.length; i += 2) {
    const content = cleanText(parts[i + 1]);
    if (content) pages.push({ page: Number(parts[i]), text: content });
  }
  return pages.length ? pages : [{ page: null, text: cleanText(text) }];
}

async function extractPages(buffer, mimeType, apiKey) {
  if (mimeType === 'application/pdf') {
    let parser;
    try {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      const pages = (result.pages || []).map((item) => ({ page: item.num, text: cleanText(item.text) })).filter((item) => item.text);
      const totalChars = pages.reduce((sum, item) => sum + item.text.length, 0);
      if (totalChars >= Math.max(200, pages.length * 35)) return pages;
    } catch (error) {
      console.warn('[knowledge-document] PDF sem camada textual; tentando OCR:', error.message);
    } finally {
      if (parser) await parser.destroy().catch(() => {});
    }
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return [{ page: null, text: cleanText(result.value) }];
  } else if (mimeType === 'text/plain') {
    return [{ page: null, text: cleanText(buffer.toString('utf8')) }];
  }

  if (!apiKey) throw new Error('O documento exige OCR, mas a chave do Gemini não está configurada.');
  const extracted = await geminiService.extractDocumentText(apiKey, buffer.toString('base64'), mimeType);
  if (!cleanText(extracted)) throw new Error('Não foi possível extrair texto legível do arquivo.');
  return parseOcrPages(extracted);
}

function splitLongText(text, maxLength = 3400, overlap = 350) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + maxLength, text.length);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end));
      if (boundary > cursor + Math.floor(maxLength * 0.6)) end = boundary + 1;
    }
    const content = cleanText(text.slice(cursor, end));
    if (content) chunks.push(content);
    if (end >= text.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks;
}

function chunkPages(pages) {
  const chunks = [];
  for (const page of pages) {
    for (const content of splitLongText(page.text)) {
      const firstLine = content.split('\n').find((line) => line.trim().length >= 3 && line.trim().length <= 120);
      chunks.push({
        content,
        section: firstLine ? firstLine.trim().slice(0, 150) : null,
        pageStart: page.page,
        pageEnd: page.page,
        position: chunks.length,
        tokenEstimate: Math.ceil(content.length / 4),
      });
    }
  }
  return chunks;
}

async function saveUpload(tenantId, file) {
  if (file?.path) {
    const header = Buffer.alloc(64 * 1024);
    let handle;
    try {
      handle = await fs.open(file.path, 'r');
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const headerBuffer = header.subarray(0, bytesRead);
      const zipHeader = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        && headerBuffer[0] === 0x50 && headerBuffer[1] === 0x4b && headerBuffer[2] === 0x03 && headerBuffer[3] === 0x04;
      if (!zipHeader && !validateSignature(headerBuffer, file.mimetype)) {
        throw Object.assign(new Error('O conteudo do arquivo nao corresponde ao formato informado.'), { statusCode: 415 });
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
    const directory = path.join(knowledgePath, tenantId);
    await fs.mkdir(directory, { recursive: true });
    const storageKey = path.join(tenantId, `${crypto.randomUUID()}${MIME_EXTENSIONS[file.mimetype]}`).replace(/\\/g, '/');
    const destination = path.join(knowledgePath, storageKey);
    try {
      const hash = crypto.createHash('sha256');
      const hashingTransform = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(fsSync.createReadStream(file.path), hashingTransform, fsSync.createWriteStream(destination, { flags: 'wx' }));
      await fs.unlink(file.path).catch(() => {});
      return { checksum: hash.digest('hex'), storageKey };
    } catch (error) {
      await fs.unlink(destination).catch(() => {});
      throw error;
    }
  }
  if (!validateSignature(file.buffer, file.mimetype)) throw Object.assign(new Error('O conteúdo do arquivo não corresponde ao formato informado.'), { statusCode: 415 });
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const directory = path.join(knowledgePath, tenantId);
  await fs.mkdir(directory, { recursive: true });
  const storageKey = path.join(tenantId, `${crypto.randomUUID()}${MIME_EXTENSIONS[file.mimetype]}`).replace(/\\/g, '/');
  await fs.writeFile(path.join(knowledgePath, storageKey), file.buffer, { flag: 'wx' });
  return { checksum, storageKey };
}

async function cleanupUploadFile(file) {
  if (file?.path) await fs.unlink(file.path).catch(() => {});
}

function resolveStorageKey(storageKey) {
  const root = path.resolve(knowledgePath);
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Caminho de documento inválido.');
  return resolved;
}

async function processDocument(documentId) {
  const document = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!document) return;
  await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: 'PROCESSING', processingError: null } });
  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: document.tenantId }, select: { geminiKey: true } });
    const buffer = await fs.readFile(resolveStorageKey(document.storageKey));
    const pages = await extractPages(buffer, document.mimeType, settings?.geminiKey);
    const chunks = chunkPages(pages);
    if (!chunks.length) throw new Error('O arquivo não contém texto útil para consulta.');

    for (let index = 0; index < chunks.length; index += 3) {
      const group = chunks.slice(index, index + 3);
      const embeddings = settings?.geminiKey
        ? await Promise.all(group.map((chunk) => geminiService.getEmbedding(settings.geminiKey, chunk.content).catch(() => null)))
        : group.map(() => null);
      group.forEach((chunk, offset) => { chunk.embedding = embeddings[offset] || Prisma.DbNull; });
    }

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { documentId } });
      await tx.knowledgeChunk.createMany({ data: chunks.map((chunk) => ({ ...chunk, tenantId: document.tenantId, documentId })) });
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: 'DRAFT', pageCount: pages.filter((item) => item.page !== null).length || null, chunkCount: chunks.length, processedAt: new Date(), processingError: null },
      });
    }, {
      maxWait: KNOWLEDGE_TRANSACTION_MAX_WAIT_MS,
      timeout: KNOWLEDGE_TRANSACTION_TIMEOUT_MS,
    });
  } catch (error) {
    await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: 'FAILED', processingError: String(error.message || error).slice(0, 2000) } }).catch(() => {});
    throw error;
  }
}

function queueDocumentProcessing(documentId) {
  setImmediate(() => processDocument(documentId).catch((error) => console.error('[knowledge-document] processamento falhou:', documentId, error.message)));
}

async function removeStoredFile(storageKey) {
  if (!storageKey) return;
  await fs.unlink(resolveStorageKey(storageKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

module.exports = { AUDIENCES, CATEGORIES, chunkPages, cleanupUploadFile, processDocument, queueDocumentProcessing, removeStoredFile, resolveStorageKey, saveUpload, validateSignature };
