const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

const SERVICE_ORDER_NUMBER = /\b(?:o\.?\s*s\.?|ordem\s+de\s+servi[cç]o|chamado)\s*(?:n(?:[uú]mero)?\s*[º°o.]?|#|:)?\s*\d{3,}\b/i;
const COMPLETED_OPENING = /\b(?:o\.?\s*s\.?|ordem\s+de\s+servi[cç]o|chamado)\b[\s\S]{0,80}\b(?:foi|est[aá]|ficou|j[aá]|acabamos\s+de)?\s*(?:abert[ao]|criad[ao]|gerad[ao]|registrad[ao]|protocolad[ao]|conclu[ií]d[ao]|fechad[ao]|em\s+atendimento)\b/i;
const REVERSED_OPENING = /\b(?:abert[ao]|criad[ao]|gerad[ao]|registrad[ao]|protocolad[ao]|conclu[ií]d[ao]|fechad[ao])\b[\s\S]{0,50}\b(?:o\.?\s*s\.?|ordem\s+de\s+servi[cç]o|chamado)\b/i;
const NUMERIC_DEADLINE = /\b(?:prazo|previs[aã]o|atendimento|t[eé]cnic[oa]|visita|retorno|solu[cç][aã]o)\b[\s\S]{0,90}\b\d+\s*(?:minutos?|horas?|dias?(?:\s+[uú]teis)?)\b/i;
const REVERSED_DEADLINE = /\b\d+\s*(?:minutos?|horas?|dias?(?:\s+[uú]teis)?)\b[\s\S]{0,90}\b(?:prazo|previs[aã]o|atendimento|t[eé]cnic[oa]|visita|retorno|solu[cç][aã]o)\b/i;

function operationalClaimReasons(text) {
  const value = String(text || '').trim();
  if (!value) return [];
  const reasons = [];
  if (SERVICE_ORDER_NUMBER.test(value)) reasons.push('service_order_number');
  if (COMPLETED_OPENING.test(value) || REVERSED_OPENING.test(value)) reasons.push('unverified_service_order_status');
  if (NUMERIC_DEADLINE.test(value) || REVERSED_DEADLINE.test(value)) reasons.push('unverified_deadline');
  return [...new Set(reasons)];
}

function isUnsafeOperationalClaim(text) {
  return operationalClaimReasons(text).length > 0;
}

function guardBotReply(text) {
  const reasons = operationalClaimReasons(text);
  if (!reasons.length) return { blocked: false, reasons, reply: String(text || '').trim() };
  return {
    blocked: true,
    reasons,
    reply: 'Entendido! Encaminhei sua solicitação para a equipe responsável. A abertura da O.S., o número, o status e o prazo de atendimento serão confirmados por um atendente após a validação no iLux.',
  };
}

function selectCurrentSessionHistory(messages, currentAt = new Date(), gapMs = SESSION_GAP_MS) {
  const ordered = [...(messages || [])]
    .filter((message) => message?.createdAt)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const session = [];
  let newerAt = new Date(currentAt).getTime();
  for (const message of ordered) {
    const messageAt = new Date(message.createdAt).getTime();
    if (!Number.isFinite(messageAt) || newerAt - messageAt > gapMs) break;
    session.push(message);
    newerAt = messageAt;
  }
  return session.reverse();
}

module.exports = {
  SESSION_GAP_MS,
  guardBotReply,
  isUnsafeOperationalClaim,
  operationalClaimReasons,
  selectCurrentSessionHistory,
};
