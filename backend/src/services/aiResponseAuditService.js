const RESPONSE_ORIGINS = Object.freeze({
  RAG: 'RAG',
  ILUX_DATA: 'ILUX_DATA',
  LLM_GENERAL: 'LLM_GENERAL',
  MIXED: 'MIXED',
});

/**
 * Registra as fontes que foram disponibilizadas ao modelo. O Gemini não
 * expõe uma explicação verificável do seu raciocínio, portanto este dado é
 * uma origem provável/contextual e não uma alegação sobre o pensamento do
 * modelo.
 */
function classifyResponseOrigin({ found = false, equipmentCount = 0, currentNotes = '', responseModel = null } = {}) {
  const sources = [];
  const hasIluxData = Number(equipmentCount) > 0 || Boolean(String(currentNotes || '').trim());

  if (found) sources.push(RESPONSE_ORIGINS.RAG);
  if (hasIluxData) sources.push(RESPONSE_ORIGINS.ILUX_DATA);

  // Sem uma fonte oficial recuperada, o conteúdo factual adicional só pode
  // ter vindo do conhecimento geral do modelo (ou deve ser revisado).
  if (!found) sources.push(RESPONSE_ORIGINS.LLM_GENERAL);

  let origin = sources[0] || RESPONSE_ORIGINS.LLM_GENERAL;
  if (sources.length > 1) origin = RESPONSE_ORIGINS.MIXED;

  return {
    origin,
    sources,
    responseModel: responseModel || null,
    confidence: 'inferred',
  };
}

function formatResponseOrigin(origin) {
  const labels = {
    [RESPONSE_ORIGINS.RAG]: 'RAG',
    [RESPONSE_ORIGINS.ILUX_DATA]: 'Dados do iLux',
    [RESPONSE_ORIGINS.LLM_GENERAL]: 'Conhecimento geral da IA',
    [RESPONSE_ORIGINS.MIXED]: 'Misto',
  };
  return labels[origin] || origin || 'Não identificado';
}

module.exports = { RESPONSE_ORIGINS, classifyResponseOrigin, formatResponseOrigin };
