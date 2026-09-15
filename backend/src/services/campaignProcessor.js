const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');
const path = require('path');
const fs = require('fs');
const { uploadsPath } = require('../utils/uploads');

let io;
const active = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function messageId(result) {
  return result?.key?.id || result?.message?.key?.id || result?.data?.key?.id || null;
}

function detail(error) {
  const data = error?.response?.data;
  const value = data?.response?.message || data?.message || data?.error || error?.message;
  if (Array.isArray(value)) return value.map(detail).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value || 'Erro desconhecido');
}

/**
 * Prospecção usa o mesmo destinatário persistente de Campaign, mas não cria
 * Contact/Ticket.  O vínculo com o registro Lead fica no metadata para que o
 * worker possa atualizar o histórico do lead sem acoplar o modelo de CRM.
 *
 * O helper devolve null para campanhas antigas ou destinatários comuns, de
 * modo que o caminho de campanhas existentes permaneça exatamente igual.
 */
function leadSource(recipient) {
  const rawMetadata = recipient?.metadata;
  const metadata = rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
    ? rawMetadata
    : {};
  // New recipients can use the relation field; metadata keeps compatibility
  // with campaigns created before CampaignRecipient.leadId was introduced.
  const sourceLeadId = recipient?.leadId || metadata.sourceLeadId || metadata.leadId;
  const source = String(metadata.source || '').toUpperCase();
  if (source !== 'LEAD' && !recipient?.leadId) return null;
  if (!sourceLeadId) return null;
  return { id: String(sourceLeadId), metadata };
}

function leadAttemptMetadata(recipient, { status, externalId = null, error = null, at = new Date() }) {
  const source = leadSource(recipient);
  if (!source) return null;
  return {
    ...source.metadata,
    source: 'LEAD',
    sourceLeadId: source.id,
    // Mantém os campos de auditoria no recipient mesmo que o Lead seja
    // removido enquanto uma campanha estiver em execução.
    leadStatus: status,
    leadExternalId: externalId || null,
    leadError: error || null,
    leadLastAttemptAt: at.toISOString(),
  };
}

async function syncLeadSuccess(campaign, recipient, sentAt) {
  const source = leadSource(recipient);
  if (!source) return;
  try {
    // updateMany evita transformar a entrega em falha se o lead foi removido
    // depois da criação da campanha. O tenant também impede cruzamento entre
    // bases quando um id antigo for reutilizado em outra empresa.
    await prisma.lead.updateMany({
      where: { id: source.id, tenantId: campaign.tenantId },
      data: { sentAt, sentCount: { increment: 1 } },
    });
  } catch (error) {
    // A entrega já foi confirmada no CampaignRecipient. Não reenvie apenas
    // porque a atualização auxiliar do lead falhou; a próxima consulta de
    // auditoria ainda terá o externalId/status/erro no recipient.
    console.warn(`[campaign] não foi possível atualizar o lead ${source.id}:`, detail(error));
  }
}

function parseHour(value, fallback) {
  const [h, m] = String(value || fallback).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : fallback * 60;
}

function isQuietHours(date, start, end) {
  if (start == null || end == null) return false;
  const minute = date.getHours() * 60 + date.getMinutes();
  const from = parseHour(start, 20);
  const to = parseHour(end, 8);
  if (from === to) return false;
  return from > to ? minute >= from || minute < to : minute >= from && minute < to;
}

async function emitProgress(campaignId, tenantId) {
  if (!io) return;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true, total: true, sent: true, failed: true, skipped: true, delivered: true } });
  if (campaign) {
    const pending = Math.max(0, campaign.total - campaign.sent - campaign.delivered - campaign.failed - campaign.skipped);
    io.to(tenantId).emit('campaign_progress', { campaignId, ...campaign, pending });
  }
  // Compatibilidade com o evento usado pela primeira tela de disparo.
  if (campaign) io.to(tenantId).emit('bulk_progress', { campaignId, total: campaign.total, sent: campaign.sent + campaign.delivered, errors: campaign.failed, status: campaign.status.toLowerCase() });
}

