const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const whatsappComplianceService = require('./whatsappComplianceService');
const evolutionService = require('./evolutionService');
const plugBoletoService = require('./plugBoletoService');
const billingStatementService = require('./billingStatementService');
const { mediaPath } = require('../utils/uploads');

const DOCUMENT_TYPES = Object.freeze(['invoice', 'statement', 'boleto']);
const DOCUMENT_LABELS = Object.freeze({
  invoice: 'Nota Fiscal',
  statement: 'Demonstrativo',
  boleto: 'Boleto',
});
const REQUEST_ENTITY = 'billingDocumentRequest';
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_PDF_SIZE = 20 * 1024 * 1024;
const DOCUMENT_REQUEST_VERSION = 'official-v1';

let io = null;

function setIo(socketIo) {
  io = socketIo;
}

function cleanText(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function safePart(value, fallback) {
  return String(value || fallback || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 90) || fallback;
}

function requestExternalId(receivableExternalId, documentType) {
  // Version the cache so PDFs rendered by the former synthetic layouts are
  // never reused after switching to official iLux exports.
  return `${DOCUMENT_REQUEST_VERSION}:${receivableExternalId}:${documentType}`;
}

function assertDocumentType(documentType) {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    const error = new Error('Tipo de documento financeiro invalido.');
    error.statusCode = 400;
    throw error;
  }
}

function documentAvailability(receivable, type) {
  if (type === 'invoice') return Boolean(receivable.invoiceExternalId || receivable.invoiceNumber);
  if (type === 'statement') return Boolean(receivable.statementExternalId || receivable.invoiceExternalId);
  return Boolean(receivable.hasBoleto);
}

function defaultFileName(type, receivable, customerName) {
  const customer = safePart(customerName, 'CLIENTE');
  const invoice = safePart(receivable.invoiceNumber || receivable.externalId, 'SEM NUMERO');
  if (type === 'invoice') return `NF ${invoice} - ${customer}.pdf`;
  if (type === 'statement') {
    const period = safePart(receivable.billingPeriod, invoice);
    return `DEMONSTRATIVO ${period} - ${customer}.pdf`;
  }
  return `BOLETO NF ${invoice} - ${customer}.pdf`;
}

