const prisma = require('../lib/prisma');
const printGuard = require('../services/printGuardService');
const parkService = require('../services/parkService');
const { hasPermission } = require('../auth/permissions');
const { queueAuditEvent } = require('../services/auditEventService');

async function status(req, res) {
  try {
    const connection = await printGuard.getConnection(req.user.tenantId);
    if (!connection) return res.json({ connection: null, mappingSummary: [] });
    const bindings = await prisma.printGuardBinding.findMany({
      where: { tenantId: req.user.tenantId, connectionId: connection.id },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: { customerCode: true, serialNumber: true, state: true, customerId: true, equipmentId: true, lastSeenAt: true },
    });
    return res.json({ connection: printGuard.secureConnection(connection), mappingSummary: bindings.map((item) => ({ source: item.customerCode || item.serialNumber || 'PrintGuard', target: item.customerId || item.equipmentId || '—', status: item.state, lastSeenAt: item.lastSeenAt })) });
  } catch (error) {
    return res.status(500).json({ error: 'Nao foi possivel consultar a conexao PrintGuard.' });
  }
}

async function pair(req, res) {
  try {
    const connection = await printGuard.exchangePairing(req.user.tenantId, req, req.body || {});
    return res.status(201).json({ connection, message: 'Pareamento PrintGuard concluido.' });
  } catch (error) {
    const statusCode = error.response?.status && error.response.status >= 400 && error.response.status < 500 ? 400 : 502;
    return res.status(statusCode).json({ error: error.message || 'Nao foi possivel concluir o pareamento.' });
  }
}

async function test(req, res) {
  try {
    const result = await printGuard.testConnection(req.user.tenantId);
    return res.json({ ...result, message: 'Conexao PrintGuard testada com sucesso.' });
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Teste de conexao falhou.' });
  }
}

async function disconnect(req, res) {
  try { return res.json({ connection: await printGuard.disconnect(req.user.tenantId) }); } catch (error) { return res.status(500).json({ error: error.message }); }
}

async function getMetrics(req, res) {
  try { return res.json({ metrics: await printGuard.metrics(req.user.tenantId) }); } catch (error) { return res.status(500).json({ error: error.message }); }
}

async function sync(req, res) {
  try { return res.json(await printGuard.syncEvents(req.user.tenantId)); } catch (error) { return res.status(502).json({ error: error.message }); }
}

async function remotePage(req, res) {
  try {
    const resource = req.params.resource;
    return res.json(await printGuard.listRemote(req.user.tenantId, resource, req.query.cursor));
  } catch (error) {
    return res.status(502).json({ error: error.message || 'Nao foi possivel consultar o PrintGuard.' });
  }
}

async function webhook(req, res) {
  const headerConnection = req.header('x-printguard-connection');
  if (!headerConnection) return res.status(401).json({ error: 'Cabecalho de conexao PrintGuard ausente.' });
  try {
    const connection = await prisma.printGuardConnection.findFirst({ where: { externalId: headerConnection } });
    if (!connection) return res.status(404).json({ error: 'Conexao PrintGuard nao encontrada.' });
    if (connection.status === 'INACTIVE') return res.status(410).json({ error: 'Conexao PrintGuard desativada.' });
    const result = await printGuard.ingestWebhook({
      connection,
      body: req.body,
      rawBody: req.rawBody,
      timestamp: req.header('x-printguard-timestamp'),
      signature: req.header('x-printguard-signature'),
    });
    queueAuditEvent({ tenantId: connection.tenantId, req }, {
      action: result.duplicate ? 'PRINTGUARD_WEBHOOK_DUPLICATE' : 'PRINTGUARD_WEBHOOK_RECEIVED',
      resourceType: 'printguard_event',
      resourceId: result.event.externalEventId,
      metadata: { connectionId: connection.id, state: result.event.state },
    });
    return res.status(result.duplicate ? 200 : 202).json({ accepted: true, duplicate: result.duplicate, eventId: result.event.externalEventId });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || 'Webhook PrintGuard rejeitado.' });
  }
}

async function queue(req, res) {
  try { return res.json(await printGuard.listTelemetry(req.user.tenantId, req.query)); } catch (error) { return res.status(500).json({ error: 'Nao foi possivel carregar a fila de telemetria.' }); }
}

async function action(req, res) {
  try {
    const action = req.params.action;
    if (!['ignore', 'monitor', 'approve'].includes(action)) return res.status(400).json({ error: 'Acao invalida.' });
    if (action === 'approve' && !hasPermission(req.user, 'inbox.create_os')) {
      return res.status(403).json({ error: 'Voce nao possui permissao para abrir O.S.' });
    }
    const result = await printGuard.eventAction(req.user.tenantId, req.params.eventId, action, req.body || {});
    return res.json({ event: result, serviceOrder: action === 'approve' ? result : undefined });
  } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || 'Nao foi possivel atualizar o evento.' }); }
}

async function parkQueue(req, res) {
  try { return res.json(await parkService.parkQueue(req.user.tenantId, req.query)); }
  catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || 'Nao foi possivel carregar a fila do parque.' }); }
}

async function parkCoverage(req, res) {
  try { return res.json(await parkService.parkCoverage(req.user.tenantId)); }
  catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || 'Nao foi possivel carregar a cobertura do parque.' }); }
}

async function parkRanking(req, res) {
  try { return res.json(await parkService.equipmentRanking(req.user.tenantId, req.query)); }
  catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || 'Nao foi possivel carregar o ranking.' }); }
}

async function parkTimeline(req, res) {
  try { return res.json(await parkService.equipmentTimeline(req.user.tenantId, req.params.equipmentId, req.query)); }
  catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || 'Nao foi possivel carregar a timeline.' }); }
}

async function parkConsolidate(req, res) {
  try {
    if (!hasPermission(req.user, 'inbox.create_os')) {
      return res.status(403).json({ error: 'Voce nao possui permissao para abrir O.S.' });
    }
    const { eventIds, cdOstp, priority, defect, nmsuportet } = req.body || {};
    const serviceOrder = await parkService.consolidateToServiceOrder(req.user.tenantId, eventIds, { cdOstp, priority, defect, nmsuportet });
    return res.json({ serviceOrder });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Nao foi possivel consolidar a O.S.' });
  }
}

module.exports = {
  status, pair, test, disconnect, getMetrics, sync, remotePage, webhook, queue, action,
  parkQueue, parkCoverage, parkRanking, parkTimeline, parkConsolidate,
};
