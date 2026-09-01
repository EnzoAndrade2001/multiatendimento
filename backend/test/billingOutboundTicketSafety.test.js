const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const { _private } = require('../src/controllers/billingController');

const { getOutboundBillingTicket } = _private;

test('cobranca proativa nova nasce encerrada e nao entra em atendimento', async (context) => {
  const originalFindFirst = prisma.ticket.findFirst;
  const originalCreate = prisma.ticket.create;
  context.after(() => {
    prisma.ticket.findFirst = originalFindFirst;
    prisma.ticket.create = originalCreate;
  });

  prisma.ticket.findFirst = async () => null;
  let createdData;
  prisma.ticket.create = async ({ data }) => {
    createdData = data;
    return { id: 'ticket-billing', ...data };
  };

  const at = new Date('2026-09-01T15:07:00.000Z');
  const ticket = await getOutboundBillingTicket({
    tenantId: 'tenant-1',
    contactId: 'contact-bianca',
    instanceId: 'instance-financeiro',
    at,
  });

  assert.equal(ticket.status, 'resolved');
  assert.equal(createdData.resolvedAt, at);
  assert.equal(createdData.lastMessageAt, at);
});

test('cobranca em conversa encerrada preserva o status anterior', async (context) => {
  const originalFindFirst = prisma.ticket.findFirst;
  const originalUpdate = prisma.ticket.update;
  context.after(() => {
    prisma.ticket.findFirst = originalFindFirst;
    prisma.ticket.update = originalUpdate;
  });

  prisma.ticket.findFirst = async () => ({ id: 'ticket-leonardo', status: 'resolved' });
  let updateData;
  prisma.ticket.update = async ({ data }) => {
    updateData = data;
    return { id: 'ticket-leonardo', status: 'resolved', ...data };
  };

  const ticket = await getOutboundBillingTicket({
    tenantId: 'tenant-1',
    contactId: 'contact-leonardo',
    instanceId: 'instance-financeiro',
  });

  assert.equal(ticket.status, 'resolved');
  assert.equal(Object.hasOwn(updateData, 'status'), false);
  assert.equal(Object.hasOwn(updateData, 'agentId'), false);
});

test('cobranca em atendimento humano ativo nao altera responsavel nem status', async (context) => {
  const originalFindFirst = prisma.ticket.findFirst;
  const originalUpdate = prisma.ticket.update;
  context.after(() => {
    prisma.ticket.findFirst = originalFindFirst;
    prisma.ticket.update = originalUpdate;
  });

  prisma.ticket.findFirst = async () => ({ id: 'ticket-ativo', status: 'open', agentId: 'agent-1' });
  let updateData;
  prisma.ticket.update = async ({ data }) => {
    updateData = data;
    return { id: 'ticket-ativo', status: 'open', agentId: 'agent-1', ...data };
  };

  const ticket = await getOutboundBillingTicket({
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    instanceId: 'instance-financeiro',
  });

  assert.equal(ticket.status, 'open');
  assert.equal(ticket.agentId, 'agent-1');
  assert.equal(Object.hasOwn(updateData, 'status'), false);
  assert.equal(Object.hasOwn(updateData, 'agentId'), false);
});
