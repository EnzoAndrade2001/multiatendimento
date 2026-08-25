const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { mediaPath } = require('../utils/uploads');
const { digits, maskIdentifier, fingerprint } = require('../utils/privacy');
const { recordPrivacyAudit } = require('../services/privacyAuditService');
const { normalizePolicy, previewRetention } = require('../services/privacyRetentionService');
const { getCurrentPolicy } = require('../services/privacyPolicyService');

async function getPolicy(req, res) {
  const policy = await getCurrentPolicy(req.user.tenantId);
  const acceptance = await prisma.privacyAcceptance.findFirst({
    where: { tenantId: req.user.tenantId, userId: req.user.userId },
    orderBy: { acceptedAt: 'desc' },
  });
  return res.json({
    policy,
    acceptance: acceptance ? {
      acceptedAt: acceptance.acceptedAt, policyVersion: acceptance.policyVersion,
      scopes: acceptance.scopes, needsReview: acceptance.policyVersion !== policy.version,
    } : null,
  });
}

async function acceptPolicy(req, res) {
  const policy = await getCurrentPolicy(req.user.tenantId);
  const policyVersion = String(req.body?.policyVersion || '');
  const scopes = [...new Set(Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : [])];
  if (policyVersion !== policy.version) return res.status(409).json({ error: 'A política foi atualizada. Revise a versão vigente.' });
  const purposes = Array.isArray(policy.purposes) ? policy.purposes : [];
  const allowed = new Set(purposes.map((item) => item.key));
  if (scopes.some((scope) => !allowed.has(scope))) return res.status(400).json({ error: 'Finalidade de tratamento inválida.' });
  const missingRequired = purposes.filter((item) => item.required && !scopes.includes(item.key));
  if (missingRequired.length) return res.status(400).json({ error: 'Finalidades obrigatórias não foram aceitas.' });
  const acceptance = await prisma.privacyAcceptance.upsert({
    where: { tenantId_userId_policyVersion: { tenantId: req.user.tenantId, userId: req.user.userId, policyVersion } },
    update: { scopes, ipAddress: String(req.ip || '').slice(0, 100), userAgent: String(req.get?.('user-agent') || '').slice(0, 500), acceptedAt: new Date() },
    create: { tenantId: req.user.tenantId, userId: req.user.userId, policyVersion, scopes, ipAddress: String(req.ip || '').slice(0, 100), userAgent: String(req.get?.('user-agent') || '').slice(0, 500) },
  });
  await recordPrivacyAudit(req, { action: 'PRIVACY_POLICY_ACCEPT', resourceType: 'privacy_policy', resourceId: policyVersion, metadata: { scopes } });
  return res.status(201).json({ acceptedAt: acceptance.acceptedAt, policyVersion, scopes, needsReview: false });
}

function subjectSummary(source, item) {
  return {
    id: item.id,
    source,
    name: item.name || item.fantasyName || 'Não informado',
    email: item.email || null,
    cpfCnpjMasked: maskIdentifier(item.cpfCnpj),
    status: String(item.externalSource || '').toLowerCase() === 'anonymized' ? 'anonymized' : 'active',
  };
}

async function searchSubjects(req, res) {
  const email = String(req.query.email || '').trim().toLowerCase();
  const document = digits(req.query.cpfCnpj);
  if (!email && !document) return res.status(400).json({ error: 'Informe email ou CPF/CNPJ.' });

  const tenantId = req.user.tenantId;
  const where = email
    ? { tenantId, email: { equals: email, mode: 'insensitive' } }
    : { tenantId, cpfCnpj: { not: null } };
  const [contactsRaw, customersRaw] = await Promise.all([
    prisma.contact.findMany({ where, take: document ? 1000 : 50 }),
    prisma.crmCustomer.findMany({ where, take: document ? 1000 : 50 }),
  ]);
  const matches = (items) => document ? items.filter((item) => digits(item.cpfCnpj) === document) : items;
  const subjects = [
    ...matches(contactsRaw).map((item) => subjectSummary('contact', item)),
    ...matches(customersRaw).map((item) => subjectSummary('crmCustomer', item)),
  ];

  await recordPrivacyAudit(req, {
    action: 'SUBJECT_SEARCH', resourceType: 'privacy_subject',
    metadata: { selector: email ? 'email' : 'cpfCnpj', selectorFingerprint: fingerprint(email || document), resultCount: subjects.length },
  });
  return res.json({ subjects });
}

async function resolveSubject(tenantId, source, id) {
  if (source === 'contact') return prisma.contact.findFirst({ where: { id, tenantId } });
  if (source === 'crmCustomer') return prisma.crmCustomer.findFirst({ where: { id, tenantId } });
  return null;
}

