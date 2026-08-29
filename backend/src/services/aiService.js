const axios = require('axios');
const geminiService = require('./geminiService');

const PROVIDERS = Object.freeze({
  GEMINI: 'gemini',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
});

function normalizeSettings(settingsOrKey) {
  if (typeof settingsOrKey === 'string') {
    return { aiProvider: PROVIDERS.GEMINI, geminiKey: settingsOrKey };
  }
  return settingsOrKey || {};
}

function normalizeProvider(value) {
  const provider = String(value || PROVIDERS.GEMINI).trim().toLowerCase();
  if (provider === 'claude') return PROVIDERS.ANTHROPIC;
  if (provider === 'gpt') return PROVIDERS.OPENAI;
  return Object.values(PROVIDERS).includes(provider) ? provider : PROVIDERS.GEMINI;
}

function providerConfig(settingsOrKey) {
  const settings = normalizeSettings(settingsOrKey);
  const provider = normalizeProvider(settings.aiProvider);
  const keys = {
    [PROVIDERS.GEMINI]: settings.geminiKey || process.env.GEMINI_API_KEY,
    [PROVIDERS.OPENAI]: settings.openaiKey || process.env.OPENAI_API_KEY,
    [PROVIDERS.ANTHROPIC]: settings.anthropicKey || process.env.ANTHROPIC_API_KEY,
  };
  const defaultModels = {
    [PROVIDERS.GEMINI]: null,
    [PROVIDERS.OPENAI]: process.env.OPENAI_CHAT_MODEL || null,
    [PROVIDERS.ANTHROPIC]: process.env.ANTHROPIC_CHAT_MODEL || null,
  };
  const key = keys[provider];
  const model = settings.aiModel || defaultModels[provider];
  if (!key) throw new Error(`Chave do provedor de IA "${provider}" não configurada.`);
  if (provider !== PROVIDERS.GEMINI && !model) {
    throw new Error(`Informe o modelo que será usado pelo provedor "${provider}".`);
  }
  return { provider, key, model, settings };
}

function hasConfiguredProvider(settingsOrKey) {
  try {
    providerConfig(settingsOrKey);
    return true;
  } catch {
    return false;
  }
}

function plainText(contents) {
  if (typeof contents === 'string') return contents;
  if (!Array.isArray(contents)) return String(contents || '');
  return contents.map((item) => {
    if (typeof item === 'string') return item;
    if (item?.text) return item.text;
    if (Array.isArray(item?.parts)) return item.parts.map((part) => part?.text || '').join('\n');
    return '';
  }).filter(Boolean).join('\n');
}

function historyMessages(history = []) {
  return history
    .filter((item) => item?.body)
    .map((item) => ({
      role: item.fromMe || item.fromBot ? 'assistant' : 'user',
      content: String(item.body),
    }));
}

function parseOpenAIText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' || typeof item?.text === 'string')
    .map((item) => item.text || '')
    .join('\n')
    .trim();
}

async function openAIText(config, { systemPrompt, messages, prompt, maxOutputTokens = 1200 }) {
  const input = messages?.length
    ? [...messages, ...(prompt ? [{ role: 'user', content: prompt }] : [])]
    : prompt;
  const { data } = await axios.post('https://api.openai.com/v1/responses', {
    model: config.model,
    ...(systemPrompt ? { instructions: systemPrompt } : {}),
    input,
    max_output_tokens: maxOutputTokens,
  }, {
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    timeout: 60_000,
  });
  const text = parseOpenAIText(data);
  if (!text) throw new Error('A OpenAI não retornou conteúdo textual.');
  return { text, model: data?.model || config.model };
}

async function anthropicText(config, { systemPrompt, messages, prompt, maxOutputTokens = 1200 }) {
  const normalizedMessages = messages?.length
    ? [...messages, ...(prompt ? [{ role: 'user', content: prompt }] : [])]
    : [{ role: 'user', content: prompt }];
  const { data } = await axios.post('https://api.anthropic.com/v1/messages', {
    model: config.model,
    max_tokens: maxOutputTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: normalizedMessages,
  }, {
    headers: {
      'x-api-key': config.key,
      'anthropic-version': process.env.ANTHROPIC_API_VERSION || '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 60_000,
  });
  const text = (data?.content || []).filter((item) => item?.type === 'text').map((item) => item.text).join('\n').trim();
  if (!text) throw new Error('A Anthropic não retornou conteúdo textual.');
  return { text, model: data?.model || config.model };
}

async function selectedText(settingsOrKey, payload) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.OPENAI) return openAIText(config, payload);
  if (config.provider === PROVIDERS.ANTHROPIC) return anthropicText(config, payload);
  throw new Error('selectedText não deve ser usado para o adaptador Gemini.');
}

async function generateText(settingsOrKey, contents, options = {}) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) {
    return geminiService.generateText(config.key, contents, options);
  }
  const result = await selectedText(settingsOrKey, {
    systemPrompt: options.systemInstruction,
    prompt: plainText(contents),
    maxOutputTokens: options.maxOutputTokens,
  });
  return result.text;
}

