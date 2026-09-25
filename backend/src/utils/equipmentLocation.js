function cleanLocationValue(value) {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (['N/A', 'NA', 'NULL', 'UNDEFINED', '-', '--'].includes(normalized.toUpperCase())) return null;
  return normalized;
}

function firstLocationValue(...values) {
  for (const value of values) {
    const normalized = cleanLocationValue(value);
    if (normalized) return normalized;
  }
  return null;
}

function field(source, raw, ...keys) {
  for (const key of keys) {
    const value = source?.[key] ?? raw?.[key] ?? raw?.[key.toLowerCase()] ?? raw?.[key.toUpperCase()];
    const normalized = cleanLocationValue(value);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Normaliza somente a localização da máquina. O endereço do cliente não é
 * usado como fallback: uma máquina sem endereço próprio deve aparecer sem
 * endereço, nunca com a sede/filial do cliente por engano.
 */
function readEquipmentLocation(source = {}) {
  const raw = source.raw && typeof source.raw === 'object' ? source.raw : {};
  const street = field(source, raw, 'street', 'logradouro', 'addressStreet', 'rua');
  const number = field(source, raw, 'number', 'numero', 'num', 'addressNumber', 'nr');
  const complement = field(source, raw, 'complement', 'complemento', 'addressComplement');
  const neighborhood = field(source, raw, 'neighborhood', 'bairro', 'district');
  const composed = street || number
    ? firstLocationValue([street, number, complement, neighborhood].filter(Boolean).join(', '))
    : null;

  return {
    address: field(
      source,
      raw,
      'equipmentAddress',
      'enderecoEquipamento',
      'equipment_address',
      'enderecoInstalacao',
      'endereco_instalacao',
      'addressFull',
      'enderecoCompleto',
      'endereco_completo',
      'endereco',
      'address',
    ) || composed,
    installLocation: field(
      source,
      raw,
      'installLocation',
      'installationLocation',
      'localInstalacao',
      'localinstal',
      'LOCALINSTAL',
      'local',
      'location',
    ),
    city: field(source, raw, 'city', 'cidade'),
    state: field(source, raw, 'state', 'uf'),
    complement,
    neighborhood,
  };
}

module.exports = {
  cleanLocationValue,
  firstLocationValue,
  readEquipmentLocation,
};
