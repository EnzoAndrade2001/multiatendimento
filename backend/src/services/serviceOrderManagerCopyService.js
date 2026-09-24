const prisma = require('../lib/prisma');
const evolution = require('./evolutionService');
const { generatePdfBuffer } = require('../controllers/osController');
const { mediaPath } = require('../utils/uploads');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let io;

function setIo(socketIo) {
  io = socketIo;
}

function valueOrDash(value) {
  const normalized = String(value || '').trim();
  return normalized || '-';
}

function buildManagerMessage(order, osType) {
  const customerName = order.contact?.crmCustomer?.name || order.contact?.name;
  const equipment = [order.equipment?.manufacturer, order.equipment?.model].filter(Boolean).join(' ');
  const location = [order.equipment?.address, order.equipment?.sector].filter(Boolean).join(' - ');
  const openedAt = new Date(order.createdAt).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return [
    '📋 *NOVA O.S. ABERTA NO ILUX WEB*',
    '',
    `*Número:* ${valueOrDash(order.externalId)}`,
    `*Cliente:* ${valueOrDash(customerName)}`,
    `*Equipamento:* ${valueOrDash(equipment)}`,
    `*Série:* ${valueOrDash(order.equipment?.serialNumber)}`,
    `*Local:* ${valueOrDash(location)}`,
    `*Tipo:* ${valueOrDash(osType?.name || order.cdOstp)}`,
    `*Defeito relatado:* ${valueOrDash(order.defect)}`,
    `*Técnico:* ${valueOrDash(order.nmsuportet)}`,
    `*Aberta por:* ${valueOrDash(order.user?.name)}`,
    `*Data:* ${openedAt}`,
  ].join('\n');
}

function safePdfFilename(order) {
  const customerName = order.contact?.crmCustomer?.name || order.contact?.name || 'CLIENTE';
  const safeCustomer = String(customerName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 80) || 'CLIENTE';
  return `OS ${valueOrDash(order.externalId)} - ${safeCustomer}.pdf`;
}

