const crypto = require('crypto');
const prisma = require('../lib/prisma');

// Puxa a credencial do PlugBoleto do iLux sob demanda (botao "Sincronizar
// credencial"), no mesmo molde do FETCH_COMPANY_PROFILE: o CRM enfileira um
// pedido, o agente le CE_CEDENTE / CE_PARAM_CONFIG no Firebird e devolve.
const PLUGBOLETO_REQUEST_ENTITY = 'plugBoletoConfigRequest';

async function requestPlugBoletoConfigSync(tenantId, requestedBy) {
  const pending = await prisma.externalSyncRecord.findFirst({
    where: {
      tenantId,
      source: 'crm',
      entity: PLUGBOLETO_REQUEST_ENTITY,
      OR: [
        { payload: { path: ['status'], equals: 'pending' } },
        { payload: { path: ['status'], equals: 'processing' } },
      ],
    },
    select: { id: true },
  });
  if (pending) return { id: pending.id, status: 'pending', alreadyQueued: true };

  const id = crypto.randomUUID();
  await prisma.externalSyncRecord.create({
    data: {
      id,
      tenantId,
      source: 'crm',
      entity: PLUGBOLETO_REQUEST_ENTITY,
      externalId: id,
      payload: {
        status: 'pending',
        requestedAt: new Date().toISOString(),
        requestedBy: requestedBy || null,
      },
    },
  });
  return { id, status: 'pending', alreadyQueued: false };
}

async function getLatestPlugBoletoConfigRequest(tenantId) {
  return prisma.externalSyncRecord.findFirst({
    where: { tenantId, source: 'crm', entity: PLUGBOLETO_REQUEST_ENTITY },
    orderBy: { receivedAt: 'desc' },
    select: { id: true, payload: true, receivedAt: true },
  });
}

module.exports = {
  PLUGBOLETO_REQUEST_ENTITY,
  requestPlugBoletoConfigSync,
  getLatestPlugBoletoConfigRequest,
};
