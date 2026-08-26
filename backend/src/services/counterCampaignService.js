/**
 * Helpers for the counter-reading campaign.
 *
 * A counter campaign is deliberately prepared per contact (and not per
 * machine).  A customer can have several printers in different sectors, so
 * the rendered message contains a compact, deterministic list of all active
 * equipment.  The campaign worker can persist the returned equipmentIds and
 * variables on its recipient record for audit/retries.
 */

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/** Keep only digits and accept Brazilian numbers with or without the country code. */
function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('55') ? digits : `55${digits}`;
  // WhatsApp/Evolution expects an international number.  Reject obviously
  // incomplete/oversized values before they reach the provider.
  if (normalized.length < 12 || normalized.length > 15) return null;
  return normalized;
}

function equipmentKey(equipment) {
  return text(equipment.id)
    || `${text(equipment.externalId)}|${text(equipment.serialNumber)}|${text(equipment.model)}`;
}

function activeEquipments(contact) {
  const sources = [
    ...(Array.isArray(contact?.equipments) ? contact.equipments : []),
    ...(Array.isArray(contact?.crmCustomer?.equipments) ? contact.crmCustomer.equipments : []),
  ];
  const seen = new Set();
  return sources.filter((equipment) => {
    if (!equipment || equipment.isActive === false) return false;
    const key = equipmentKey(equipment);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return Boolean(text(equipment.model) || text(equipment.manufacturer));
  });
}

function equipmentLabel(equipment, index) {
  const model = text(equipment.model) || 'Equipamento';
  const serial = text(equipment.serialNumber) || 'série não informada';
  const location = text(equipment.installLocation) || text(equipment.sector)
    || text(equipment.address) || 'local não informado';
  return `${index + 1}. ${model} (série: ${serial}; local: ${location})`;
}

function equipmentVariables(equipments) {
  const first = equipments[0] || {};
  return {
    equipamento: text(first.model) || 'equipamento',
    modelo: text(first.model),
    serie: text(first.serialNumber),
    local: text(first.installLocation) || text(first.sector) || text(first.address),
    equipamentos: equipments.map(equipmentLabel).join('\n'),
  };
}

/**
 * Replaces the variables supported by a counter campaign.  Both [nome] and
 * the existing campaign spelling [name] are accepted for consistency with
 * older templates. Unknown variables are intentionally left untouched so an
 * operator can spot a typo in the preview rather than silently losing text.
 */
function renderCounterMessage(template, contact, equipments) {
  const variables = {
    nome: text(contact?.name) || 'Cliente',
    name: text(contact?.name) || 'Cliente',
    ...equipmentVariables(equipments),
  };
  return text(template).replace(/\[([a-z_]+)\]/gi, (match, key) => {
    const value = variables[String(key).toLowerCase()];
    return value === undefined ? match : value;
  });
}

/**
 * Builds the audience and explicit skip reasons used in the preview and by
 * the durable worker.  Deduplication happens by normalized phone, preventing
 * the same WhatsApp number from receiving multiple messages when it is linked
 * to duplicate contacts.
 */
function buildCounterAudience(contacts, options = {}) {
  const requireOptIn = options.requireOptIn !== false;
  const excludeOptOut = options.excludeOptOut !== false;
  const template = text(options.template)
    || 'Olá [nome], por favor envie os contadores dos equipamentos abaixo:\n[equipamentos]';
  const recipients = [];
  const skipped = [];
  const seenPhones = new Set();

  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const phone = normalizePhone(contact?.whatsapp || contact?.phone);
    const equipments = activeEquipments(contact);
    const reason = excludeOptOut && contact?.whatsappOptOutAt
      ? 'whatsapp_opt_out'
      : !phone
      ? 'invalid_phone'
      : requireOptIn && contact?.enableWhatsAppCounters !== true
        ? 'counter_opt_in_required'
        : equipments.length === 0
          ? 'no_active_equipment'
          : seenPhones.has(phone)
            ? 'duplicate_phone'
            : null;

    if (reason) {
      skipped.push({ contactId: contact?.id || null, phone, reason });
      continue;
    }
    seenPhones.add(phone);
    const variables = equipmentVariables(equipments);
    recipients.push({
      contactId: contact.id,
      phone,
      name: text(contact.name) || 'Cliente',
      equipmentIds: equipments.map((equipment) => equipment.id).filter(Boolean),
      equipmentCount: equipments.length,
      variables,
      renderedMessage: renderCounterMessage(template, contact, equipments),
    });
  }

  return { recipients, skipped, template };
}

module.exports = {
  normalizePhone,
  activeEquipments,
  equipmentVariables,
  renderCounterMessage,
  buildCounterAudience,
};
