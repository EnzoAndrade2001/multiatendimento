const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');

// O telefone cadastrado no perfil do usuário é a única forma de liberar o
// modo técnico. Nunca inferimos o papel pelo texto da mensagem.
const actorCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

// Sessão de um número autorizado como técnico expira rápido: passou disso
// ocioso, o bot volta a perguntar se ele quer o Assistente Técnico ou
// Atendimento. Atendimento a cliente comum não é afetado (segue as 24h).
const TECHNICIAN_SESSION_INACTIVITY_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.TECHNICIAN_SESSION_INACTIVITY_MINUTES, 10) || 10,
);
const TECHNICIAN_SESSION_INACTIVITY_MS = TECHNICIAN_SESSION_INACTIVITY_MINUTES * 60 * 1000;

function normalizeChoiceText(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

// Lê a resposta do técnico ao menu de modo. Só reconhece escolha explícita:
// "1"/"assistente"/"tecnic"/"manual" -> TECHNICIAN ; "2"/"atendimento"/
// "cliente" -> CUSTOMER. Qualquer outra coisa devolve null (o bot repete o
// menu em vez de adivinhar).
function parseModeChoice(text) {
  const value = normalizeChoiceText(text);
  if (!value) return null;
  if (/^1\b/.test(value) || /\b(assistente tecnic|assistente|modo tecnic|tecnic|manual|procedimento)\b/.test(value)) {
    return 'TECHNICIAN';
  }
  if (/^2\b/.test(value) || /\b(atendimento|cliente|comercial|financeiro|suporte comum|humano)\b/.test(value)) {
    return 'CUSTOMER';
  }
  return null;
}

// "menu" / "trocar modo" / "mudar modo" (mensagem inteira) reabre o menu no
// meio da conversa. Exige ser a mensagem toda para não confundir com uma
// dúvida real ("como abro o menu na tela").
function isMenuRequest(text) {
  const value = normalizeChoiceText(text).replace(/[.!?]+$/, '');
  return /^(menu|trocar( de)? modo|mudar( de)? modo|alterar modo)$/.test(value);
}

function isTechnicianProfile(user) {
  const profile = String(user?.accessProfile || '').toLowerCase();
  const role = String(user?.role || '').toLowerCase();
  return ['tecnico', 'technician'].includes(profile) || ['tecnico', 'technician'].includes(role);
}

// Celular BR: 55 + DD + (9 + 8 dígitos) OU (8 dígitos legado). O WhatsApp
// entrega ora com ora sem o 9, e um técnico pode ter sido cadastrado de um
// jeito e mandar mensagem do outro. Geramos as duas formas para o match não
// depender disso.
function brazilNinthDigitVariants(digits) {
  const value = String(digits || '');
  const match = value.match(/^55(\d{2})(\d{8,9})$/);
  if (!match) return [value];
  const [, area, local] = match;
  const variants = new Set([value]);
  if (local.length === 9 && local.startsWith('9')) variants.add(`55${area}${local.slice(1)}`);
  if (local.length === 8) variants.add(`55${area}9${local}`);
  return [...variants];
}

function normalizeCandidates(phone) {
  const out = new Set();
  for (const candidate of evolutionService.buildPhoneLookupCandidates(String(phone || ''))) {
    const normalized = evolutionService.normalizePhoneNumber(candidate);
    if (!normalized) continue;
    for (const variant of brazilNinthDigitVariants(normalized)) out.add(variant);
  }
  return out;
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

  const authorizedContacts = await prisma.technicalContact.findMany({
    where: { tenantId, active: true },
    select: { id: true, name: true, phone: true },
  });
  const authorized = authorizedContacts.find((contact) => [...normalizeCandidates(contact.phone)]
    .some((candidate) => candidates.has(candidate)));

  let value = authorized ? {
    type: 'TECHNICIAN',
    audience: 'TECHNICIAN',
    userId: null,
    technicalContactId: authorized.id,
    name: authorized.name,
  } : null;

  // Compatibilidade: instalações antigas ainda podem ter o técnico como User.
  if (!value) {
    const users = await prisma.user.findMany({
      where: { tenantId, active: true, phone: { not: null } },
      select: { id: true, name: true, phone: true, role: true, accessProfile: true },
    });
    const technician = users.find((user) => isTechnicianProfile(user)
      && [...normalizeCandidates(user.phone)].some((candidate) => candidates.has(candidate)));
    if (technician) {
      value = {
        type: 'TECHNICIAN',
        audience: 'TECHNICIAN',
        userId: technician.id,
        technicalContactId: null,
        name: technician.name,
      };
    }
  }
  actorCache.set(key, { value, createdAt: Date.now() });
  return value;
}

function clearActorCache() {
  actorCache.clear();
}

module.exports = {
  TECHNICIAN_SESSION_INACTIVITY_MINUTES,
  TECHNICIAN_SESSION_INACTIVITY_MS,
  clearActorCache,
  isMenuRequest,
  isTechnicianProfile,
  normalizeCandidates,
  parseModeChoice,
  resolveWhatsAppActor,
};
