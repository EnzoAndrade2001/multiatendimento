const prisma = require('../lib/prisma');
const evolutionService = require('../services/evolutionService');
const technicalAssistantService = require('../services/technicalAssistantService');

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedPhone(value) {
  return evolutionService.normalizePhoneNumber(String(value ?? '')) || null;
}

function serialize(contact) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    active: Boolean(contact.active),
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function validateInput(body, { partial = false } = {}) {
  const data = {};
  if (!partial || body.name !== undefined) {
    data.name = clean(body.name);
    if (data.name.length < 2) return { error: 'Informe o nome do técnico (mínimo de 2 caracteres).' };
  }
  if (!partial || body.phone !== undefined) {
    data.phone = normalizedPhone(body.phone);
    if (!data.phone || data.phone.includes('@g.us') || data.phone.length < 10) return { error: 'Informe um WhatsApp válido com DDD e número.' };
  }
  if (!partial || body.active !== undefined) {
    if (body.active !== undefined && typeof body.active !== 'boolean') return { error: 'O status ativo deve ser booleano.' };
    data.active = body.active === undefined ? true : body.active;
  }
  if (partial && !Object.keys(data).length) return { error: 'Informe ao menos um campo para atualizar.' };
  return { data };
}

async function list(req, res) {
  const contacts = await prisma.technicalContact.findMany({
    where: { tenantId: req.user.tenantId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  res.json(contacts.map(serialize));
}

async function create(req, res) {
  const { data, error } = validateInput(req.body || {});
  if (error) return res.status(400).json({ error });
  try {
    const contact = await prisma.technicalContact.create({ data: { ...data, tenantId: req.user.tenantId } });
    technicalAssistantService.clearActorCache();
    return res.status(201).json(serialize(contact));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Este número já está autorizado para esta empresa.' });
    console.error('[technical-contact] criar:', err.message);
    return res.status(500).json({ error: 'Não foi possível autorizar o técnico.' });
  }
}

async function update(req, res) {
  const { data, error } = validateInput(req.body || {}, { partial: true });
  if (error) return res.status(400).json({ error });
  const existing = await prisma.technicalContact.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Técnico autorizado não encontrado.' });
  try {
    const contact = await prisma.technicalContact.update({ where: { id: existing.id }, data });
    technicalAssistantService.clearActorCache();
    return res.json(serialize(contact));
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Este número já está autorizado para esta empresa.' });
    console.error('[technical-contact] atualizar:', err.message);
    return res.status(500).json({ error: 'Não foi possível atualizar o técnico.' });
  }
}

async function remove(req, res) {
  const result = await prisma.technicalContact.deleteMany({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!result.count) return res.status(404).json({ error: 'Técnico autorizado não encontrado.' });
  technicalAssistantService.clearActorCache();
  return res.sendStatus(204);
}

module.exports = { list, create, update, remove };
