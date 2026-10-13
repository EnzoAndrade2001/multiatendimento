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

function desmembrarEndereco(str) {
  if (!str || typeof str !== 'string' || !str.trim()) return null;
  const parts = str.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let cep = '';
  let cidade = '';
  let uf = '';
  let bairro = '';

  // 1. Procura item com CEP
  const cepIdx = parts.findIndex((p) => /^CEP\b/i.test(p) || /^\d{5}-?\d{3}$/.test(p));
  if (cepIdx !== -1) {
    cep = parts[cepIdx].replace(/^CEP\s*:?\s*/i, '').trim();
    parts.splice(cepIdx, 1);
  }

  // 2. Procura item com Cidade/UF (ex: "PORTO ALEGRE/RS", "BOM PRINCIPIO/RS")
  const cidIdx = parts.findIndex((p) => /\/\s*[A-Za-z]{2}$/.test(p) || /\s+-\s+[A-Za-z]{2}$/.test(p));
  if (cidIdx !== -1) {
    const cidPart = parts[cidIdx];
    if (cidPart.includes('/')) {
      const slashIdx = cidPart.lastIndexOf('/');
      cidade = cidPart.substring(0, slashIdx).replace(/\s*\([A-Za-z]{2}\)/i, '').trim();
      uf = cidPart.substring(slashIdx + 1).trim().toUpperCase();
    } else {
      const dashIdx = cidPart.lastIndexOf('-');
      cidade = cidPart.substring(0, dashIdx).replace(/\s*\([A-Za-z]{2}\)/i, '').trim();
      uf = cidPart.substring(dashIdx + 1).trim().toUpperCase();
    }
    parts.splice(cidIdx, 1);
  }

  // 3. Se restaram 2 ou mais partes, a última parte antes da cidade/UF é o bairro
  if (parts.length >= 2) {
    const candidataBairro = parts[parts.length - 1];
    if (!/^(n[oº\d]|sala|loja|apto|andar|pav|box|conj)/i.test(candidataBairro)) {
      bairro = parts.pop();
    }
  }

  const enderecoLinha = parts.join(', ');
  return { enderecoLinha, bairro, cidade, uf, cep };
}

