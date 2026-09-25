const assert = require('node:assert/strict');
const test = require('node:test');
const { readEquipmentLocation } = require('../src/utils/equipmentLocation');

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