async function chat(settingsOrKey, systemPrompt, history, userMessage, options = {}) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) {
    const result = await geminiService.chat(config.key, systemPrompt, history, userMessage, options);
    return options.returnMetadata && result && typeof result === 'object'
      ? { ...result, provider: PROVIDERS.GEMINI }
      : result;
  }
  const result = await selectedText(settingsOrKey, {
    systemPrompt,
    messages: historyMessages(history),
    prompt: userMessage,
    maxOutputTokens: options.maxOutputTokens || 1000,
  });
  return options.returnMetadata ? { ...result, provider: config.provider } : result.text;
}

async function summarize(settingsOrKey, systemPrompt, history, userMessage) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) return geminiService.summarize(config.key, systemPrompt, history, userMessage);
  const result = await selectedText(settingsOrKey, {
    systemPrompt,
    messages: historyMessages(history),
    prompt: userMessage,
    maxOutputTokens: 1200,
  });
  return result.text;
}

async function generateTags(settingsOrKey, history, allowedTags = []) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) return geminiService.generateTags(config.key, history, allowedTags);
  const restriction = allowedTags.length
    ? `Escolha somente entre: ${allowedTags.join(', ')}. Se nenhuma servir, retorne vazio.`
    : 'Crie tags curtas.';
  const text = await summarize(settingsOrKey,
    'Você classifica conversas. Retorne somente até 3 tags separadas por vírgula, sem explicações.',
    history,
    restriction);
  const tags = text.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
  return allowedTags.length ? tags.filter((tag) => allowedTags.includes(tag)) : tags;
}

async function generateTransferSummary(settingsOrKey, history) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) return geminiService.generateTransferSummary(config.key, history);
  return summarize(settingsOrKey, 'Você resume atendimentos para transferência entre agentes.', history, 'Gere um resumo curto e objetivo desta conversa.');
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
  } catch {
    return fallback;
  }
}

async function extractClientInfo(settingsOrKey, history, currentNotes) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) return geminiService.extractClientInfo(config.key, history, currentNotes);
  const prompt = `Ficha atual:\n${currentNotes || 'Sem ficha.'}\n\nExtraia somente informações realmente informadas pelo cliente. Retorne JSON com {"name": string|null, "notes": string|null}.`;
  const text = await summarize(settingsOrKey, 'Extraia dados cadastrais sem inventar informações. Responda somente JSON válido.', history, prompt);
  const parsed = parseJson(text, null);
  return parsed?.name || parsed?.notes ? { name: parsed.name || null, notes: parsed.notes || null } : null;
}

async function draftServiceOrder(settingsOrKey, history, equipments) {
  const config = providerConfig(settingsOrKey);
  if (config.provider === PROVIDERS.GEMINI) return geminiService.draftServiceOrder(config.key, history, equipments);
  const equipmentList = equipments.map((item) => `[ID: ${item.id}] ${item.model}`).join('\n');
  const text = await summarize(settingsOrKey,
    'Crie rascunhos de ordem de serviço sem inventar defeitos. Responda somente JSON válido.',
    history,
    `Equipamentos:\n${equipmentList}\nRetorne {"defect":"string", "equipmentId":"id ou null"}.`);
  return parseJson(text, { defect: null, equipmentId: null });
}

// Embeddings, leitura integral de documentos e áudio continuam com o Gemini
// como motor especializado. Isso preserva a base RAG já indexada e permite
// trocar apenas a LLM de atendimento sem invalidar os vetores existentes.
function geminiCapabilityKey(settingsOrKey) {
  const settings = normalizeSettings(settingsOrKey);
  const key = settings.geminiKey || (typeof settingsOrKey === 'string' ? settingsOrKey : null) || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('A chave Gemini é necessária para esta capacidade multimodal/RAG.');
  return key;
}

const getEmbedding = (settingsOrKey, text, options) => geminiService.getEmbedding(geminiCapabilityKey(settingsOrKey), text, options);
const transcribeAudio = (settingsOrKey, data, mimeType) => geminiService.transcribeAudio(geminiCapabilityKey(settingsOrKey), data, mimeType);
const analyzeImage = (settingsOrKey, data, mimeType, prompt) => geminiService.analyzeImage(geminiCapabilityKey(settingsOrKey), data, mimeType, prompt);
const extractDocumentText = (settingsOrKey, data, mimeType) => geminiService.extractDocumentText(geminiCapabilityKey(settingsOrKey), data, mimeType);

async function testProvider(settingsOrKey) {
  const config = providerConfig(settingsOrKey);
  const startedAt = Date.now();
  const response = config.provider === PROVIDERS.GEMINI
    ? await geminiService.generateText(config.key, 'Responda apenas OK.', { profile: 'light', maxOutputTokens: 100 })
    : (await selectedText(settingsOrKey, { prompt: 'Responda apenas OK.', maxOutputTokens: 100 })).text;
  return { ok: Boolean(response), provider: config.provider, model: config.model, latencyMs: Date.now() - startedAt };
}

module.exports = {
  PROVIDERS,
  normalizeProvider,
  providerConfig,
  hasConfiguredProvider,
  generateText,
  chat,
  summarize,
  generateTags,
  generateTransferSummary,
  extractClientInfo,
  draftServiceOrder,
  getEmbedding,
  transcribeAudio,
  analyzeImage,
  extractDocumentText,
  cosineSimilarity: geminiService.cosineSimilarity,
  testProvider,
  __testing: { plainText, historyMessages, parseOpenAIText, parseJson },
};
