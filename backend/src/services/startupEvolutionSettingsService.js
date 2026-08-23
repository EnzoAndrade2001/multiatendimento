async function repairInvalidEvolutionSettings(prisma, env = process.env, logger = console) {
  const evolutionUrl = String(env.DEFAULT_EVOLUTION_URL || '').trim();
  const evolutionKey = String(env.DEFAULT_EVOLUTION_KEY || '').trim();
  if (!evolutionUrl || !evolutionKey) {
    logger.warn('[startup-fix] Auto-correcao ignorada: defaults da Evolution nao configurados no ambiente.');
    return { skipped: true, updated: 0 };
  }

  const badSettings = await prisma.tenantSettings.findMany({
    where: { evolutionUrl: { contains: '@' } },
  });
  for (const settings of badSettings) {
    await prisma.tenantSettings.update({
      where: { id: settings.id },
      data: { evolutionUrl, evolutionKey },
    });
  }
  if (badSettings.length > 0) {
    logger.log(`[startup-fix] ${badSettings.length} configuracao(oes) Evolution invalida(s) corrigida(s) com defaults do ambiente.`);
  }
  return { skipped: false, updated: badSettings.length };
}

module.exports = { repairInvalidEvolutionSettings };
