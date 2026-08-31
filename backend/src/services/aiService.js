const axios = require('axios');
const geminiService = require('./geminiService');

const PROVIDERS = Object.freeze({
  GEMINI: 'gemini',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
});

// Fallback de modelo de conversa quando o tenant não escolheu nada e ainda não
// há catálogo descoberto. São aliases estáveis; o normal é o catálogo mandar.
const CHAT_DEFAULTS = {
  [PROVIDERS.OPENAI]: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  [PROVIDERS.ANTHROPIC]: process.env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-sonnet-latest',
};

const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
const OPENAI_EMBED_DIMENSIONS = Number.parseInt(process.env.OPENAI_EMBED_DIMENSIONS, 10) || null;
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_VERSION = process.env.ANTHROPIC_API_VERSION || '2023-06-01';

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

function normalizeAuxProvider(value) {
  const aux = String(value || '').trim().toLowerCase();
  return aux === PROVIDERS.OPENAI || aux === PROVIDERS.GEMINI ? aux : null;
}

function catalogModel(settings, provider) {
  const entry = settings?.aiModelCatalog?.[provider];
  const first = Array.isArray(entry?.models) ? entry.models[0] : null;
  if (!first) return null;
  return typeof first === 'string' ? first : first.id || null;
}

function providerConfig(settingsOrKey) {
  const settings = normalizeSettings(settingsOrKey);
  const provider = normalizeProvider(settings.aiProvider);
  const keys = {
    [PROVIDERS.GEMINI]: settings.geminiKey || process.env.GEMINI_API_KEY,
    [PROVIDERS.OPENAI]: settings.openaiKey || process.env.OPENAI_API_KEY,
    [PROVIDERS.ANTHROPIC]: settings.anthropicKey || process.env.ANTHROPIC_API_KEY,
  };
  const key = keys[provider];
  if (!key) throw new Error(`Chave do provedor de IA "${provider}" não configurada.`);
  // Gemini resolve o modelo internamente. Para OpenAI/Anthropic: escolha
  // explícita > primeiro do catálogo validado > fallback estático.
  const model = provider === PROVIDERS.GEMINI
    ? null
    : (settings.aiModel || catalogModel(settings, provider) || CHAT_DEFAULTS[provider] || null);
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

// Resolve qual motor atende uma capacidade que o provedor principal pode não
// ter (embedding/áudio no Claude). Retorna { engine: null } quando não há como
// atender — o chamador degrada (busca por palavra-chave / áudio sem transcrição).
function resolveCapabilityEngine(settingsOrKey, capability) {
  const settings = normalizeSettings(settingsOrKey);
  const provider = normalizeProvider(settings.aiProvider);
  const geminiKey = settings.geminiKey || (typeof settingsOrKey === 'string' ? settingsOrKey : null) || process.env.GEMINI_API_KEY;
  const openaiKey = settings.openaiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (provider === PROVIDERS.GEMINI) {
    return geminiKey ? { engine: PROVIDERS.GEMINI, key: geminiKey } : { engine: null };
  }
  if (provider === PROVIDERS.OPENAI) {
    return openaiKey ? { engine: PROVIDERS.OPENAI, key: openaiKey } : { engine: null };
  }
  // Anthropic: visão e leitura de PDF são nativas do Claude; embedding e áudio
  // dependem do motor auxiliar.
  if (capability === 'vision' || capability === 'document') {
    return anthropicKey ? { engine: PROVIDERS.ANTHROPIC, key: anthropicKey } : { engine: null };
  }
  const aux = normalizeAuxProvider(settings.aiAuxProvider);
  if (aux === PROVIDERS.OPENAI && openaiKey) return { engine: PROVIDERS.OPENAI, key: openaiKey };
  if (aux === PROVIDERS.GEMINI && geminiKey) return { engine: PROVIDERS.GEMINI, key: geminiKey };
  return { engine: null };
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
      'anthropic-version': ANTHROPIC_API_VERSION,
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

/* ----------------------------- Capacidades multimodais / RAG ---------------- */

async function openAIEmbedding(key, text) {
  const { data } = await axios.post('https://api.openai.com/v1/embeddings', {
    model: OPENAI_EMBED_MODEL,
    input: String(text || '').slice(0, 30_000),
    ...(OPENAI_EMBED_DIMENSIONS ? { dimensions: OPENAI_EMBED_DIMENSIONS } : {}),
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
  return data?.data?.[0]?.embedding || null;
}

async function openAITranscribe(key, audioBase64, mimeType) {
  const buffer = Buffer.from(audioBase64, 'base64');
  const ext = String(mimeType || '').includes('mp3') ? 'mp3'
    : String(mimeType || '').includes('wav') ? 'wav'
      : String(mimeType || '').includes('mp4') || String(mimeType || '').includes('m4a') ? 'm4a'
        : 'ogg';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/ogg' }), `audio.${ext}`);
  form.append('model', OPENAI_TRANSCRIBE_MODEL);
  const { data } = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { Authorization: `Bearer ${key}` },
    timeout: 120_000,
    maxBodyLength: Infinity,
  });
  return (data?.text || '').trim() || null;
}

async function openAIMultimodal(key, { base64, mimeType, prompt, kind }) {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const part = kind === 'document'
    ? { type: 'input_file', filename: 'documento.pdf', file_data: dataUrl }
    : { type: 'input_image', image_url: dataUrl };
  const { data } = await axios.post('https://api.openai.com/v1/responses', {
    model: OPENAI_VISION_MODEL,
    input: [{ role: 'user', content: [part, { type: 'input_text', text: prompt }] }],
    max_output_tokens: 2000,
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 90_000,
    maxBodyLength: Infinity,
  });
  return parseOpenAIText(data) || null;
}

async function anthropicMultimodal(key, model, { base64, mimeType, prompt, kind }) {
  const block = kind === 'document'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/png', data: base64 } };
  const { data } = await axios.post('https://api.anthropic.com/v1/messages', {
    model: model || CHAT_DEFAULTS[PROVIDERS.ANTHROPIC],
    max_tokens: 2000,
    messages: [{ role: 'user', content: [block, { type: 'text', text: prompt }] }],
  }, {
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION, 'Content-Type': 'application/json' },
    timeout: 90_000,
    maxBodyLength: Infinity,
  });
  return (data?.content || []).filter((item) => item?.type === 'text').map((item) => item.text).join('\n').trim() || null;
}

// Retorna o vetor, ou null quando não há motor de embedding (Claude puro sem
// auxiliar) — nesse caso a busca da base cai para palavra-chave.
async function getEmbedding(settingsOrKey, text, options = {}) {
  const target = resolveCapabilityEngine(settingsOrKey, 'embedding');
  if (target.engine === PROVIDERS.GEMINI) return geminiService.getEmbedding(target.key, text, options);
  if (target.engine === PROVIDERS.OPENAI) {
    try { return await openAIEmbedding(target.key, text); }
    catch (err) { console.warn('[ai] embedding OpenAI falhou:', err.response?.data?.error?.message || err.message); return null; }
  }
  return null;
}

async function transcribeAudio(settingsOrKey, audioBase64, mimeType) {
  const target = resolveCapabilityEngine(settingsOrKey, 'audio');
  if (target.engine === PROVIDERS.GEMINI) return geminiService.transcribeAudio(target.key, audioBase64, mimeType);
  if (target.engine === PROVIDERS.OPENAI) {
    try { return await openAITranscribe(target.key, audioBase64, mimeType); }
    catch (err) { console.warn('[ai] transcrição OpenAI falhou:', err.response?.data?.error?.message || err.message); return null; }
  }
  return null;
}

async function analyzeImage(settingsOrKey, imageBase64, mimeType, prompt = 'Descreva esta imagem.') {
  const target = resolveCapabilityEngine(settingsOrKey, 'vision');
  if (target.engine === PROVIDERS.GEMINI) return geminiService.analyzeImage(target.key, imageBase64, mimeType, prompt);
  try {
    if (target.engine === PROVIDERS.OPENAI) return await openAIMultimodal(target.key, { base64: imageBase64, mimeType, prompt, kind: 'image' });
    if (target.engine === PROVIDERS.ANTHROPIC) {
      const { model } = providerConfig(settingsOrKey);
      return await anthropicMultimodal(target.key, model, { base64: imageBase64, mimeType, prompt, kind: 'image' });
    }
  } catch (err) {
    console.warn('[ai] análise de imagem falhou:', err.response?.data?.error?.message || err.message);
  }
  return null;
}

async function extractDocumentText(settingsOrKey, documentBase64, mimeType) {
  const target = resolveCapabilityEngine(settingsOrKey, 'document');
  if (target.engine === PROVIDERS.GEMINI) return geminiService.extractDocumentText(target.key, documentBase64, mimeType);
  const prompt = 'Extraia todo o texto legível deste documento, preservando a ordem e a estrutura. Responda apenas com o texto.';
  try {
    if (target.engine === PROVIDERS.OPENAI) return await openAIMultimodal(target.key, { base64: documentBase64, mimeType, prompt, kind: 'document' });
    if (target.engine === PROVIDERS.ANTHROPIC) {
      const { model } = providerConfig(settingsOrKey);
      return await anthropicMultimodal(target.key, model, { base64: documentBase64, mimeType, prompt, kind: 'document' });
    }
  } catch (err) {
    console.warn('[ai] leitura de documento falhou:', err.response?.data?.error?.message || err.message);
  }
  return null;
}

/* ----------------------------- Descoberta de modelos ----------------------- */

// Ordena "melhor primeiro" por uma heurística simples de recência no nome.
function scoreModelId(id) {
  const s = String(id);
  const versionBits = (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  const version = versionBits.length ? Math.max(...versionBits) : 0;
  const tierBonus = /opus|4o|pro|-5\b/.test(s) ? 2 : /sonnet|mini/.test(s) ? 1 : 0;
  const latestBonus = /latest/.test(s) ? 0.5 : 0;
  return version * 10 + tierBonus + latestBonus;
}

const OPENAI_CHAT_RE = /^(gpt-|o[1-9]|chatgpt-)/i;
const OPENAI_EXCLUDE_RE = /(embedding|whisper|tts|audio|realtime|transcribe|moderation|dall-e|image|search|-instruct|codex)/i;

async function listModels(provider, key) {
  const p = normalizeProvider(provider);
  if (!key) throw new Error('Informe a chave para listar os modelos.');
  let models = [];

  if (p === PROVIDERS.OPENAI) {
    const { data } = await axios.get('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }, timeout: 20_000,
    });
    models = (data?.data || [])
      .map((m) => m.id)
      .filter((id) => OPENAI_CHAT_RE.test(id) && !OPENAI_EXCLUDE_RE.test(id))
      .map((id) => ({ id, label: id }));
  } else if (p === PROVIDERS.ANTHROPIC) {
    const { data } = await axios.get('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION }, timeout: 20_000,
    });
    models = (data?.data || [])
      .filter((m) => String(m.id).startsWith('claude-'))
      .map((m) => ({ id: m.id, label: m.display_name || m.id }));
  } else {
    const { data } = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, { timeout: 20_000 });
    models = (data?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || String(m.name).replace(/^models\//, '') }));
  }

  models.sort((a, b) => scoreModelId(b.id) - scoreModelId(a.id));
  // dedup preservando ordem
  const seen = new Set();
  models = models.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  return models;
}

async function testProvider(settingsOrKey) {
  const config = providerConfig(settingsOrKey);
  const startedAt = Date.now();
  const response = config.provider === PROVIDERS.GEMINI
    ? await geminiService.generateText(config.key, 'Responda apenas OK.', { profile: 'light', maxOutputTokens: 100 })
    : (await selectedText(settingsOrKey, { prompt: 'Responda apenas OK.', maxOutputTokens: 100 })).text;

  let models = [];
  try { models = await listModels(config.provider, config.key); } catch { /* lista é bônus */ }

  return {
    ok: Boolean(response),
    provider: config.provider,
    model: config.model,
    recommended: models[0]?.id || config.model || null,
    models,
    latencyMs: Date.now() - startedAt,
  };
}

module.exports = {
  PROVIDERS,
  normalizeProvider,
  normalizeAuxProvider,
  providerConfig,
  hasConfiguredProvider,
  resolveCapabilityEngine,
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
  listModels,
  testProvider,
  __testing: { plainText, historyMessages, parseOpenAIText, parseJson, scoreModelId, resolveCapabilityEngine },
};
