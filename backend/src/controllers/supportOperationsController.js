const prisma = require('../lib/prisma');
const { queueAuditEvent } = require('../services/auditEventService');
const agentController = require('./agentController');
const { readReleaseManifest, findRelease } = agentController;

const CHECKLIST = [
  ['access', 'Acessos da empresa conferidos', 'Conta e acesso'],
  ['plan', 'Plano, recursos e limites validados', 'Conta e acesso'],
  ['whatsapp', 'Conexão WhatsApp testada', 'Integrações'],
  ['firebird', 'Conexão com o banco iLux testada', 'Integrações'],
  ['agent', 'Agente local atualizado e online', 'Integrações'],
  ['os', 'Abertura de O.S. homologada no iLux Desktop', 'Homologação'],
  ['billing', 'Fluxo financeiro homologado quando contratado', 'Homologação'],
  ['users', 'Atendentes, equipes e permissões revisados', 'Operação'],
  ['training', 'Treinamento do responsável concluído', 'Operação'],
  ['handoff', 'Aceite de implantação registrado', 'Conclusão'],
];

function deny(req, res) {
  if (req.user?.role !== 'superadmin' || req.user?.supportMode) { res.status(403).json({ error: 'Acesso negado' }); return true; }
  return false;
}

async function listAgentOperations(req, res) {
  if (deny(req, res)) return;
  const agents = await prisma.firebirdAgent.findMany({
    include: { tenant: { select: { id: true, name: true, slug: true } }, versionActions: { orderBy: { createdAt: 'desc' }, take: 10 } },
    orderBy: { lastSeenAt: 'desc' },
  });
  res.json({ stable: readReleaseManifest(), agents });
}

async function requestAgentVersion(req, res) {
  if (deny(req, res)) return;
  const agent = await prisma.firebirdAgent.findUnique({ where: { id: req.params.agentId } });
  if (!agent) return res.status(404).json({ error: 'Instalação não encontrada.' });
  const channel = req.body.channel === 'test' ? 'test' : 'stable';
  const targetVersion = String(req.body.targetVersion || '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(targetVersion)) return res.status(400).json({ error: 'Informe uma versão válida.' });
  const action = req.body.action === 'rollback' ? 'rollback' : 'update';
  const release = findRelease(targetVersion);
  if (!release?.sha256) return res.status(400).json({ error: 'Esta versao nao esta publicada no repositorio de agentes.' });
  const record = await prisma.$transaction(async (tx) => {
    await tx.firebirdAgent.update({ where: { id: agent.id }, data: { releaseChannel: channel, desiredVersion: targetVersion } });
    return tx.agentVersionAction.create({ data: { tenantId: agent.tenantId, firebirdAgentId: agent.id, action, channel, fromVersion: agent.version, targetVersion, requestedById: req.user.userId, reason: String(req.body.reason || '').trim() || null } });
  });
  queueAuditEvent({ req, user: req.user, tenantId: agent.tenantId }, { action: `SUPPORT_AGENT_${action.toUpperCase()}_REQUESTED`, resourceType: 'FirebirdAgent', resourceId: agent.id, metadata: { targetVersion, channel, actionId: record.id } });
  res.status(202).json(record);
}

function listAgentReleases(req, res) {
  if (deny(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json(agentController.listReleaseCatalog());
}

function downloadAgentRelease(req, res) {
  if (deny(req, res)) return;
  return agentController.downloadAgentRelease(req, res);
}

async function getChecklist(req, res) {
  if (deny(req, res)) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: { id: true, name: true } });
  if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada.' });
  await prisma.$transaction(CHECKLIST.map(([itemKey, label, category]) => prisma.deploymentChecklistItem.upsert({ where: { tenantId_itemKey: { tenantId: tenant.id, itemKey } }, create: { tenantId: tenant.id, itemKey, label, category }, update: {} })));
  const items = await prisma.deploymentChecklistItem.findMany({ where: { tenantId: tenant.id }, orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] });
  res.json({ tenant, items, completed: items.filter((item) => item.status === 'completed').length, total: items.length });
}

async function updateChecklistItem(req, res) {
  if (deny(req, res)) return;
  const status = ['pending', 'in_progress', 'blocked', 'completed'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Estado inválido.' });
  const current = await prisma.deploymentChecklistItem.findFirst({ where: { id: req.params.itemId, tenantId: req.params.tenantId } });
  if (!current) return res.status(404).json({ error: 'Item não encontrado.' });
  const item = await prisma.deploymentChecklistItem.update({ where: { id: current.id }, data: { status, notes: req.body.notes === undefined ? undefined : String(req.body.notes || '').trim() || null, updatedById: req.user.userId, completedAt: status === 'completed' ? new Date() : null } });
  queueAuditEvent({ req, user: req.user, tenantId: current.tenantId }, { action: 'SUPPORT_DEPLOYMENT_CHECKLIST_UPDATED', resourceType: 'DeploymentChecklistItem', resourceId: item.id, metadata: { from: current.status, to: status, itemKey: item.itemKey } });
  res.json(item);
}

module.exports = { listAgentOperations, requestAgentVersion, listAgentReleases, downloadAgentRelease, getChecklist, updateChecklistItem };