function storedFileName(displayName) {
  const safe = String(displayName || 'documento.pdf')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_');
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safe}`;
}

function publicFileExists(mediaUrl) {
  if (!cleanText(mediaUrl)) return false;
  const filename = path.basename(String(mediaUrl));
  return Boolean(filename && fs.existsSync(path.join(mediaPath, filename)));
}

function documentState(type, receivable, request, customerName) {
  const available = documentAvailability(receivable, type);
  const payload = request?.payload || {};
  const ready = payload.status === 'success' && publicFileExists(payload.mediaUrl);
  let status = available ? 'available' : 'unavailable';
  if (['pending', 'processing'].includes(payload.status)) status = payload.status;
  if (payload.status === 'failed') status = 'failed';
  if (ready) status = 'ready';
  return {
    type,
    label: DOCUMENT_LABELS[type],
    externalId: type === 'invoice'
      ? receivable.invoiceExternalId
      : type === 'statement'
        ? receivable.statementExternalId
        : receivable.boletoId,
    available,
    status,
    mediaUrl: ready ? payload.mediaUrl : null,
    fileName: ready ? payload.fileName : defaultFileName(type, receivable, customerName),
    source: ready ? (payload.source || null) : null,
    error: status === 'failed' ? cleanText(payload.error) : null,
  };
}

// Rotulo curto de origem para a UI.
const SOURCE_LABELS = Object.freeze({
  'crm-rerender': 'gerado pelo CRM',
  'ilux-export-folder': 'arquivo da pasta',
  plugboleto: 'API do banco',
});
function sourceLabel(source) {
  return SOURCE_LABELS[source] || null;
}

async function listDocumentStates({ tenantId, receivable, customerName }) {
  const ids = DOCUMENT_TYPES.map((type) => requestExternalId(receivable.externalId, type));
  const requests = await prisma.externalSyncRecord.findMany({
    where: { tenantId, source: 'crm', entity: REQUEST_ENTITY, externalId: { in: ids } },
    select: { externalId: true, payload: true },
  });
  const byId = new Map(requests.map((item) => [item.externalId, item]));
  return DOCUMENT_TYPES.map((type) => documentState(
    type,
    receivable,
    byId.get(requestExternalId(receivable.externalId, type)),
    customerName,
  ));
}

async function queueDocumentRequest({ tenantId, receivable, customerName, documentType }) {
  assertDocumentType(documentType);
  if (!documentAvailability(receivable, documentType)) {
    const error = new Error(`${DOCUMENT_LABELS[documentType]} nao esta vinculado a este titulo no iLux.`);
    error.statusCode = 409;
    throw error;
  }

  const externalId = requestExternalId(receivable.externalId, documentType);
  const existing = await prisma.externalSyncRecord.findFirst({
    where: { tenantId, source: 'crm', entity: REQUEST_ENTITY, externalId },
    select: { id: true, payload: true },
  });
  if (existing?.payload?.status === 'success' && publicFileExists(existing.payload.mediaUrl)) return existing;

  return prisma.externalSyncRecord.upsert({
    where: {
      tenantId_source_entity_externalId: { tenantId, source: 'crm', entity: REQUEST_ENTITY, externalId },
    },
    update: {
      payload: {
        status: 'pending',
        requestedAt: new Date().toISOString(),
        receivableExternalId: String(receivable.externalId),
        documentType,
        invoiceNumber: receivable.invoiceNumber,
        invoiceExternalId: receivable.invoiceExternalId,
        statementExternalId: receivable.statementExternalId,
        customerName,
        receivableValue: Number.isFinite(receivable.value) ? receivable.value : (Number.isFinite(receivable.openValue) ? receivable.openValue : null),
        fileName: defaultFileName(documentType, receivable, customerName),
      },
    },
    create: {
      tenantId,
      source: 'crm',
      entity: REQUEST_ENTITY,
      externalId,
      payload: {
        status: 'pending',
        requestedAt: new Date().toISOString(),
        receivableExternalId: String(receivable.externalId),
        documentType,
        invoiceNumber: receivable.invoiceNumber,
        invoiceExternalId: receivable.invoiceExternalId,
        statementExternalId: receivable.statementExternalId,
        customerName,
        receivableValue: Number.isFinite(receivable.value) ? receivable.value : (Number.isFinite(receivable.openValue) ? receivable.openValue : null),
        fileName: defaultFileName(documentType, receivable, customerName),
      },
    },
    select: { id: true, externalId: true, payload: true },
  });
}

async function waitForDocument(requestId, timeoutMs = REQUEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await prisma.externalSyncRecord.findUnique({
      where: { id: requestId },
      select: { payload: true },
    });
    if (current?.payload?.status === 'success' && publicFileExists(current.payload.mediaUrl)) {
      return current.payload;
    }
    if (current?.payload?.status === 'failed') {
      const error = new Error(current.payload.error || 'Nao foi possivel recuperar o documento no iLux.');
      error.statusCode = 502;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const error = new Error('O agente do iLux nao devolveu o documento no tempo esperado. Confirme se ele esta atualizado e em execucao.');
  error.statusCode = 504;
  throw error;
}

// Boleto: tenta buscar o PDF direto no PlugBoleto antes de enfileirar o pedido
// para o agente. Sucesso -> grava no mesmo registro que o callback do agente
// gravaria (cache/painel/reenvio seguem iguais). Falha -> nao marca "failed",
// deixa o fluxo cair para o agente (pasta / PlugBoleto via agente).
async function tryPlugBoletoDirect(request, params) {
  if (params.documentType !== 'boleto') return false;
  if (!plugBoletoService.isBoletoPrintable(params.receivable)) return false;
  try {
    const result = await plugBoletoService.fetchBoletoPdf({
      tenantId: params.tenantId,
      receivable: params.receivable,
      customerName: params.customerName,
    });
    await completeDocumentRequest({ request, success: true, result });
    return true;
  } catch (error) {
    if (error?.statusCode !== 501) {
      console.warn('[plugboleto] busca direta falhou, caindo para o agente:', error.message);
    }
    return false;
  }
}

// Demonstrativo: quando o tenant tem statementRerenderEnabled e o demonstrativo
// ja foi sincronizado (CrmBillingStatement), o CRM gera o PDF a partir desses
// valores -- sem a pasta monitorada e sem round-trip com o agente. 501 (flag
// off / nao sincronizado) ou qualquer falha -> deixa cair para o agente/pasta.
async function tryStatementRerender(request, params) {
  if (params.documentType !== 'statement') return false;
  try {
    const result = await billingStatementService.renderStatementPdf({
      tenantId: params.tenantId,
      receivable: params.receivable,
      customerName: params.customerName,
    });
    await completeDocumentRequest({ request, success: true, result });
    return true;
  } catch (error) {
    if (error?.statusCode !== 501) {
      console.warn('[statement-rerender] falhou, caindo para o agente:', error.message);
    }
    return false;
  }
}

async function getOrRequestDocument(params) {
  const request = await queueDocumentRequest(params);
  const alreadyDone = request.payload?.status === 'success' && publicFileExists(request.payload.mediaUrl);
  if (!alreadyDone) {
    await tryPlugBoletoDirect(request, params);
    await tryStatementRerender(request, params);
  }
  const fresh = alreadyDone
    ? request
    : await prisma.externalSyncRecord.findUnique({ where: { id: request.id }, select: { payload: true } });
  const payload = fresh?.payload?.status === 'success' && publicFileExists(fresh.payload.mediaUrl)
    ? fresh.payload
    : await waitForDocument(request.id);
  return {
    type: params.documentType,
    status: 'ready',
    mediaUrl: payload.mediaUrl,
    fileName: payload.fileName || defaultFileName(params.documentType, params.receivable, params.customerName),
    mimeType: payload.mimeType || 'application/pdf',
    source: payload.source || null,
    sourceLabel: sourceLabel(payload.source),
  };
}

function validatePdfResult(result) {
  if (!result?.pdfBase64) throw new Error('O agente nao devolveu o PDF solicitado.');
  const pdf = Buffer.from(String(result.pdfBase64), 'base64');
  if (!pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('O agente devolveu um arquivo PDF invalido.');
  if (pdf.length > MAX_PDF_SIZE) throw new Error('O PDF excedeu o limite de 20 MB.');
  return pdf;
}

async function completeDocumentRequest({ request, success, result, error }) {
  // O agente repete callbacks quando a confirmacao HTTP se perde. Depois que
  // um PDF valido foi persistido, a repeticao nao pode substituir o sucesso
  // por falha nem deixar arquivos duplicados no servidor.
  if (request.payload?.status === 'success' && publicFileExists(request.payload.mediaUrl)) return;
  if (!success) {
    await prisma.externalSyncRecord.update({
      where: { id: request.id },
      data: { payload: { ...request.payload, status: 'failed', completedAt: new Date().toISOString(), error: String(error || 'Nao foi possivel recuperar o documento.') } },
    });
    return;
  }

  if (result?.documentType && result.documentType !== request.payload.documentType) {
    throw new Error('O agente devolveu um tipo de documento diferente do solicitado.');
  }
  const pdf = validatePdfResult(result);
  const displayName = path.basename(String(result.fileName || request.payload.fileName || 'documento.pdf'));
  const filename = storedFileName(displayName);
  await fs.promises.writeFile(path.join(mediaPath, filename), pdf);
  await prisma.externalSyncRecord.update({
    where: { id: request.id },
    data: {
      payload: {
        ...request.payload,
        status: 'success',
        completedAt: new Date().toISOString(),
        mediaUrl: `/uploads/media/${filename}`,
        fileName: displayName,
        mimeType: result.mimeType || 'application/pdf',
        // De onde saiu o PDF: 'ilux-export-folder' (pasta monitorada do agente),
        // 'crm-rerender' (demonstrativo gerado pelo CRM), 'plugboleto' (boleto
        // direto pela API). Fica visível no modal de documentos da cobranca.
        source: result.source || request.payload.source || null,
        sha256: result.sha256 || null,
        // Auditoria de divergencia (pasta): amountOk = o valor do titulo aparece
        // no texto do PDF casado; matchScore = confianca do matcher do agente.
        amountOk: typeof result.amountOk === 'boolean' ? result.amountOk : null,
        matchScore: Number.isFinite(result.matchScore) ? result.matchScore : null,
        receivableValue: Number.isFinite(result.receivableValue)
          ? result.receivableValue
          : (Number.isFinite(request.payload.receivableValue) ? request.payload.receivableValue : null),
      },
    },
  });
}

// Um pedido de documento que falhou (ex.: agente ainda não tinha indexado o
// PDF no momento) ficava parado em "failed" para sempre - nada pedia pro
// agente tentar de novo sem um clique manual do usuário, mesmo que o arquivo
// já estivesse disponível há horas. Reenfileira automaticamente pedidos
// falhos "maduros" (tempo suficiente para o agente já ter reindexado as
// pastas) até um limite de tentativas, sem exigir nenhuma ação do usuário.
const AUTO_RETRY_COOLDOWN_MS = 15 * 60 * 1000; // dá tempo de sobra pro ciclo de indexação (padrão 300s) já ter rodado
const AUTO_RETRY_MAX_ATTEMPTS = 12; // ~3h tentando sozinho antes de exigir ação manual

async function retryFailedDocumentRequests() {
  const cutoff = new Date(Date.now() - AUTO_RETRY_COOLDOWN_MS).toISOString();
  const candidates = await prisma.externalSyncRecord.findMany({
    where: {
      source: 'crm',
      entity: REQUEST_ENTITY,
      payload: { path: ['status'], equals: 'failed' },
    },
    select: { id: true, payload: true },
  });

  let requeued = 0;
  for (const record of candidates) {
    const payload = record.payload || {};
    if (!payload.completedAt || payload.completedAt > cutoff) continue; // ainda dentro do periodo de espera
    const attempts = payload.autoRetryCount || 0;
    if (attempts >= AUTO_RETRY_MAX_ATTEMPTS) continue; // desistiu sozinho; precisa de retentativa manual do usuario

    await prisma.externalSyncRecord.update({
      where: { id: record.id },
      data: {
        payload: {
          ...payload,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          autoRetryCount: attempts + 1,
        },
      },
    });
    requeued++;
  }

  if (requeued > 0) {
    console.log(`[billing-documents] ${requeued} documento(s) com falha reenfileirado(s) automaticamente para nova tentativa.`);
  }
  return requeued;
}

function evolutionMessageId(result) {
  return result?.key?.id || result?.message?.key?.id || result?.data?.key?.id || result?.id || null;
}

async function resolveDelivery({ tenantId, customerId, ticketId }) {
  const where = {
    tenantId,
    contact: { crmCustomerId: customerId },
    instanceId: { not: null },
  };
  if (ticketId) where.id = ticketId;
  const ticket = await prisma.ticket.findFirst({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    include: { contact: true, instance: true },
  });
  if (!ticket) return null;
  const phone = evolutionService.normalizePhoneNumber(ticket.contact.whatsapp || ticket.contact.phone || '');
  const instanceConnected = ['connected', 'open'].includes(String(ticket.instance?.status || '').toLowerCase());
  return {
    available: Boolean(phone && ticket.instance?.instanceName && instanceConnected),
    ticketId: ticket.id,
    contactId: ticket.contactId,
    contactName: ticket.contact.name,
    phone,
    instanceId: ticket.instanceId,
    instanceName: ticket.instance?.instanceName || null,
    instanceStatus: ticket.instance?.status || null,
    instanceProvider: ticket.instance?.provider || null,
    unavailableReason: !phone
      ? 'Telefone WhatsApp invalido.'
      : !ticket.instance?.instanceName
        ? 'Conversa sem instancia de saida.'
        : !instanceConnected
          ? 'A instancia desta conversa esta desconectada.'
          : null,
  };
}

function billingCaption(receivable, customerName) {
  return `Documentos da cobranca - NF ${receivable.invoiceNumber || receivable.externalId} - ${customerName}`;
}

async function sendDocuments({ tenantId, userId, customer, receivable, documentTypes, ticketId }) {
  const uniqueTypes = [...new Set(documentTypes || [])];
  if (!uniqueTypes.length) {
    const error = new Error('Selecione ao menos um documento para reenviar.');
    error.statusCode = 400;
    throw error;
  }
  uniqueTypes.forEach(assertDocumentType);

  const delivery = await resolveDelivery({ tenantId, customerId: customer.id, ticketId });
  if (!delivery?.available) {
    const error = new Error('Este cliente nao possui uma conversa WhatsApp com instancia valida.');
    error.statusCode = 409;
    throw error;
  }
  await whatsappComplianceService.assertAutomatedSendAllowed({
    tenantId,
    contactId: delivery.contactId,
    instance: {
      id: delivery.instanceId,
      instanceName: delivery.instanceName,
      status: delivery.instanceStatus,
      provider: delivery.instanceProvider,
    },
  });

  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
  const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;
  if (!evolutionUrl || !evolutionKey) throw new Error('Evolution API nao configurada para o tenant.');

  const customerName = customer.fantasyName || customer.name;
  const documents = await Promise.all(uniqueTypes.map((documentType) => getOrRequestDocument({
    tenantId,
    receivable,
    customerName,
    documentType,
  })));
  const sent = [];
  const caption = billingCaption(receivable, customerName);
  let updatedTicket = null;
  let firstMediaMessageId = null;

  try {
    for (const document of documents) {
      const filePath = path.join(mediaPath, path.basename(document.mediaUrl));
      const base64 = (await fs.promises.readFile(filePath)).toString('base64');
      const result = await evolutionService.sendMedia(
        evolutionUrl,
        evolutionKey,
        delivery.instanceName,
        delivery.phone,
        {
          mediatype: 'document',
          media: base64,
          mimetype: document.mimeType,
          filename: document.fileName,
          caption,
          filePath,
        },
      );
      const message = await prisma.message.create({
        data: {
          ticketId: delivery.ticketId,
          agentId: userId || null,
          body: caption,
          fromMe: true,
          mediaUrl: document.mediaUrl,
          mediaType: 'document',
          mediaStatus: 'ok',
          fileName: document.fileName,
          externalId: evolutionMessageId(result),
        },
      });
      if (!firstMediaMessageId) firstMediaMessageId = evolutionMessageId(result) || null;
      sent.push({ ...document, messageId: message.id });
      updatedTicket = await prisma.ticket.update({
        where: { id: delivery.ticketId },
        data: { lastMessageAt: new Date() },
        include: {
          contact: { include: { crmCustomer: true } },
          agent: { select: { id: true, name: true } },
          team: true,
          instance: true,
        },
      });
      if (io) {
        io.to(tenantId).emit('new_message', {
          ticket: updatedTicket,
          message,
          contact: updatedTicket.contact,
          fromMe: true,
        });
        io.to(tenantId).emit('ticket_updated', { ticketId: updatedTicket.id, ticket: updatedTicket });
      }
    }

    await prisma.$transaction([
      prisma.ticketEvent.create({
        data: {
          ticketId: delivery.ticketId,
          tenantId,
          userId: userId || null,
          type: 'billing_documents_resent',
          payload: JSON.stringify({ receivableExternalId: receivable.externalId, invoiceNumber: receivable.invoiceNumber, documentTypes: uniqueTypes, phone: delivery.phone, instanceId: delivery.instanceId }),
        },
      }),
      prisma.billingLog.create({
        data: { tenantId, cpfCnpj: customer.cpfCnpj, clientName: customerName, fileName: sent.map((item) => item.fileName).join(', '), status: 'SUCCESS', messageId: firstMediaMessageId, deliveryStatus: 'sent' },
      }),
    ]);

    return { success: true, ...delivery, documents: sent };
  } catch (error) {
    const partialDetail = sent.length
      ? `${sent.length} de ${documents.length} documento(s) foram enviados antes da falha. Nao repita o pacote completo; reenvie apenas os documentos restantes.`
      : null;
    await prisma.billingLog.create({
      data: {
        tenantId,
        cpfCnpj: customer.cpfCnpj,
        clientName: customerName,
        fileName: documents.map((item) => item.fileName).join(', '),
        status: 'FAILED',
        errorMessage: `${error.message}${partialDetail ? ` ${partialDetail}` : ''}`,
      },
    }).catch(() => {});
    if (partialDetail) {
      const partialError = new Error(`${error.message} ${partialDetail}`);
      partialError.statusCode = error.statusCode || error.response?.status || 502;
      throw partialError;
    }
    throw error;
  }
}

module.exports = {
  DOCUMENT_TYPES,
  REQUEST_ENTITY,
  setIo,
  listDocumentStates,
  queueDocumentRequest,
  getOrRequestDocument,
  completeDocumentRequest,
  retryFailedDocumentRequests,
  resolveDelivery,
  sendDocuments,
  sourceLabel,
  _private: {
    assertDocumentType,
    documentAvailability,
    defaultFileName,
    requestExternalId,
  },
};
