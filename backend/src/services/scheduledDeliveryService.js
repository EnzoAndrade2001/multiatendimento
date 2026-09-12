const { randomUUID } = require('crypto');
const MAX_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

// Only failures known to precede delivery may be retried automatically.
function failurePolicy(error) {
  const status = error.response?.status;
  if (status === 429 || ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) {
    return { retryable: true, uncertain: false, message: 'Conexão indisponível ou limite de envio atingido.' };
  }
  if (status >= 400 && status < 500) return { retryable: false, uncertain: false, message: `Provedor recusou o envio (HTTP ${status}).` };
  return { retryable: false, uncertain: true, message: 'Não foi possível confirmar a entrega. Confira o histórico no WhatsApp antes de reenviar.' };
}

function createScheduledDeliveryService({ prisma, compliance, sendText, now = () => new Date(), logger = console }) {
  async function process() {
    const time = now();
    await prisma.scheduledMessage.updateMany({
      where: { status: 'sending', claimedAt: { lt: new Date(time.getTime() - CLAIM_TIMEOUT_MS) } },
      data: { status: 'blocked', processed: true, deliveryUncertain: true, claimToken: null,
        lastError: 'Processamento interrompido. Confirme o envio no WhatsApp antes de reenviar.' },
    });
    const due = await prisma.scheduledMessage.findMany({
      where: { status: 'queued', sendAt: { lte: time }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: time } }] },
      orderBy: { sendAt: 'asc' }, take: 50,
    });
    for (const candidate of due) {
      const claimToken = randomUUID();
      const claim = await prisma.scheduledMessage.updateMany({
        where: { id: candidate.id, status: 'queued', attempts: candidate.attempts },
        data: { status: 'sending', claimedAt: now(), claimToken, attempts: { increment: 1 } },
      });
      if (!claim.count) continue;
      const finish = (data) => prisma.scheduledMessage.updateMany({
        where: { id: candidate.id, status: 'sending', claimToken },
        data: { ...data, claimToken: null, claimedAt: null },
      });
      let dispatchStarted = false;
      try {
        const [contact, instance, settings] = await Promise.all([
          prisma.contact.findFirst({ where: { id: candidate.contactId, tenantId: candidate.tenantId } }),
          prisma.waInstance.findFirst({ where: { id: candidate.instanceId || '', tenantId: candidate.tenantId } }),
          prisma.tenantSettings.findUnique({ where: { tenantId: candidate.tenantId } }),
        ]);
        if (!contact || !instance || instance.instanceName.startsWith('DELETED_') || !['evolution_qr', 'evolution_official'].includes(instance.provider)) {
          await finish({ status: 'blocked', processed: true, lastError: 'Contato ou conexão de saída indisponível.' });
          continue;
        }
        const gate = await compliance.canAutomatedSend({ tenantId: candidate.tenantId, contactId: contact.id, instance });
        if (!gate.allowed) {
          await finish({ status: 'blocked', processed: true, lastError: `${gate.code}: ${gate.reason || 'Envio bloqueado pela política de WhatsApp.'}` });
          continue;
        }
        const url = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
        const key = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;
        if (!url || !key) {
          await finish({ status: 'blocked', processed: true, lastError: 'Configure a conexão WhatsApp antes de reenviar.' });
          continue;
        }
        // Revalidate ownership immediately before calling the external provider.
        const owned = await prisma.scheduledMessage.updateMany({ where: { id: candidate.id, status: 'sending', claimToken }, data: { claimedAt: now() } });
        if (!owned.count) continue;
        dispatchStarted = true;
        const result = await sendText(url, key, instance.instanceName, contact.phone, candidate.body);
        const providerMessageId = result?.key?.id || result?.messageId || result?.id || null;
        await finish({ status: 'sent', processed: true, sentAt: now(), providerMessageId, deliveryUncertain: false, lastError: null });
        // Delivery is committed first: a local history failure must never resend externally.
        try {
          const ticket = await prisma.ticket.findFirst({ where: { tenantId: candidate.tenantId, contactId: contact.id, instanceId: instance.id, status: { in: ['pending', 'open', 'bot'] } }, orderBy: { updatedAt: 'desc' } });
          if (ticket) await prisma.message.create({ data: { ticketId: ticket.id, body: candidate.body, fromMe: true, fromBot: false, ...(providerMessageId ? { externalId: providerMessageId } : {}) } });
        } catch (error) { logger.error('[schedule] falha no histórico local:', error.message); }
      } catch (error) {
        const policy = dispatchStarted ? failurePolicy(error) : { retryable: true, uncertain: false, message: 'Falha temporária antes do envio.' };
        const retry = policy.retryable && candidate.attempts + 1 < MAX_ATTEMPTS;
        await finish({ status: retry ? 'queued' : policy.uncertain ? 'blocked' : 'failed', processed: !retry,
          deliveryUncertain: policy.uncertain, lastError: policy.message,
          nextAttemptAt: retry ? new Date(now().getTime() + Math.min(60, 2 ** candidate.attempts) * 60000) : null });
      }
    }
  }
  return { process };
}
module.exports = { createScheduledDeliveryService, failurePolicy, MAX_ATTEMPTS };
