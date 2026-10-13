const assert = require('node:assert/strict');
const test = require('node:test');
const { readEquipmentLocation, desmembrarEndereco, resolveOsDocumentAddress } = require('../src/utils/equipmentLocation');

test('prioriza endereço específico de instalação sobre address genérico', () => {
  const location = readEquipmentLocation({
    address: 'Endereço do cliente',
    enderecoInstalacao: 'Rua da máquina, 120',
    localInstalacao: 'Filial Norte',
    cidade: 'Campinas',
    uf: 'SP',
  });

  assert.equal(location.address, 'Rua da máquina, 120');
  assert.equal(location.installLocation, 'Filial Norte');
  assert.equal(location.city, 'Campinas');
  assert.equal(location.state, 'SP');
});

test('não inventa endereço do cliente quando o equipamento não tem endereço próprio', () => {
  const location = readEquipmentLocation({
    customerAddress: 'Rua da sede, 1',
    localInstalacao: 'Sala técnica',
  });

  assert.equal(location.address, null);
  assert.equal(location.installLocation, 'Sala técnica');
});

test('compõe endereço quando o LCD envia logradouro e número separados', () => {
  const location = readEquipmentLocation({
    logradouro: 'Av. Brasil',
    num: '500',
    complemento: 'Bloco B',
    bairro: 'Centro',
  });

  assert.equal(location.address, 'Av. Brasil, 500, Bloco B, Centro');
});

test('não usa bairro ou complemento isolado como endereço', () => {
  const location = readEquipmentLocation({
    bairro: 'Centro',
    complemento: 'Sala 4',
    cidade: 'Campinas',
  });

  assert.equal(location.address, null);
  assert.equal(location.neighborhood, 'Centro');
  assert.equal(location.complement, 'Sala 4');
});

test('desmembrarEndereco extrai corretamente rua, bairro, cidade, uf e cep', () => {
  const parsed = desmembrarEndereco('AV. EDGAR PIRES DE CASTRO, 1841, HIPICA, PORTO ALEGRE/RS, CEP 91787-831');
  assert.deepEqual(parsed, {
    enderecoLinha: 'AV. EDGAR PIRES DE CASTRO, 1841',
    bairro: 'HIPICA',
    cidade: 'PORTO ALEGRE',
    uf: 'RS',
    cep: '91787-831',
  });
});

test('resolveOsDocumentAddress prioriza endereço estruturado do equipamento sobre CNPJ do cliente', () => {
  const resolved = resolveOsDocumentAddress({
    iluxOrderData: {
      equipmentLogradouro: 'AV. EDGAR PIRES DE CASTRO',
      equipmentNumero: '1841',
      equipmentBairro: 'HIPICA',
      equipmentCidade: 'PORTO ALEGRE',
      equipmentUf: 'RS',
      equipmentCep: '91787831',
      clientAddress: 'AVENIDA PROTASIO ALVES, 4596',
      clientNeighborhood: 'PETROPOLIS',
      clientCity: 'PORTO ALEGRE',
      clientState: 'RS',
      clientZipCode: '91310000',
    },
    crmCustomer: {
      address: 'AVENIDA PROTASIO ALVES, 4596',
      neighborhood: 'PETROPOLIS',
      city: 'PORTO ALEGRE',
      state: 'RS',
      zipCode: '91310000',
    },
  });

  assert.equal(resolved.address, 'AV. EDGAR PIRES DE CASTRO, nº 1841');
  assert.equal(resolved.neighborhood, 'HIPICA');
  assert.equal(resolved.city, 'PORTO ALEGRE');
  assert.equal(resolved.state, 'RS');
  assert.equal(resolved.zipCode, '91787831');
});

test('resolveOsDocumentAddress faz fallback para CNPJ se o equipamento não tiver endereço', () => {
  const resolved = resolveOsDocumentAddress({
    iluxOrderData: {
      clientAddress: 'RUA DO CLIENTE, 100',
      clientNeighborhood: 'CENTRO',
      clientCity: 'CANOAS',
      clientState: 'RS',
      clientZipCode: '92000000',
    },
  });

  assert.equal(resolved.address, 'RUA DO CLIENTE, 100');
  assert.equal(resolved.neighborhood, 'CENTRO');
  assert.equal(resolved.city, 'CANOAS');
  assert.equal(resolved.state, 'RS');
  assert.equal(resolved.zipCode, '92000000');
});
