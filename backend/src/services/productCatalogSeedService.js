const FEATURES = [
  ['dashboard', 'Dashboard', 'operacao'], ['inbox', 'Atendimento WhatsApp', 'operacao'],
  ['contacts', 'Clientes e contatos', 'operacao'], ['internal_chat', 'Chat interno', 'equipe'],
  ['crm', 'CRM 360 iLux', 'ilux'], ['service_orders', 'Ordens de serviço iLux', 'ilux'],
  ['campaigns', 'Campanhas', 'automacao'], ['ai_bot', 'Robô de atendimento', 'ia'],
  ['ai_knowledge', 'Base de conhecimento', 'ia'], ['billing', 'Cobrança', 'financeiro'],
  ['billing_reports', 'Relatórios de cobrança', 'financeiro'], ['lead_generation', 'Prospecção de leads', 'comercial'],
  ['printguard', 'PrintGuard', 'telemetria'], ['telemetry', 'Telemetria', 'telemetria'],
  ['park_health', 'Saúde do parque', 'telemetria'], ['ilux_sentinel', 'iLux Sentinela', 'ilux'],
  ['audit', 'Auditoria', 'sistema'], ['connections', 'Conexões WhatsApp', 'sistema'],
  ['quick_responses', 'Respostas rápidas', 'operacao'], ['privacy', 'Privacidade e LGPD', 'sistema'],
  ['settings', 'Ajustes operacionais', 'sistema'],
];

const BASE = ['dashboard', 'inbox', 'contacts', 'audit', 'connections', 'quick_responses', 'privacy', 'settings'];
const PROFESSIONAL = [...BASE, 'internal_chat', 'crm', 'service_orders', 'campaigns', 'ai_bot', 'ai_knowledge'];
const PLANS = [
  ['essential', 'Essencial', 'Operação de atendimento', 10, { maxUsers: 5, maxConnections: 1 }, BASE],
  ['professional', 'Profissional', 'Atendimento integrado ao iLux', 20, { maxUsers: 10, maxConnections: 5 }, PROFESSIONAL],
  ['enterprise', 'Enterprise', 'Automação e gestão completa', 30, {}, FEATURES.map(([key]) => key)],
];

async function ensureProductCatalog(prisma) {
  for (const [key, name, category] of FEATURES) {
    await prisma.feature.upsert({ where: { key }, create: { key, name, category }, update: { name, category } });
  }
  const features = await prisma.feature.findMany({ select: { id: true, key: true } });
  const featureIds = new Map(features.map((feature) => [feature.key, feature.id]));
  for (const [code, name, description, position, limits, enabledKeys] of PLANS) {
    const plan = await prisma.productPlan.upsert({
      where: { code }, create: { code, name, description, position, limits },
      update: {},
    });
    for (const key of enabledKeys) {
      const featureId = featureIds.get(key);
      await prisma.planFeature.upsert({
        where: { planId_featureId: { planId: plan.id, featureId } },
        create: { planId: plan.id, featureId, enabled: true }, update: {},
      });
    }
  }
}

module.exports = { ensureProductCatalog };
