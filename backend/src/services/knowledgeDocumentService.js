const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const geminiService = require('./geminiService');
const { knowledgePath } = require('../utils/uploads');

function integerSetting(name, fallback, minimum) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

const KNOWLEDGE_WORKER_TIMEOUT_MS = integerSetting('KNOWLEDGE_WORKER_TIMEOUT_MS', 20 * 60 * 1000, 60_000);
const KNOWLEDGE_WORKER_HEAP_MB = integerSetting('KNOWLEDGE_WORKER_HEAP_MB', 512, 256);
const KNOWLEDGE_WORKER_RSS_MB = integerSetting('KNOWLEDGE_WORKER_RSS_MB', 768, 384);
const KNOWLEDGE_PDF_PAGE_BATCH_SIZE = integerSetting('KNOWLEDGE_PDF_PAGE_BATCH_SIZE', 12, 1);
const KNOWLEDGE_OCR_MAX_BYTES = integerSetting('KNOWLEDGE_OCR_MAX_BYTES', 20 * 1024 * 1024, 1024 * 1024);
const KNOWLEDGE_MAX_EXTRACTED_CHARS = integerSetting('KNOWLEDGE_MAX_EXTRACTED_CHARS', 12_000_000, 100_000);
const KNOWLEDGE_MAX_CHUNKS = integerSetting('KNOWLEDGE_MAX_CHUNKS', 2500, 100);
const KNOWLEDGE_CHUNK_BATCH_SIZE = integerSetting('KNOWLEDGE_CHUNK_BATCH_SIZE', 100, 10);
const KNOWLEDGE_QUEUE_LIMIT = integerSetting('KNOWLEDGE_QUEUE_LIMIT', 20, 1);
const PROCESSING_FALLBACK_ERROR = 'O processamento foi interrompido por limite de segurança. O arquivo original foi preservado e pode ser reprocessado.';

const processingQueue = [];
const queuedDocumentIds = new Set();
let activeWorker = null;

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

function buildPdfPageRanges(pageCount, batchSize = KNOWLEDGE_PDF_PAGE_BATCH_SIZE) {
  const ranges = [];
  const total = Math.max(0, Number.parseInt(pageCount, 10) || 0);
  const size = Math.max(1, Number.parseInt(batchSize, 10) || KNOWLEDGE_PDF_PAGE_BATCH_SIZE);
  for (let first = 1; first <= total; first += size) {
    ranges.push({ first, last: Math.min(total, first + size - 1) });
  }
  return ranges;
}

async function usePdfParser(buffer, callback) {
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    return await callback(parser);
  } finally {
    if (parser) await parser.destroy().catch(() => {});
    // O worker e iniciado com --expose-gc. Liberar caches/fontes do pdf.js entre
    // lotes evita que manuais extensos acumulem centenas de MB ate o fim.
    if (typeof global.gc === 'function') global.gc();
  }
}

async function extractPdfPagesInBatches(buffer, batchSize = KNOWLEDGE_PDF_PAGE_BATCH_SIZE) {
  const info = await usePdfParser(buffer, (parser) => parser.getInfo());
  const pageCount = Number(info?.total || 0);
  if (!pageCount) throw new Error('O PDF nao possui paginas legiveis.');

  const pages = [];
  let totalChars = 0;
  for (const range of buildPdfPageRanges(pageCount, batchSize)) {
    const result = await usePdfParser(buffer, (parser) => parser.getText(range));
    for (const item of result.pages || []) {
      const text = cleanText(item.text);
      if (!text) continue;
      totalChars += text.length;
      if (totalChars > KNOWLEDGE_MAX_EXTRACTED_CHARS) {
        const error = new Error('O documento possui conteudo demais para uma unica indexacao. Divida o manual em volumes menores.');
        error.publicMessage = true;
        throw error;
      }
      pages.push({ page: item.num, text });
    }
  }
  return { pageCount, pages };
}

