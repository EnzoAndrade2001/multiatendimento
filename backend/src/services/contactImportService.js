const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');

const MAX_CONTACTS_PER_RUN = 5000;

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.data, payload?.contacts, payload?.records, payload?.data?.records];
  return candidates.find(Array.isArray) || [];
}

function extractJid(raw) {
  // Nos registros de /chat/findContacts, "id" é o id interno do registro no
  // banco da Evolution (ex.: "cmtt3lk8..."), NÃO o jid do WhatsApp -- o jid
  // real vem em "remoteJid". "id" só entra como último recurso (fallback
  // pra versões antigas da Evolution que talvez devolvam o jid ali mesmo).
  const jid = raw?.remoteJid || raw?.jid || raw?.id;
  return typeof jid === 'string' && jid.trim() ? jid.trim().toLowerCase() : null;
}

function isImportableJid(jid) {
  return typeof jid === 'string'
    && jid.endsWith('@s.whatsapp.net')
    && !jid.startsWith('status@')
    && !evolutionService.isGroupJid(jid);
}

function extractName(raw) {
  const name = raw?.pushName || raw?.name || raw?.verifiedName || raw?.notify;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function extractAvatarUrl(raw) {
  const url = raw?.profilePicUrl || raw?.profilePictureUrl || raw?.imgUrl;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

/**
 * Importa a agenda de contatos que a Evolution sincronizou do celular pareado
 * por QR Code (Baileys). Números oficiais (Cloud API) não têm essa agenda.
 * Idempotente: contatos já existentes (por telefone ou por externalId do
 * WhatsApp) só recebem os campos que ainda estavam vazios -- nunca sobrescreve
 * dados já editados manualmente ou vindos do CRM/Firebird.
 */
async function importContactsFromWhatsApp(waInstance, { evolutionUrl, evolutionKey }) {
  const result = { scanned: 0, imported: 0, updated: 0, skipped: 0 };

  const raw = asArray(await evolutionService.findContacts(evolutionUrl, evolutionKey, waInstance.instanceName));
  const entries = raw.slice(0, MAX_CONTACTS_PER_RUN);

  const seenPhones = new Set();

  for (const entry of entries) {
    result.scanned += 1;

    const jid = extractJid(entry);
    if (!isImportableJid(jid)) {
      result.skipped += 1;
      continue;
    }

    const phone = evolutionService.normalizePhoneNumber(jid.split('@')[0]);
    if (!phone || seenPhones.has(phone)) {
      result.skipped += 1;
      continue;
    }
    seenPhones.add(phone);

    const name = extractName(entry);
    const avatarUrl = extractAvatarUrl(entry);
    const phoneCandidates = evolutionService.buildPhoneLookupCandidates(phone);

    const existing = await prisma.contact.findFirst({
      where: {
        tenantId: waInstance.tenantId,
        OR: [
          { phone: { in: phoneCandidates } },
          { whatsapp: { in: phoneCandidates } },
          { externalSource: 'whatsapp', externalId: jid },
        ],
      },
    });

    if (!existing) {
      await prisma.contact.create({
        data: {
          tenantId: waInstance.tenantId,
          instanceId: waInstance.id,
          phone,
          whatsapp: jid,
          whatsappJid: jid,
          name,
          avatarUrl,
          externalSource: 'whatsapp',
          externalId: jid,
          externalUpdatedAt: new Date(),
        },
      });
      result.imported += 1;
    } else {
      await prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: existing.name || name,
          avatarUrl: existing.avatarUrl || avatarUrl,
          whatsapp: existing.whatsapp || jid,
          whatsappJid: existing.whatsappJid || jid,
          externalSource: existing.externalSource || 'whatsapp',
          externalId: existing.externalId || jid,
        },
      });
      result.updated += 1;
    }
  }

  return result;
}

module.exports = { importContactsFromWhatsApp, __testing: { asArray, extractJid, isImportableJid, extractName, extractAvatarUrl } };
