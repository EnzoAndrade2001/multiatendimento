const prisma = require('../lib/prisma');
const {
  canonicalTagName,
  normalizeTagColor,
  normalizeTagList,
  normalizeTagName,
  parseTagList,
} = require('../utils/tagUtils');

function isTrue(value) {
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function usageCounts(tenantId) {
  const contacts = await prisma.contact.findMany({ where: { tenantId }, select: { tags: true } });
  const counts = new Map();
  for (const contact of contacts) {
    for (const tag of normalizeTagList(contact.tags)) {
      const key = canonicalTagName(tag);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

async function list(req, res) {
  const tenantId = req.user.tenantId;
  const includeArchived = isTrue(req.query.includeArchived);
  const tags = await prisma.tag.findMany({
    where: { tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
  });
  const counts = await usageCounts(tenantId);
  res.json(tags.map((tag) => ({
    ...tag,
    usageCount: counts.get(canonicalTagName(tag.name)) || 0,
    archived: Boolean(tag.archivedAt),
  })));
}

async function usage(req, res) {
  const contacts = await prisma.contact.findMany({ where: { tenantId: req.user.tenantId }, select: { tags: true } });
  const counts = new Map();
  let taggedContacts = 0;
  for (const contact of contacts) {
    const tags = normalizeTagList(contact.tags);
    if (tags.length) taggedContacts += 1;
    for (const tag of tags) {
      const key = canonicalTagName(tag);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  res.json({ counts: Object.fromEntries(counts), taggedContacts, links: [...counts.values()].reduce((total, count) => total + count, 0) });
}

async function findDuplicate(tenantId, name, excludeId = null) {
  const canonical = canonicalTagName(name);
  if (!canonical) return null;
  const tags = await prisma.tag.findMany({ where: { tenantId }, select: { id: true, name: true, archivedAt: true } });
  return tags.find((tag) => tag.id !== excludeId && canonicalTagName(tag.name) === canonical) || null;
}

async function renameContactTagReferences(tenantId, previousName, nextName) {
  const previousCanonical = canonicalTagName(previousName);
  if (!previousCanonical || previousCanonical === canonicalTagName(nextName)) return;
  const contacts = await prisma.contact.findMany({ where: { tenantId }, select: { id: true, tags: true } });
  const updates = [];
  for (const contact of contacts) {
    const tags = normalizeTagList(contact.tags);
    if (!tags.some((tag) => canonicalTagName(tag) === previousCanonical)) continue;
    const renamed = normalizeTagList(tags.map((tag) => canonicalTagName(tag) === previousCanonical ? nextName : tag));
    updates.push(prisma.contact.update({ where: { id: contact.id }, data: { tags: JSON.stringify(renamed) } }));
  }
  if (updates.length) await prisma.$transaction(updates);
}

function invalidName(res) {
  return res.status(400).json({ error: 'Informe uma etiqueta com até 80 caracteres.' });
}

async function create(req, res) {
  const name = normalizeTagName(req.body?.name);
  if (!name) return invalidName(res);
  const duplicate = await findDuplicate(req.user.tenantId, name);
  if (duplicate) return res.status(409).json({ error: duplicate.archivedAt ? 'Esta etiqueta está arquivada. Restaure-a ou escolha outro nome.' : 'Esta etiqueta já existe.', id: duplicate.id, archived: Boolean(duplicate.archivedAt) });
  try {
    const tag = await prisma.tag.create({
      data: { name, color: normalizeTagColor(req.body?.color), tenantId: req.user.tenantId },
    });
    res.status(201).json({ ...tag, usageCount: 0, archived: false });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Esta etiqueta já existe.' });
    throw err;
  }
}

async function update(req, res) {
  const { id } = req.params;
  const tenantId = req.user.tenantId;
  const exists = await prisma.tag.findFirst({ where: { id, tenantId } });
  if (!exists) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  const data = {};
  if (req.body?.name !== undefined) {
    data.name = normalizeTagName(req.body.name);
    if (!data.name) return invalidName(res);
    const duplicate = await findDuplicate(tenantId, data.name, id);
    if (duplicate) return res.status(409).json({ error: 'Esta etiqueta já existe.', id: duplicate.id, archived: Boolean(duplicate.archivedAt) });
  }
  if (req.body?.color !== undefined) data.color = normalizeTagColor(req.body.color, exists.color || '#D4AF37');
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nenhuma alteração informada.' });
  try {
    const tag = await prisma.tag.update({ where: { id }, data });
    if (data.name && canonicalTagName(data.name) !== canonicalTagName(exists.name)) {
      await renameContactTagReferences(tenantId, exists.name, data.name);
    }
    const counts = await usageCounts(tenantId);
    res.json({ ...tag, usageCount: counts.get(canonicalTagName(tag.name)) || 0, archived: Boolean(tag.archivedAt) });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Esta etiqueta já existe.' });
    throw err;
  }
}

async function archive(req, res) {
  const { id } = req.params;
  const tenantId = req.user.tenantId;
  const exists = await prisma.tag.findFirst({ where: { id, tenantId } });
  if (!exists) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  const counts = await usageCounts(tenantId);
  const tag = await prisma.tag.update({ where: { id }, data: { archivedAt: exists.archivedAt || new Date() } });
  return res.json({ ...tag, usageCount: counts.get(canonicalTagName(tag.name)) || 0, archived: true, message: 'Etiqueta arquivada. Referências históricas foram preservadas.' });
}

async function restore(req, res) {
  const { id } = req.params;
  const tenantId = req.user.tenantId;
  const exists = await prisma.tag.findFirst({ where: { id, tenantId } });
  if (!exists) return res.status(404).json({ error: 'Etiqueta não encontrada.' });
  const duplicate = await findDuplicate(tenantId, exists.name, id);
  if (duplicate && !duplicate.archivedAt) return res.status(409).json({ error: 'Já existe uma etiqueta ativa com este nome.', id: duplicate.id });
  const counts = await usageCounts(tenantId);
  const tag = await prisma.tag.update({ where: { id }, data: { archivedAt: null } });
  return res.json({ ...tag, usageCount: counts.get(canonicalTagName(tag.name)) || 0, archived: false, message: 'Etiqueta restaurada.' });
}

async function remove(req, res) {
  // DELETE keeps the historical API, but archives instead of deleting. Contacts
  // keep their original tag names and campaigns/audits remain intelligible.
  return archive(req, res);
}

// Used by contact writes to canonicalize JSON tag arrays without requiring an
// official tag record (automatic routing tags remain valid).
function normalizeContactTags(value) {
  return JSON.stringify(normalizeTagList(value || parseTagList(value)));
}

module.exports = { list, usage, create, update, remove, archive, restore, normalizeContactTags, normalizeTagName, canonicalTagName, normalizeTagColor };