async function extractPages(buffer, mimeType, apiKey) {
  if (mimeType === 'application/pdf') {
    try {
      const extracted = await extractPdfPagesInBatches(buffer);
      const totalChars = extracted.pages.reduce((sum, item) => sum + item.text.length, 0);
      if (totalChars >= Math.max(200, extracted.pageCount * 35)) return extracted.pages;
    } catch (error) {
      if (error.publicMessage) throw error;
      console.warn('[knowledge-document] PDF sem camada textual; tentando OCR:', error.message);
    }
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return [{ page: null, text: cleanText(result.value) }];
  } else if (mimeType === 'text/plain') {
    return [{ page: null, text: cleanText(buffer.toString('utf8')) }];
  }

  if (!apiKey) throw new Error('O documento exige OCR, mas a chave do Gemini não está configurada.');
  if (buffer.length > KNOWLEDGE_OCR_MAX_BYTES) {
    const limitMb = Math.floor(KNOWLEDGE_OCR_MAX_BYTES / 1024 / 1024);
    const error = new Error(`O arquivo não possui texto pesquisável e excede o limite seguro de ${limitMb} MB para OCR. Envie um PDF pesquisável ou divida o manual em partes menores.`);
    error.publicMessage = true;
    throw error;
  }
  const extracted = await geminiService.extractDocumentText(apiKey, buffer.toString('base64'), mimeType);
  if (!cleanText(extracted)) throw new Error('Não foi possível extrair texto legível do arquivo.');
  return parseOcrPages(extracted);
}

function formatProcessingError(error) {
  if (error?.publicMessage) return String(error.message).slice(0, 500);
  const message = String(error?.message || error || '');
  if (/texto .*til|texto leg.vel|exige OCR|PDF pesquis.vel|divida o manual/i.test(message)) return message.slice(0, 500);
  if (/timeout|transaction|heap|memory|alloc|closed|expired|createMany/i.test(message)) return PROCESSING_FALLBACK_ERROR;
  return 'Não foi possível processar este documento com segurança. O arquivo original foi preservado para nova tentativa.';
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
    const totalChars = pages.reduce((sum, item) => sum + String(item.text || '').length, 0);
    if (totalChars > KNOWLEDGE_MAX_EXTRACTED_CHARS) {
      const error = new Error('O documento possui conteúdo demais para uma única indexação. Divida o manual em volumes menores.');
      error.publicMessage = true;
      throw error;
    }
    const chunks = chunkPages(pages);
    if (chunks.length > KNOWLEDGE_MAX_CHUNKS) {
      const error = new Error(`O documento gerou mais de ${KNOWLEDGE_MAX_CHUNKS} trechos. Divida o manual em volumes menores.`);
      error.publicMessage = true;
      throw error;
    }
    if (!chunks.length) throw new Error('O arquivo não contém texto útil para consulta.');

    for (let index = 0; index < chunks.length; index += 3) {
      const group = chunks.slice(index, index + 3);
      const embeddings = settings?.geminiKey
        ? await Promise.all(group.map((chunk) => geminiService.getEmbedding(settings.geminiKey, chunk.content).catch(() => null)))
        : group.map(() => null);
      group.forEach((chunk, offset) => { chunk.embedding = embeddings[offset] || Prisma.DbNull; });
    }

    // Sem $transaction interativa: com manuais grandes (milhares de chunks com
    // vetor de embedding) a transacao segurava o lote inteiro e o worker
    // estourava o teto de RSS. Gravamos em lotes soltos, liberando memoria
    // entre eles; um crash no meio deixa o doc em PROCESSING (recuperado como
    // FAILED no boot) e o proximo reprocesso limpa os chunks parciais.
    await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
    for (let index = 0; index < chunks.length; index += KNOWLEDGE_CHUNK_BATCH_SIZE) {
      const batch = chunks.slice(index, index + KNOWLEDGE_CHUNK_BATCH_SIZE);
      await prisma.knowledgeChunk.createMany({ data: batch.map((chunk) => ({ ...chunk, tenantId: document.tenantId, documentId })) });
      if (typeof global.gc === 'function') global.gc();
    }
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: 'DRAFT', pageCount: pages.filter((item) => item.page !== null).length || null, chunkCount: chunks.length, processedAt: new Date(), processingError: null },
    });
  } catch (error) {
    console.error('[knowledge-document] falha interna:', documentId, error?.stack || error);
    await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: 'FAILED', processingError: formatProcessingError(error) } }).catch(() => {});
    throw error;
  }
}