function brazilianPhoneCandidates(phone) {
  const normalized = evolution.normalizePhoneNumber(phone);
  const candidates = [normalized];

  // Cadastros brasileiros antigos podem estar sem o nono digito. A Evolution
  // pode reconhecer apenas uma das duas formas, dependendo do JID da conta.
  if (/^55\d{10}$/.test(normalized)) {
    candidates.push(`${normalized.slice(0, 4)}9${normalized.slice(4)}`);
  } else if (/^55\d{11}$/.test(normalized) && normalized[4] === '9') {
    candidates.push(`${normalized.slice(0, 4)}${normalized.slice(5)}`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function errorDetail(error) {
  const data = error?.response?.data;
  const detail = data?.response?.message || data?.message || data?.error;
  if (Array.isArray(detail)) return detail.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return String(detail || error?.message || 'Erro desconhecido ao enviar o PDF.');
}

function evolutionMessageId(result) {
  return result?.key?.id
    || result?.message?.key?.id
    || result?.data?.key?.id
    || result?.id
    || null;
}

function storedPdfFilename(displayFilename) {
  const safeName = String(displayFilename || 'ordem-de-servico.pdf')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_');
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
}

function ticketInclude() {
  return {
    contact: { include: { crmCustomer: true } },
    agent: { select: { id: true, name: true } },
    team: true,
    instance: { select: { instanceName: true } },
  };
}

async function findOrCreateManagerContact({ tenantId, instanceId, phones }) {
  const whatsappJids = phones.map((phone) => `${phone}@s.whatsapp.net`);
  let contact = await prisma.contact.findFirst({
    where: {
      tenantId,
      instanceId,
      OR: [
        { phone: { in: phones } },
        { whatsapp: { in: phones } },
        { whatsappJid: { in: whatsappJids } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (contact) return contact;

  const phone = phones[0];
  try {
    contact = await prisma.contact.create({
      data: {
        tenantId,
        instanceId,
        phone,
        whatsapp: phone,
        whatsappJid: `${phone}@s.whatsapp.net`,
        name: 'Gestor de O.S.',
        externalSource: 'manual',
      },
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    contact = await prisma.contact.findFirst({ where: { tenantId, instanceId, phone } });
  }

  if (!contact) throw new Error('Não foi possível localizar ou criar o contato do gestor.');
  return contact;
}

async function registerManagerChatMessage({
  tenantId,
  instance,
  order,
  sentTo,
  configuredPhone,
  caption,
  filename,
  storedFilename,
  externalId,
}) {
  const now = new Date();
  let message = externalId
    ? await prisma.message.findFirst({ where: { externalId } })
    : null;
  let ticket;

  // O webhook pode chegar antes da resposta da API. Se isso acontecer,
  // completamos o registro já criado em vez de duplicar a mensagem.
  if (message) {
    message = await prisma.message.update({
      where: { id: message.id },
      data: {
        body: caption,
        fromMe: true,
        mediaUrl: `/uploads/media/${storedFilename}`,
        mediaType: 'document',
        mediaStatus: 'ok',
        fileName: filename,
      },
    });
    ticket = await prisma.ticket.update({
      where: { id: message.ticketId },
      data: { lastMessageAt: now },
      include: ticketInclude(),
    });
  } else {
    const phones = [...new Set([
      sentTo,
      ...brazilianPhoneCandidates(configuredPhone),
    ].filter(Boolean))];
    const contact = await findOrCreateManagerContact({
      tenantId,
      instanceId: instance.id,
      phones,
    });

    ticket = await prisma.ticket.findFirst({
      where: { tenantId, instanceId: instance.id, contactId: contact.id },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (ticket) {
      ticket = await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'open',
          lastMessageAt: now,
          ...(!ticket.agentId && order.userId ? { agentId: order.userId } : {}),
        },
        include: ticketInclude(),
      });
    } else {
      ticket = await prisma.ticket.create({
        data: {
          tenantId,
          instanceId: instance.id,
          contactId: contact.id,
          agentId: order.userId || null,
          status: 'open',
          subject: 'Cópias de O.S.',
          lastMessageAt: now,
        },
        include: ticketInclude(),
      });
    }

    message = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        agentId: order.userId || ticket.agentId || null,
        body: caption,
        fromMe: true,
        mediaUrl: `/uploads/media/${storedFilename}`,
        mediaType: 'document',
        mediaStatus: 'ok',
        fileName: filename,
        externalId,
      },
    });
  }

  if (io) {
    io.to(tenantId).emit('new_message', {
      ticket,
      message,
      contact: ticket.contact,
      fromMe: true,
    });
    io.to(tenantId).emit('ticket_updated', { ticketId: ticket.id, ticket });
  }

  return { ticketId: ticket.id, messageId: message.id };
}

async function sendServiceOrderManagerCopy(tenantId, serviceOrderId, { force = false } = {}) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      serviceOrderManagerCopyEnabled: true,
      serviceOrderManagerPhone: true,
      serviceOrderManagerInstanceId: true,
      evolutionUrl: true,
      evolutionKey: true,
    },
  });

  if (!force && !settings?.serviceOrderManagerCopyEnabled) return { skipped: 'disabled' };
  if (!settings.serviceOrderManagerPhone || !settings.serviceOrderManagerInstanceId) {
    return { skipped: 'incomplete-settings' };
  }

  const instance = await prisma.waInstance.findFirst({
    where: { id: settings.serviceOrderManagerInstanceId, tenantId },
    select: { id: true, instanceName: true, evolutionUrl: true, evolutionKey: true },
  });
  if (!instance) throw new Error('Instância configurada para a cópia da O.S. não foi encontrada.');

  const { evolutionUrl, evolutionKey } = evolution.resolveEvolutionConfig(settings, instance);
  if (!evolutionUrl || !evolutionKey) throw new Error('Evolution API não configurada para o tenant.');

  const claimedAt = new Date();
  const claim = await prisma.serviceOrder.updateMany({
    where: {
      id: serviceOrderId,
      tenantId,
      externalId: { not: null },
      ...(!force ? { managerCopySentAt: null } : {}),
    },
    data: { managerCopySentAt: claimedAt, managerCopyLastError: null },
  });
  if (!claim.count) return { skipped: 'already-sent' };

  try {
    const order = await prisma.serviceOrder.findFirst({
      where: { id: serviceOrderId, tenantId },
      include: {
        contact: { include: { crmCustomer: { select: { name: true } } } },
        equipment: true,
        user: { select: { name: true } },
      },
    });
    if (!order) throw new Error('O.S. confirmada não encontrada para envio ao gestor.');

    const osType = order.cdOstp
      ? await prisma.crmOsType.findFirst({
        where: { tenantId, code: String(order.cdOstp) },
        select: { name: true },
      })
      : null;

    const pdf = await generatePdfBuffer(tenantId, order.id);
    if (!pdf.buffer?.length) throw new Error('O PDF da O.S. foi gerado vazio.');

    const filename = safePdfFilename(order);
    const storedFilename = storedPdfFilename(filename);
    const filePath = path.join(mediaPath, storedFilename);
    const caption = buildManagerMessage(order, osType);
    let lastError = null;
    let sentTo = null;
    let sendResult = null;

    try {
      await fs.promises.writeFile(filePath, pdf.buffer);
      const phoneCandidates = brazilianPhoneCandidates(settings.serviceOrderManagerPhone);
      for (const phone of phoneCandidates) {
        try {
          sendResult = await evolution.sendMedia(
            evolutionUrl,
            evolutionKey,
            instance.instanceName,
            phone,
            {
              mediatype: 'document',
              media: pdf.buffer.toString('base64'),
              mimetype: 'application/pdf',
              filename,
              caption,
              filePath,
            },
          );
          sentTo = phone;
          break;
        } catch (sendError) {
          lastError = sendError;
          console.warn(`[serviceOrderManagerCopy] Falha ao tentar ${require('../utils/privacy').maskPhone(phone)}: ${errorDetail(sendError)}`);
        }
      }
      if (!sentTo) throw lastError || new Error('Nenhum formato de telefone foi aceito pelo WhatsApp.');
    } catch (error) {
      await fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }

    let chatRegistered = false;
    let chatWarning = null;
    try {
      await registerManagerChatMessage({
        tenantId,
        instance,
        order,
        sentTo,
        configuredPhone: settings.serviceOrderManagerPhone,
        caption,
        filename,
        storedFilename,
        externalId: evolutionMessageId(sendResult),
      });
      chatRegistered = true;
    } catch (chatError) {
      // O WhatsApp já recebeu o PDF. Não liberamos um novo envio automático,
      // pois isso duplicaria o documento no celular do gestor.
      chatWarning = `PDF entregue no WhatsApp, mas não registrado no chat: ${errorDetail(chatError)}`.slice(0, 2000);
      await prisma.serviceOrder.updateMany({
        where: { id: serviceOrderId, tenantId, managerCopySentAt: claimedAt },
        data: { managerCopyLastError: chatWarning },
      });
      console.error(`[serviceOrderManagerCopy] ${chatWarning}`);
    }

    console.log(`[serviceOrderManagerCopy] Cópia da O.S. ${order.externalId} enviada para ${require('../utils/privacy').maskPhone(sentTo)} pela instância ${instance.instanceName}.`);
    return { sent: true, phone: sentTo, filename, chatRegistered, warning: chatWarning };
  } catch (error) {
    const detail = errorDetail(error).slice(0, 2000);
    await prisma.serviceOrder.updateMany({
      where: { id: serviceOrderId, tenantId, managerCopySentAt: claimedAt },
      data: { managerCopySentAt: null, managerCopyLastError: detail },
    });
    throw new Error(detail);
  }
}

module.exports = { sendServiceOrderManagerCopy, setIo };