async function recompute(campaignId) {
  const groups = await prisma.campaignRecipient.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } });
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  const data = {
    total: Object.values(counts).reduce((a, b) => a + b, 0), sent: counts.SENT || 0, delivered: counts.DELIVERED || 0,
    failed: counts.FAILED || 0, skipped: counts.SKIPPED || 0,
  };
  return prisma.campaign.update({ where: { id: campaignId }, data });
}

async function claimNext(campaignId) {
  const stale = new Date(Date.now() - 15 * 60 * 1000);
  await prisma.campaignRecipient.updateMany({ where: { campaignId, status: 'SENDING', lastAttemptAt: { lt: stale } }, data: { status: 'PENDING' } });
  const next = await prisma.campaignRecipient.findFirst({ where: { campaignId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
  if (!next) return null;
  const claimed = await prisma.campaignRecipient.updateMany({ where: { id: next.id, status: 'PENDING' }, data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: new Date() } });
  return claimed.count ? prisma.campaignRecipient.findUnique({ where: { id: next.id }, include: { campaign: { include: { tenant: { include: { settings: true } }, instance: true } }, contact: true } }) : null;
}

async function processCampaign(campaignId) {
  if (!campaignId || active.has(campaignId)) return;
  active.add(campaignId);
  try {
    let campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, include: { tenant: { include: { settings: true } }, instance: true } });
    if (!campaign) return;
    if (campaign.scheduledAt && campaign.scheduledAt > new Date()) return;
    if (['COMPLETED', 'CANCELLED'].includes(campaign.status)) return;
    const instanceState = String(campaign.instance?.status || '').toLowerCase();
    if (!campaign.instance || !['connected', 'open', 'online'].includes(instanceState)) {
      // Agendamentos aguardam a reconexao em vez de consumir a fila com
      // falhas artificiais. O proximo ciclo tenta novamente.
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'QUEUED', lastError: 'A instancia de saida esta desconectada. Aguardando reconexao.' } });
      return;
    }
    if (!evolutionService.resolveEvolutionConfig(campaign.tenant?.settings, campaign.instance).evolutionUrl) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'FAILED', lastError: 'Instância de saída ou Evolution API não configurada.' } });
      return;
    }
    // Campanha é sempre mensagem proativa. Na API oficial isso exige template
    // aprovado pela Meta — ainda não suportado por aqui, então falha fechado.
    if (campaign.instance?.provider === 'evolution_official') {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'FAILED', lastError: 'Campanhas em instância oficial (API Meta) exigem template aprovado e ainda não são suportadas. Use uma conexão QR Code.' },
      });
      return;
    }
    // Um processo anterior pode ter sido interrompido entre a reserva do
    // destinatário e o envio. Após um reinício, devolve reservas antigas à
    // fila; reservas recentes continuam protegidas contra duplicação.
    if (campaign.status === 'RUNNING' && campaign.updatedAt < new Date(Date.now() - 60 * 1000)) {
      await prisma.campaignRecipient.updateMany({ where: { campaignId: campaign.id, status: 'SENDING', lastAttemptAt: { lt: new Date(Date.now() - 60 * 1000) } }, data: { status: 'PENDING' } });
    }
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'RUNNING', startedAt: campaign.startedAt || new Date(), lastError: null } });
    await emitProgress(campaign.id, campaign.tenantId);
    while (true) {
      campaign = await prisma.campaign.findUnique({ where: { id: campaign.id }, include: { tenant: { include: { settings: true } }, instance: true } });
      if (!campaign || campaign.cancelRequested || campaign.status === 'CANCELLED') {
        if (campaign && campaign.status !== 'CANCELLED') await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
        break;
      }
      if (campaign.status === 'PAUSED') break;
      if (isQuietHours(new Date(), campaign.quietHoursStart, campaign.quietHoursEnd)) { await sleep(30000); continue; }
      const recipient = await claimNext(campaign.id);
      if (!recipient) {
        const pending = await prisma.campaignRecipient.count({ where: { campaignId: campaign.id, status: { in: ['PENDING', 'SENDING'] } } });
        if (!pending) {
          await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        }
        break;
      }
      if (recipient.contact?.whatsappOptOutAt) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: 'SKIPPED', reason: 'opt_out', errorMessage: 'Contato optou por não receber mensagens.' },
        });
        await recompute(campaign.id);
        await emitProgress(campaign.id, campaign.tenantId);
        continue;
      }
      try {
        let result;
        const { evolutionUrl, evolutionKey } = evolutionService.resolveEvolutionConfig(campaign.tenant.settings, campaign.instance);
        if (campaign.mediaUrl) {
          const filename = path.basename(String(campaign.mediaUrl).split('?')[0]);
          const filePath = path.join(uploadsPath, filename);
          if (!fs.existsSync(filePath)) throw new Error('Anexo da campanha não está disponível no servidor.');
          result = await evolutionService.sendMedia(
            evolutionUrl,
            evolutionKey,
            campaign.instance.instanceName,
            recipient.phone,
            {
              mediatype: campaign.mediaType || 'document',
              mimetype: campaign.mediaMimeType || 'application/octet-stream',
              filename: campaign.mediaFilename || filename,
              caption: recipient.renderedMessage,
              filePath,
            }
          );
        } else {
          result = await evolutionService.sendText(evolutionUrl, evolutionKey, campaign.instance.instanceName, recipient.phone, recipient.renderedMessage);
        }
        const externalId = messageId(result);
        const sentAt = new Date();
        const successMetadata = leadAttemptMetadata(recipient, { status: 'SENT', externalId, at: sentAt });
        await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: {
          status: 'SENT', externalId, sentAt, errorMessage: null, reason: null,
          ...(successMetadata ? { metadata: successMetadata } : {}),
        } });
        await syncLeadSuccess(campaign, recipient, sentAt);
        const ticket = recipient.contactId ? await prisma.ticket.findFirst({ where: { tenantId: campaign.tenantId, contactId: recipient.contactId, status: { in: ['pending', 'open', 'bot'] } }, orderBy: { updatedAt: 'desc' } }) : null;
        if (ticket) {
          await prisma.message.create({ data: {
            ticketId: ticket.id,
            body: recipient.renderedMessage,
            fromMe: true,
            fromBot: false,
            externalId,
            ...(campaign.mediaUrl ? {
              mediaUrl: campaign.mediaUrl,
              mediaType: campaign.mediaType || 'document',
              mediaStatus: 'ok',
              fileName: campaign.mediaFilename || path.basename(campaign.mediaUrl),
            } : {}),
          } });
          if (io) io.to(campaign.tenantId).emit('new_message', { ticketId: ticket.id });
        }
      } catch (error) {
        const errorMessage = detail(error);
        const failureMetadata = leadAttemptMetadata(recipient, { status: 'FAILED', error: errorMessage });
        await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: {
          status: 'FAILED', reason: 'send_error', errorMessage,
          ...(failureMetadata ? { metadata: failureMetadata } : {}),
        } });
      }
      const updated = await recompute(campaign.id);
      await emitProgress(campaign.id, campaign.tenantId);
      if (updated.status === 'PAUSED' || updated.cancelRequested) break;
      await sleep(Math.max(1, campaign.delaySeconds || 5) * 1000);
    }
    await recompute(campaignId);
    await emitProgress(campaignId, campaign?.tenantId);
  } catch (error) {
    const row = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { tenantId: true } }).catch(() => null);
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'FAILED', lastError: detail(error) } }).catch(() => {});
    if (row) await emitProgress(campaignId, row.tenantId);
  } finally {
    active.delete(campaignId);
  }
}

async function processDueCampaigns() {
  const campaigns = await prisma.campaign.findMany({ where: { status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] }, select: { id: true } });
  await Promise.all(campaigns.map((campaign) => processCampaign(campaign.id)));
}

function setIo(socketIo) { io = socketIo; }
function start() {
  processDueCampaigns().catch((err) => console.error('[campaign] startup:', err.message));
  setInterval(() => processDueCampaigns().catch((err) => console.error('[campaign] worker:', err.message)), 30000);
  console.log('[campaign] fila durável iniciada (30s)');
}

module.exports = { setIo, start, processCampaign, processDueCampaigns, isQuietHours };
