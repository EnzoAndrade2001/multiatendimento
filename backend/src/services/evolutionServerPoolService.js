const prisma = require('../lib/prisma');

// Escolhe automaticamente um servidor Evolution API do pool pra uma NOVA
// conexao de um tenant, sem exigir nenhuma acao manual. Duas regras, nessa
// ordem de prioridade:
//   1. Preferir um servidor que essa MESMA empresa ainda nao usa em nenhuma
//      outra conexao ativa dela - e o que garante que "cliente tem 2
//      numeros, cada numero numa instancia diferente" aconteca sozinho, sem
//      alguem lembrar de configurar isso a cada nova conexao.
//   2. Entre os candidatos restantes, balancear pela quantidade total de
//      conexoes (de qualquer tenant) que cada servidor ja carrega, pra nao
//      empilhar tudo num so.
//
// Sem nenhum EvolutionServer cadastrado (ou só 1), retorna null - quem
// chama cai no comportamento de sempre (padrao do tenant). Isso mantém tudo
// retrocompatível: só entra em jogo quando a operação de fato cadastrar
// mais de um servidor no pool.
async function pickServerForNewInstance(tenantId) {
  const servers = await prisma.evolutionServer.findMany({ where: { active: true } });
  if (servers.length <= 1) return servers[0] || null;

  const tenantInstances = await prisma.waInstance.findMany({
    where: { tenantId, instanceName: { not: { startsWith: 'DELETED_' } } },
    select: { evolutionUrl: true },
  });
  const urlsUsedByTenant = new Set(tenantInstances.map((i) => i.evolutionUrl).filter(Boolean));

  let candidates = servers.filter((s) => !urlsUsedByTenant.has(s.url));
  // Esse tenant ja usa todos os servidores do pool (mais numeros que
  // servidores) - nao da pra isolar mais, so balancear entre todos mesmo.
  if (candidates.length === 0) candidates = servers;

  const counts = await prisma.waInstance.groupBy({
    by: ['evolutionUrl'],
    where: {
      evolutionUrl: { in: candidates.map((s) => s.url) },
      instanceName: { not: { startsWith: 'DELETED_' } },
    },
    _count: { _all: true },
  });
  const countByUrl = new Map(counts.map((c) => [c.evolutionUrl, c._count._all]));

  candidates.sort((a, b) => (countByUrl.get(a.url) || 0) - (countByUrl.get(b.url) || 0));
  return candidates[0];
}

module.exports = { pickServerForNewInstance };