async function buildExport(tenantId, source, subject) {
  let contacts;
  let crmCustomer = null;
  if (source === 'contact') {
    contacts = [subject];
    if (subject.crmCustomerId) crmCustomer = await prisma.crmCustomer.findFirst({ where: { id: subject.crmCustomerId, tenantId } });
  } else {
    crmCustomer = subject;
    contacts = await prisma.contact.findMany({ where: { tenantId, crmCustomerId: subject.id } });
  }
  const contactIds = contacts.map((item) => item.id);
  const [tickets, equipments, serviceOrders, crmEquipments, billing] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId, contactId: { in: contactIds } },
      include: { messages: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.equipment.findMany({ where: { tenantId, contactId: { in: contactIds } } }),
    prisma.serviceOrder.findMany({ where: { tenantId, contactId: { in: contactIds } } }),
    crmCustomer ? prisma.crmEquipment.findMany({ where: { tenantId, customerId: crmCustomer.id } }) : [],
    prisma.billingLog.findMany({
      where: { tenantId, OR: [
        ...(subject.cpfCnpj ? [{ cpfCnpj: subject.cpfCnpj }] : []),
        ...(subject.name ? [{ clientName: subject.name }] : []),
        ...(!subject.cpfCnpj && !subject.name ? [{ id: '__no_match__' }] : []),
      ] },
      orderBy: { sentAt: 'asc' },
    }),
  ]);
  const safeCustomer = crmCustomer ? { ...crmCustomer, raw: undefined } : null;
  const safeEquipments = crmEquipments.map(({ raw, ...item }) => item);
  return {
    generatedAt: new Date().toISOString(), source,
    subject: subjectSummary(source, subject),
    contacts, crmCustomer: safeCustomer, tickets, equipments, serviceOrders,
    crmEquipments: safeEquipments, billing,
  };
}

async function exportSubject(req, res) {
  const { source, id } = req.params;
  const subject = await resolveSubject(req.user.tenantId, source, id);
  if (!subject) return res.status(404).json({ error: 'Titular não encontrado.' });
  const data = await buildExport(req.user.tenantId, source, subject);
  const audit = await recordPrivacyAudit(req, { action: 'SUBJECT_EXPORT', resourceType: source, resourceId: id, metadata: { format: 'json' } });
  if (!audit) return res.status(503).json({ error: 'Não foi possível registrar a auditoria da exportação.' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lgpd-${source}-${id}.json"`);
  return res.send(JSON.stringify(data, null, 2));
}

async function collectImpact(tenantId, source, subject) {
  const crmCustomerId = source === 'crmCustomer' ? subject.id : subject.crmCustomerId;
  const contacts = crmCustomerId
    ? await prisma.contact.findMany({ where: { tenantId, crmCustomerId }, select: { id: true } })
    : [subject];
  const contactIds = contacts.map((item) => item.id);
  const [tickets, messages, equipments, orders] = await Promise.all([
    prisma.ticket.count({ where: { tenantId, contactId: { in: contactIds } } }),
    prisma.message.count({ where: { ticket: { tenantId, contactId: { in: contactIds } } } }),
    prisma.equipment.count({ where: { tenantId, contactId: { in: contactIds } } }),
    prisma.serviceOrder.count({ where: { tenantId, contactId: { in: contactIds } } }),
  ]);
  return { contactIds, crmCustomerId: crmCustomerId || null, contacts: contactIds.length, tickets, messages, equipments, serviceOrders: orders };
}

async function removeMediaFiles(urls) {
  const removed = [];
  const failed = [];
  for (const url of urls.filter(Boolean)) {
    const filename = path.basename(String(url));
    const target = path.resolve(mediaPath, filename);
    if (!target.startsWith(`${path.resolve(mediaPath)}${path.sep}`)) continue;
    try { await fs.promises.unlink(target); removed.push(filename); }
    catch (error) { if (error.code !== 'ENOENT') failed.push(filename); }
  }
  return { removed: removed.length, failed };
}

async function anonymizeSubject(req, res) {
  const { source, id } = req.params;
  const tenantId = req.user.tenantId;
  const subject = await resolveSubject(tenantId, source, id);
  if (!subject) return res.status(404).json({ error: 'Titular não encontrado.' });
  const impact = await collectImpact(tenantId, source, subject);
  const dryRun = req.body?.dryRun !== false;
  if (dryRun) {
    await recordPrivacyAudit(req, { action: 'SUBJECT_ANONYMIZE_PREVIEW', resourceType: source, resourceId: id, metadata: { impact } });
    return res.json({ dryRun: true, impact, warnings: ['Histórico operacional será preservado com conteúdo pessoal redigido.'] });
  }
  const reason = String(req.body?.reason || '').trim();
  if (req.body?.confirm !== true || reason.length < 10) {
    return res.status(400).json({ error: 'Confirmação explícita e motivo com ao menos 10 caracteres são obrigatórios.' });
  }
  const intentAudit = await recordPrivacyAudit(req, {
    action: 'SUBJECT_ANONYMIZE', resourceType: source, resourceId: id, status: 'PENDING',
    metadata: { reasonFingerprint: fingerprint(reason), impact },
  });
  if (!intentAudit) return res.status(503).json({ error: 'Não foi possível registrar a auditoria da anonimização.' });

  const contactIds = impact.contactIds;
  const messages = await prisma.message.findMany({
    where: { ticket: { tenantId, contactId: { in: contactIds } } }, select: { mediaUrl: true },
  });
  const anonymizedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.message.updateMany({
      where: { ticket: { tenantId, contactId: { in: contactIds } } },
      data: { body: '[Conteúdo anonimizado por solicitação LGPD]', transcription: null, quotedMsgBody: null, mediaUrl: null, fileName: null },
    });
    await tx.ticket.updateMany({ where: { tenantId, contactId: { in: contactIds } }, data: { subject: null, ratingFeedback: null } });
    await tx.equipment.updateMany({ where: { tenantId, contactId: { in: contactIds } }, data: { address: null, sector: null } });
    await tx.serviceOrder.updateMany({ where: { tenantId, contactId: { in: contactIds } }, data: { defect: '[Conteúdo anonimizado]', technicalNotes: null } });
    for (const contactId of contactIds) {
      await tx.contact.update({ where: { id: contactId }, data: {
        name: `Titular anonimizado ${contactId.slice(-6)}`, fantasyName: null, phone: `anon-${contactId}`,
        whatsapp: null, whatsappJid: null, avatarUrl: null, notes: null, tags: '[]', cpfCnpj: null,
        email: null, address: null, city: null, state: null, zipCode: null, enableWhatsAppBilling: false,
        crmCustomerId: null, externalSource: 'anonymized', externalId: contactId,
      } });
    }
    if (impact.crmCustomerId) {
      await tx.crmEquipment.updateMany({ where: { tenantId, customerId: impact.crmCustomerId }, data: { address: null, phone: null, raw: null } });
      await tx.crmCustomer.update({ where: { id: impact.crmCustomerId }, data: {
        name: `Titular anonimizado ${impact.crmCustomerId.slice(-6)}`, fantasyName: null, cpfCnpj: null, email: null, phone: null,
        address: null, neighborhood: null, city: null, state: null, zipCode: null, contactName: null,
        notes: null, raw: null, externalSource: 'anonymized', externalId: `anon-${impact.crmCustomerId}`,
      } });
    }
    const billingWhere = [
      ...(subject.cpfCnpj ? [{ cpfCnpj: subject.cpfCnpj }] : []),
      ...(subject.name ? [{ clientName: subject.name }] : []),
    ];
    if (billingWhere.length) await tx.billingLog.updateMany({ where: { tenantId, OR: billingWhere }, data: { cpfCnpj: null, clientName: null, errorMessage: null } });
  });
  const fileCleanup = await removeMediaFiles(messages.map((item) => item.mediaUrl));
  const audit = await prisma.privacyAuditLog.update({
    where: { id: intentAudit.id },
    data: { status: fileCleanup.failed.length ? 'COMPLETED_WITH_WARNINGS' : 'SUCCESS', metadata: {
      reasonFingerprint: fingerprint(reason), anonymizedAt: anonymizedAt.toISOString(), impact, fileCleanup,
    } },
  });
  return res.json({ anonymized: true, operationId: audit?.id || null, affected: impact, fileCleanup });
}