async function markWorkerFailure(documentId, message = PROCESSING_FALLBACK_ERROR) {
  await prisma.knowledgeDocument.updateMany({
    where: { id: documentId, status: 'PROCESSING' },
    data: { status: 'FAILED', processingError: message },
  }).catch((error) => console.error('[knowledge-document] falha ao registrar interrupcao:', error.message));
}

function startNextWorker() {
  if (activeWorker || !processingQueue.length) return;
  const documentId = processingQueue.shift();
  const workerPath = path.join(__dirname, '..', 'workers', 'knowledgeDocumentWorker.js');
  const child = spawn(process.execPath, ['--expose-gc', `--max-old-space-size=${KNOWLEDGE_WORKER_HEAP_MB}`, workerPath, documentId], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, KNOWLEDGE_DOCUMENT_WORKER: '1' },
  });
  const worker = { child, documentId, timedOut: false, memoryExceeded: false, memoryGuardBusy: false, timer: null, memoryGuard: null };
  activeWorker = worker;
  worker.timer = setTimeout(() => {
    worker.timedOut = true;
    console.error('[knowledge-document] worker excedeu o tempo:', documentId);
    child.kill('SIGKILL');
  }, KNOWLEDGE_WORKER_TIMEOUT_MS);
  if (process.platform === 'linux') {
    worker.memoryGuard = setInterval(async () => {
      if (worker.memoryGuardBusy || activeWorker !== worker) return;
      worker.memoryGuardBusy = true;
      try {
        const status = await fs.readFile(`/proc/${child.pid}/status`, 'utf8');
        const rssKb = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0);
        if (rssKb > KNOWLEDGE_WORKER_RSS_MB * 1024) {
          worker.memoryExceeded = true;
          console.error('[knowledge-document] worker excedeu memoria RSS:', { documentId, rssMb: Math.round(rssKb / 1024) });
          child.kill('SIGKILL');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[knowledge-document] falha no vigia de memoria:', error.message);
      } finally {
        worker.memoryGuardBusy = false;
      }
    }, 2000);
  }

  const finish = async (code, signal) => {
    if (activeWorker !== worker) return;
    clearTimeout(worker.timer);
    if (worker.memoryGuard) clearInterval(worker.memoryGuard);
    activeWorker = null;
    queuedDocumentIds.delete(documentId);
    if (worker.timedOut || code !== 0) {
      console.error('[knowledge-document] worker encerrado:', { documentId, code, signal });
      const failureMessage = worker.memoryExceeded
        ? `O manual excedeu o limite seguro de ${KNOWLEDGE_WORKER_RSS_MB} MB durante a indexação. O arquivo original foi preservado; envie uma versão pesquisável ou divida-o em partes.`
        : PROCESSING_FALLBACK_ERROR;
      await markWorkerFailure(documentId, failureMessage);
    }
    setImmediate(startNextWorker);
  };
  child.once('error', (error) => {
    console.error('[knowledge-document] nao foi possivel iniciar worker:', error.message);
    finish(-1, 'spawn-error').catch(console.error);
  });
  child.once('exit', (code, signal) => { finish(code, signal).catch(console.error); });
}

function queueDocumentProcessing(documentId) {
  const normalized = String(documentId || '').trim();
  if (!normalized || queuedDocumentIds.has(normalized)) return false;
  if (processingQueue.length >= KNOWLEDGE_QUEUE_LIMIT) return false;
  queuedDocumentIds.add(normalized);
  processingQueue.push(normalized);
  setImmediate(startNextWorker);
  return true;
}

async function recoverInterruptedDocuments(bootAt = new Date()) {
  const result = await prisma.knowledgeDocument.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: bootAt } },
    data: { status: 'FAILED', processingError: 'O servidor foi reiniciado durante o processamento. O arquivo original foi preservado; clique em Reprocessar.' },
  });
  if (result.count) console.warn(`[knowledge-document] ${result.count} processamento(s) interrompido(s) recuperado(s).`);
  return result.count;
}

async function removeStoredFile(storageKey) {
  if (!storageKey) return;
  await fs.unlink(resolveStorageKey(storageKey)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

module.exports = { AUDIENCES, CATEGORIES, buildPdfPageRanges, chunkPages, cleanupUploadFile, extractPdfPagesInBatches, formatProcessingError, processDocument, queueDocumentProcessing, recoverInterruptedDocuments, removeStoredFile, resolveStorageKey, saveUpload, validateSignature };
