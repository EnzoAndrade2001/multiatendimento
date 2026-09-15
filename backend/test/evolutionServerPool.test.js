const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const { pickServerForNewInstance } = require('../src/services/evolutionServerPoolService');

function patchPrisma(context, { servers, tenantUrls = [], counts = [] }) {
  const original = {
    findManyServers: prisma.evolutionServer.findMany,
    findManyInstances: prisma.waInstance.findMany,
    groupBy: prisma.waInstance.groupBy,
  };
  context.after(() => {
    prisma.evolutionServer.findMany = original.findManyServers;
    prisma.waInstance.findMany = original.findManyInstances;
    prisma.waInstance.groupBy = original.groupBy;
  });
  prisma.evolutionServer.findMany = async () => servers;
  prisma.waInstance.findMany = async () => tenantUrls.map((evolutionUrl) => ({ evolutionUrl }));
  prisma.waInstance.groupBy = async () => counts;
}

test('sem servidor nenhum no pool -> null (cai no padrão de sempre)', async (t) => {
  patchPrisma(t, { servers: [] });
  assert.equal(await pickServerForNewInstance('tenant-1'), null);
});

test('só 1 servidor no pool -> retorna ele direto, sem nem olhar o tenant', async (t) => {
  const solo = { id: 's1', name: 'unico', url: 'https://evo1', apiKey: 'k1', active: true };
  patchPrisma(t, { servers: [solo] });
  const picked = await pickServerForNewInstance('tenant-1');
  assert.equal(picked.id, 's1');
});

test('empresa já usa um servidor -> escolhe o outro que ela ainda não usa', async (t) => {
  const s1 = { id: 's1', name: 'a', url: 'https://evo1', apiKey: 'k1' };
  const s2 = { id: 's2', name: 'b', url: 'https://evo2', apiKey: 'k2' };
  patchPrisma(t, {
    servers: [s1, s2],
    tenantUrls: ['https://evo1'], // essa empresa já tem uma conexão no evo1
    counts: [{ evolutionUrl: 'https://evo2', _count: { _all: 5 } }], // evo2 até mais cheio, não importa
  });
  const picked = await pickServerForNewInstance('tenant-1');
  assert.equal(picked.url, 'https://evo2');
});

test('empresa nova, nenhum servidor usado ainda -> balanceia pelo menos carregado', async (t) => {
  const s1 = { id: 's1', name: 'a', url: 'https://evo1', apiKey: 'k1' };
  const s2 = { id: 's2', name: 'b', url: 'https://evo2', apiKey: 'k2' };
  patchPrisma(t, {
    servers: [s1, s2],
    tenantUrls: [],
    counts: [
      { evolutionUrl: 'https://evo1', _count: { _all: 10 } },
      { evolutionUrl: 'https://evo2', _count: { _all: 3 } },
    ],
  });
  const picked = await pickServerForNewInstance('tenant-1');
  assert.equal(picked.url, 'https://evo2');
});

test('empresa já ocupa todos os servidores do pool -> balanceia entre todos mesmo (não trava)', async (t) => {
  const s1 = { id: 's1', name: 'a', url: 'https://evo1', apiKey: 'k1' };
  const s2 = { id: 's2', name: 'b', url: 'https://evo2', apiKey: 'k2' };
  patchPrisma(t, {
    servers: [s1, s2],
    tenantUrls: ['https://evo1', 'https://evo2'],
    counts: [
      { evolutionUrl: 'https://evo1', _count: { _all: 8 } },
      { evolutionUrl: 'https://evo2', _count: { _all: 2 } },
    ],
  });
  const picked = await pickServerForNewInstance('tenant-1');
  assert.equal(picked.url, 'https://evo2');
});

test('servidor inativo nunca entra no pool (filtro é feito na própria query, aqui só garante que null sobrevive)', async (t) => {
  patchPrisma(t, { servers: [] }); // simula que o findMany({where:{active:true}}) já filtrou tudo
  assert.equal(await pickServerForNewInstance('tenant-1'), null);
});