async function getRetention(req, res) {
  const policy = await prisma.privacyRetentionPolicy.findUnique({ where: { tenantId: req.user.tenantId } });
  return res.json(policy || normalizePolicy());
}

async function updateRetention(req, res) {
  const data = normalizePolicy(req.body);
  const policy = await prisma.privacyRetentionPolicy.upsert({
    where: { tenantId: req.user.tenantId }, update: data, create: { tenantId: req.user.tenantId, ...data },
  });
  await recordPrivacyAudit(req, { action: 'RETENTION_POLICY_UPDATE', resourceType: 'privacy_retention', resourceId: policy.id, metadata: data });
  return res.json(policy);
}

async function retentionPreview(req, res) {
  const stored = await prisma.privacyRetentionPolicy.findUnique({ where: { tenantId: req.user.tenantId } });
  const policy = normalizePolicy(stored || req.body);
  const preview = await previewRetention(req.user.tenantId, policy);
  await prisma.privacyRetentionPolicy.upsert({
    where: { tenantId: req.user.tenantId },
    update: { ...policy, lastPreviewAt: new Date(), lastPreview: preview },
    create: { tenantId: req.user.tenantId, ...policy, lastPreviewAt: new Date(), lastPreview: preview },
  });
  await recordPrivacyAudit(req, { action: 'RETENTION_PREVIEW', resourceType: 'privacy_retention', metadata: { policy, preview } });
  return res.json({ dryRun: true, policy, preview });
}

async function listAudit(req, res) {
  const take = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const logs = await prisma.privacyAuditLog.findMany({
    where: { tenantId: req.user.tenantId, ...(req.query.action ? { action: String(req.query.action) } : {}) },
    orderBy: { createdAt: 'desc' }, take,
  });
  return res.json({ logs });
}

module.exports = { getPolicy, acceptPolicy, searchSubjects, exportSubject, anonymizeSubject, getRetention, updateRetention, retentionPreview, listAudit, buildExport };
