const prisma = require('../lib/prisma');

const DEFAULT_PURPOSES = Object.freeze([
  { key: 'service_delivery', label: 'Prestação do atendimento', description: 'Uso necessário para operar o atendimento e registrar solicitações.', required: true },
  { key: 'billing_whatsapp', label: 'Cobrança pelo WhatsApp', description: 'Envio de documentos financeiros quando autorizado no contato.', required: false },
  { key: 'ai_assistance', label: 'Assistência por IA', description: 'Apoio automatizado ao atendimento conforme configuração da empresa.', required: false },
]);

function defaultPolicy() {
  return {
    version: process.env.PRIVACY_POLICY_VERSION || '2026-08-24',
    title: 'Política de Privacidade e Proteção de Dados',
    summary: 'Tratamos dados pessoais para prestar atendimento e operar as integrações configuradas com o iLux e o WhatsApp.',
    purposes: DEFAULT_PURPOSES,
    channel: { email: process.env.PRIVACY_CONTACT_EMAIL || null },
    effectiveAt: process.env.PRIVACY_POLICY_EFFECTIVE_AT || '2026-08-24T00:00:00.000Z',
  };
}

async function getCurrentPolicy(tenantId) {
  const stored = await prisma.privacyPolicy.findFirst({
    where: { tenantId, active: true, effectiveAt: { lte: new Date() } },
    orderBy: { effectiveAt: 'desc' },
  });
  if (!stored) return defaultPolicy();
  return {
    version: stored.version, title: stored.title, summary: stored.summary,
    purposes: stored.purposes, channel: stored.channel, effectiveAt: stored.effectiveAt,
  };
}

module.exports = { DEFAULT_PURPOSES, defaultPolicy, getCurrentPolicy };
