const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');

// O telefone cadastrado no perfil do usuário é a única forma de liberar o
// modo técnico. Nunca inferimos o papel pelo texto da mensagem.
const actorCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

function isTechnicianProfile(user) {
  const profile = String(user?.accessProfile || '').toLowerCase();
  const role = String(user?.role || '').toLowerCase();
  return ['tecnico', 'technician'].includes(profile) || ['tecnico', 'technician'].includes(role);
}

function normalizeCandidates(phone) {
  return new Set(evolutionService.buildPhoneLookupCandidates(String(phone || ''))
    .map((candidate) => evolutionService.normalizePhoneNumber(candidate))
    .filter(Boolean));
}

function cacheKey(tenantId, phone) {
  return `${tenantId}:${evolutionService.normalizePhoneNumber(phone)}`;
}

function getCached(key) {
  const entry = actorCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    actorCache.delete(key);
    return undefined;
  }
  return entry.value;
}

async function resolveWhatsAppActor({ tenantId, phone }) {
  const candidates = normalizeCandidates(phone);
  if (!tenantId || !candidates.size) return null;

  const key = cacheKey(tenantId, phone);
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const users = await prisma.user.findMany({
    where: { tenantId, active: true, phone: { not: null } },
    select: { id: true, name: true, phone: true, role: true, accessProfile: true, firebirdSupportName: true },
  });
  const technician = users.find((user) => isTechnicianProfile(user)
    && [...normalizeCandidates(user.phone)].some((candidate) => candidates.has(candidate)));

  const value = technician ? {
    type: 'TECHNICIAN',
    audience: 'TECHNICIAN',
    userId: technician.id,
    name: technician.name,
    firebirdSupportName: technician.firebirdSupportName || null,
  } : null;
  actorCache.set(key, { value, createdAt: Date.now() });
  return value;
}

function clearActorCache() {
  actorCache.clear();
}

module.exports = { clearActorCache, isTechnicianProfile, normalizeCandidates, resolveWhatsAppActor };