function normalizeAddressLine(value) {
  if (!value) return '';
  return String(value)
    .replace(/\s+n[º°o]\s*/gi, ', nº ')
    .replace(/\s*,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve o endereço completo para exibição/impressão da O.S.,
 * priorizando SEMPRE o endereço cadastrado no equipamento/vínculo de instalação
 * em detrimento do endereço fiscal do CNPJ do cliente.
 */
function resolveOsDocumentAddress({
  iluxOrderData = {},
  crmEquipment = null,
  localEquipment = null,
  firebirdOrder = {},
  firebirdEquipment = {},
  firebirdClient = {},
  crmCustomer = null,
  clientData = {},
} = {}) {
  const rawCrm = crmEquipment?.raw && typeof crmEquipment.raw === 'object' ? crmEquipment.raw : {};
  const rawFb = firebirdEquipment || {};

  // 1. Campos estruturados vindos do vínculo oficial da máquina no LCDWEB (serializarOsParaCrm)
  const iluxHasLogradouro = Boolean(iluxOrderData.equipmentLogradouro && String(iluxOrderData.equipmentLogradouro).trim());
  const iluxStructuredLine = iluxHasLogradouro
    ? [
        String(iluxOrderData.equipmentLogradouro).trim(),
        iluxOrderData.equipmentNumero ? (String(iluxOrderData.equipmentNumero).trim().startsWith('nº') ? String(iluxOrderData.equipmentNumero).trim() : `nº ${String(iluxOrderData.equipmentNumero).trim()}`) : null,
        iluxOrderData.equipmentComplemento ? String(iluxOrderData.equipmentComplemento).trim() : null,
      ].filter(Boolean).join(', ')
    : '';

  // 2. Campos estruturados no crmEquipment / raw
  const crmStreet = rawCrm.logradouro || rawCrm.street;
  const crmNum = rawCrm.numero || rawCrm.num || rawCrm.number;
  const crmComplement = rawCrm.complemento || rawCrm.complement;
  const crmStructuredLine = crmStreet
    ? [
        String(crmStreet).trim(),
        crmNum ? (String(crmNum).trim().startsWith('nº') ? String(crmNum).trim() : `nº ${String(crmNum).trim()}`) : null,
        crmComplement ? String(crmComplement).trim() : null,
      ].filter(Boolean).join(', ')
    : '';

  // 3. String de atendimento na O.S. (iluxOrderData.enderecoAtendimento ou equipmentAddress)
  const rawAtendimentoStr = cleanLocationValue(
    iluxOrderData.enderecoAtendimento
    || iluxOrderData.equipmentAddress
    || iluxOrderData.equipmentInstallLocation
    || crmEquipment?.address
    || localEquipment?.address
    || rawFb.endereco
    || rawFb.address
  );
  const parsedAtendimento = desmembrarEndereco(rawAtendimentoStr);

  // 4. Local de instalação da máquina (texto descritivo)
  const localEquip = cleanLocationValue(
    iluxOrderData.equipmentLocation
    || crmEquipment?.installLocation
    || rawCrm.localinstal
    || rawCrm.LOCALINSTAL
    || rawFb.localinstal
    || localEquipment?.sector
  );

  // 5. Endereço fiscal do cliente (fallback somente se a máquina não tiver endereço)
  const clientStreet = cleanLocationValue(clientData.logradouro || firebirdClient.logradouro || firebirdClient.endereco || crmCustomer?.address || clientData.address);
  const clientNum = cleanLocationValue(clientData.numero || firebirdClient.num || firebirdClient.numero);
  const clientCompl = cleanLocationValue(clientData.complemento || firebirdClient.complemento);
  const clientStructuredLine = clientStreet
    ? [
        clientStreet,
        clientNum ? (clientNum.startsWith('nº') ? clientNum : `nº ${clientNum}`) : null,
        clientCompl,
      ].filter(Boolean).join(', ')
    : '';

  // Determina a linha principal de endereço
  let addressLine = '';
  if (iluxStructuredLine) {
    addressLine = iluxStructuredLine;
  } else if (crmStructuredLine) {
    addressLine = crmStructuredLine;
  } else if (parsedAtendimento?.enderecoLinha) {
    addressLine = parsedAtendimento.enderecoLinha;
  } else if (rawAtendimentoStr) {
    addressLine = rawAtendimentoStr;
  } else if (localEquip && localEquip !== '-' && localEquip !== 'N/A') {
    addressLine = localEquip;
  } else if (clientStructuredLine) {
    addressLine = clientStructuredLine;
  } else {
    addressLine = cleanLocationValue(iluxOrderData.clientAddress || crmCustomer?.address || clientData.address || 'Endereço a definir');
  }

  // Bairro
  const neighborhood = firstLocationValue(
    iluxOrderData.equipmentBairro,
    rawCrm.bairro,
    rawCrm.neighborhood,
    parsedAtendimento?.bairro,
    rawFb.bairro,
    crmEquipment?.neighborhood,
    iluxOrderData.clientNeighborhood,
    firebirdOrder.bairro,
    firebirdClient.bairro,
    crmCustomer?.neighborhood,
    clientData.neighborhood,
    clientData.bairro,
    ''
  );

  // Cidade
  let city = firstLocationValue(
    iluxOrderData.equipmentCidade,
    rawCrm.cidade,
    rawCrm.city,
    parsedAtendimento?.cidade,
    crmEquipment?.city,
    rawFb.cidade,
    iluxOrderData.clientCity,
    firebirdOrder.cidade,
    firebirdClient.cidade,
    crmCustomer?.city,
    clientData.city,
    'Porto Alegre'
  );
  city = String(city || '').replace(/\s*\([A-Za-z]{2}\)/i, '').trim();

  // Estado / UF
  let state = firstLocationValue(
    iluxOrderData.equipmentUf,
    rawCrm.uf,
    rawCrm.state,
    parsedAtendimento?.uf,
    crmEquipment?.state,
    rawFb.uf,
    iluxOrderData.clientState,
    firebirdOrder.uf,
    firebirdClient.uf,
    crmCustomer?.state,
    clientData.state,
    'RS'
  );
  state = String(state || '').trim().toUpperCase();

  // CEP
  let zipCode = firstLocationValue(
    iluxOrderData.equipmentCep,
    rawCrm.cep,
    rawCrm.zipCode,
    parsedAtendimento?.cep,
    rawFb.cep,
    iluxOrderData.clientZipCode,
    firebirdOrder.cep,
    firebirdClient.cep,
    crmCustomer?.zipCode,
    clientData.zipCode,
    clientData.cep,
    ''
  );

  return {
    address: normalizeAddressLine(addressLine),
    neighborhood: neighborhood || '',
    city: city || 'Porto Alegre',
    state: state || 'RS',
    zipCode: zipCode || '',
  };
}

module.exports = {
  cleanLocationValue,
  firstLocationValue,
  readEquipmentLocation,
  desmembrarEndereco,
  normalizeAddressLine,
  resolveOsDocumentAddress,
};
