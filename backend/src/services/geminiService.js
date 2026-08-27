const { GoogleGenAI, ThinkingLevel } = require('@google/genai');

// Separamos por perfil porque o backend usa IA para chat principal,
// resumo/rascunho estruturado e tarefas auxiliares mais baratas.
const DEFAULT_CHAT_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
];

const DEFAULT_LIGHT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
];

const DEFAULT_MULTIMODAL_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
];

function getModels(envVarName, fallbackModels) {
  const envModels = process.env[envVarName]
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return envModels?.length ? envModels : fallbackModels;
}

function shouldTryNextModel(err) {
  const message = err?.message || '';
  const status = Number(err?.status || err?.code);
  return [400, 403, 404, 429, 500, 503].includes(status)
    || /\b(?:400|403|404|429|500|503)\b/.test(message);
}

function createClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

function getThinkingConfig(modelName, profile = 'chat') {
  if (modelName.startsWith('gemini-3.7-')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  if (modelName.startsWith('gemini-3.')) {
    return { thinkingLevel: profile === 'chat' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL };
  }
  if (modelName.startsWith('gemini-2.5-flash')) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

function generationConfig(modelName, { profile = 'chat', maxOutputTokens = 1000, json = false } = {}) {
  const config = {
    maxOutputTokens,
    thinkingConfig: getThinkingConfig(modelName, profile),
    ...(json ? { responseMimeType: 'application/json' } : {}),
  };

  // Gemini 3.6/3.7 rejeitam os parâmetros antigos de amostragem.
  if (!modelName.startsWith('gemini-3.')) {
    config.temperature = 0.1;
    config.topK = 1;
  }
  return config;
}

function responseText(response) {
  return String(response?.text || '').trim();
}

function getProfileModels(profile) {
  if (profile === 'light') return getModels('GEMINI_LIGHT_MODELS', DEFAULT_LIGHT_MODELS);
  if (profile === 'multimodal') return getModels('GEMINI_MULTIMODAL_MODELS', DEFAULT_MULTIMODAL_MODELS);
  return getModels('GEMINI_CHAT_MODELS', DEFAULT_CHAT_MODELS);
}

async function generateText(apiKey, contents, {
  profile = 'chat',
  maxOutputTokens = 1200,
  json = false,
  systemInstruction,
} = {}) {
  const ai = createClient(apiKey);
  let lastError = null;

  for (const modelName of getProfileModels(profile)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...generationConfig(modelName, { profile, maxOutputTokens, json }),
        },
      });
      console.log(`[gemini] ${profile} OK com ${modelName}`);
      return responseText(result);
    } catch (err) {
      console.warn(`[gemini] falha ${profile} com ${modelName}:`, err.message);
      lastError = err;
      if (shouldTryNextModel(err)) continue;
      throw err;
    }
  }
  throw lastError;
}

async function chat(apiKey, systemPrompt, history, userMessage, options = {}) {
  const ai = createClient(apiKey);
  let lastError = null;

  for (const modelName of getModels('GEMINI_CHAT_MODELS', DEFAULT_CHAT_MODELS)) {
    try {
      const combinedHistory = [];
      history.forEach((m) => {
        const role = m.fromMe || m.fromBot ? 'model' : 'user';
        const last = combinedHistory[combinedHistory.length - 1];
        if (last && last.role === role) {
          last.parts[0].text += `\n${m.body}`;
        } else {
          combinedHistory.push({ role, parts: [{ text: m.body }] });
        }
      });

      while (combinedHistory.length > 0 && combinedHistory[0].role !== 'user') {
        combinedHistory.shift();
      }

      const chatSession = ai.chats.create({
        model: modelName,
        history: combinedHistory,
        config: {
          systemInstruction: systemPrompt,
          ...generationConfig(modelName, { profile: 'chat', maxOutputTokens: 1000 }),
        },
      });

      const result = await chatSession.sendMessage({ message: userMessage });
      console.log(`[gemini] chat OK com ${modelName}`);
      const text = responseText(result);
      return options?.returnMetadata ? { text, model: modelName } : text;
    } catch (err) {
      console.warn(`[gemini] falha chat com ${modelName}:`, err.message);
      lastError = err;
      if (shouldTryNextModel(err)) continue;
      throw err;
    }
  }

  throw lastError;
}

async function summarize(apiKey, systemPrompt, history, userMessage) {
  const ai = createClient(apiKey);
  const historyText = history.map((m) => `${m.fromMe || m.fromBot ? 'Agente' : 'Cliente'}: ${m.body}`).join('\n');
  const fullPrompt = `${systemPrompt}\n\nHistorico:\n${historyText}\n\nTarefa: ${userMessage}`;
  let lastError = null;

  for (const modelName of getModels('GEMINI_LIGHT_MODELS', DEFAULT_LIGHT_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: fullPrompt,
        config: generationConfig(modelName, { profile: 'light', maxOutputTokens: 1200 }),
      });
      return responseText(result);
    } catch (err) {
      console.warn(`[gemini] falha resumo com ${modelName}:`, err.message);
      lastError = err;
      if (shouldTryNextModel(err)) continue;
      throw err;
    }
  }

  throw lastError;
}

async function transcribeAudio(apiKey, audioBase64, mimeType) {
  const ai = createClient(apiKey);
  for (const modelName of getModels('GEMINI_MULTIMODAL_MODELS', DEFAULT_MULTIMODAL_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ inlineData: { data: audioBase64, mimeType } }, { text: 'Transcreva este áudio em português.' }],
        config: generationConfig(modelName, { profile: 'multimodal', maxOutputTokens: 2000 }),
      });
      return responseText(result);
    } catch (err) {
      console.warn(`[gemini] falha transcricao com ${modelName}:`, err.message);
      if (shouldTryNextModel(err)) continue;
      return null;
    }
  }

  return null;
}

async function generateTags(apiKey, history, allowedTags = []) {
  const ai = createClient(apiKey);
  const historyText = history.map((m) => `${m.fromMe ? 'Agente' : 'Cliente'}: ${m.body}`).join('\n');
  let prompt = 'Analise esta conversa e sugira ate 3 tags curtas para categoriza-la.\n\n';

  if (allowedTags.length > 0) {
    prompt += `VOCE DEVE ESCOLHER APENAS ENTRE ESTAS TAGS OFICIAIS: ${allowedTags.join(', ')}.\nSe nenhuma se aplicar, nao retorne nada.\n`;
  } else {
    prompt += 'Retorne apenas as tags separadas por virgula.\n';
  }

  prompt += `\nHistorico:\n${historyText}`;

  for (const modelName of getModels('GEMINI_LIGHT_MODELS', DEFAULT_LIGHT_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: generationConfig(modelName, { profile: 'light', maxOutputTokens: 200 }),
      });
      const suggested = responseText(result).split(',').map((t) => t.trim()).filter((t) => t.length > 0);
      return allowedTags.length > 0 ? suggested.filter((t) => allowedTags.includes(t)) : suggested;
    } catch (err) {
      console.warn(`[gemini] falha tags com ${modelName}:`, err.message);
      if (shouldTryNextModel(err)) continue;
      return [];
    }
  }

  return [];
}

async function generateTransferSummary(apiKey, history) {
  const ai = createClient(apiKey);
  const historyText = history.slice(-30).map((m) => `${m.fromMe || m.fromBot ? 'Atendimento' : 'Cliente'}: ${m.body}`).join('\n');

  for (const modelName of getModels('GEMINI_LIGHT_MODELS', DEFAULT_LIGHT_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: `Gere um resumo curto desta conversa:\n${historyText}`,
        config: generationConfig(modelName, { profile: 'light', maxOutputTokens: 500 }),
      });
      return responseText(result);
    } catch (err) {
      if (shouldTryNextModel(err)) continue;
      return null;
    }
  }

  return null;
}

// gemini-embedding-001 devolve 3072 dimensoes por padrao. Gravar milhares de
// vetores de 3072 floats de uma vez (createMany na indexacao de manuais)
// estourava a memoria do worker. 768 e o valor recomendado pelo Google para a
// maioria dos casos e reduz 4x o tamanho gravado/comparado. Existe env para
// quem ja tem base indexada em 3072 e ainda nao pode reindexar.
const EMBED_DIMENSIONS = Math.max(1, Number.parseInt(process.env.GEMINI_EMBED_DIMENSIONS, 10) || 768);

async function getEmbedding(apiKey, text) {
  const ai = createClient(apiKey);
  // text-embedding-004/embedding-001 foram descontinuados pelo Google - a base
  // de conhecimento inteira ficava sem embedding (silenciosamente, sem erro
  // visivel na tela) e a IA nunca usava o treinamento cadastrado.
  const embedModels = getModels('GEMINI_EMBED_MODELS', ['gemini-embedding-001']);

  for (const modelName of embedModels) {
    try {
      const result = await ai.models.embedContent({
        model: modelName,
        contents: text,
        config: { outputDimensionality: EMBED_DIMENSIONS },
      });
      return result.embeddings?.[0]?.values || null;
    } catch (err) {
      console.warn(`[gemini] falha embedding com ${modelName}:`, err.message);
      continue;
    }
  }

  return null;
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let mA = 0;
  let mB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    mA += vecA[i] * vecA[i];
    mB += vecB[i] * vecB[i];
  }

  mA = Math.sqrt(mA);
  mB = Math.sqrt(mB);
  if (!mA || !mB) return 0;
  const sim = dotProduct / (mA * mB);
  return Number.isFinite(sim) ? sim : 0;
}

async function analyzeImage(apiKey, imageBase64, mimeType, prompt = 'Descreva esta imagem.') {
  const ai = createClient(apiKey);

  for (const modelName of getModels('GEMINI_MULTIMODAL_MODELS', DEFAULT_MULTIMODAL_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ inlineData: { data: imageBase64, mimeType } }, { text: prompt }],
        config: generationConfig(modelName, { profile: 'multimodal', maxOutputTokens: 1200 }),
      });
      return responseText(result);
    } catch (err) {
      if (shouldTryNextModel(err)) continue;
      return null;
    }
  }

  return null;
}

async function extractDocumentText(apiKey, documentBase64, mimeType) {
  return generateText(apiKey, [
    { inlineData: { data: documentBase64, mimeType } },
    { text: `Extraia fielmente o conteúdo textual deste documento para indexação interna.
Preserve títulos, códigos de erro, modelos, avisos, listas e procedimentos.
Quando conseguir identificar páginas, insira o marcador [PÁGINA N] antes do conteúdo correspondente.
Não resuma, não responda ao conteúdo e não acrescente nenhuma informação que não esteja no arquivo.` },
  ], { profile: 'multimodal', maxOutputTokens: 10000 });
}

async function extractClientInfo(apiKey, history, currentNotes) {
  const ai = createClient(apiKey);
  const historyText = history.map((m) => `${m.fromMe ? 'Agente' : 'Cliente'}: ${m.body}`).join('\n');
  const prompt = `Analise a conversa abaixo e retorne um objeto JSON contendo exatamente as chaves "name" e "notes":
1. "name": O nome pessoal do cliente se ele se identificou ou disse como se chama nesta conversa (se não informado, retorne null).
2. "notes": A ficha técnica consolidada e atualizada do cliente. Capture modelo de equipamento, marca, série, serial, setor, ramal, endereço e observações. Atualize a ficha atual com as novas informações fornecidas na conversa.

Se não houver NENHUMA informação nova na conversa para atualizar as notas nem o nome, retorne {"name":null,"notes":null}.

Ficha Atual:
${currentNotes}

Conversa:
${historyText}`;

  for (const modelName of getModels('GEMINI_LIGHT_MODELS', DEFAULT_LIGHT_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: generationConfig(modelName, { profile: 'light', maxOutputTokens: 1000, json: true }),
      });
      const resp = responseText(result);
      
      let cleanJson = resp;
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
      }
      
      try {
        const parsed = JSON.parse(cleanJson);
        const extracted = {
          name: parsed.name || null,
          notes: parsed.notes || null
        };
        return extracted.name || extracted.notes ? extracted : null;
      } catch (e) {
        // Fallback caso o modelo retorne texto plano
        return { name: null, notes: resp };
      }
    } catch (err) {
      if (shouldTryNextModel(err)) continue;
      return null;
    }
  }

  return null;
}

async function draftServiceOrder(apiKey, history, equipments) {
  const ai = createClient(apiKey);
  const historyText = history.slice(-20).map((m) => `${m.fromMe ? 'Agente' : 'Cliente'}: ${m.body}`).join('\n');
  const equipList = equipments.map((e) => `[ID: ${e.id}] ${e.model}`).join('\n');
  const prompt = `Gere um JSON rascunho de Ordem de Servico: {"defect": "string", "equipmentId": "id ou null"}.\n\nEquipamentos:\n${equipList}\n\nConversa:\n${historyText}`;

  for (const modelName of getModels('GEMINI_CHAT_MODELS', DEFAULT_CHAT_MODELS)) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: generationConfig(modelName, { profile: 'chat', maxOutputTokens: 500, json: true }),
      });
      let text = responseText(result);
      if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(text);
    } catch (err) {
      if (shouldTryNextModel(err)) continue;
      return { defect: null, equipmentId: null };
    }
  }

  return { defect: null, equipmentId: null };
}

module.exports = {
  chat,
  summarize,
  transcribeAudio,
  analyzeImage,
  extractDocumentText,
  generateTags,
  generateTransferSummary,
  getEmbedding,
  cosineSimilarity,
  extractClientInfo,
  draftServiceOrder,
  generateText,
  __testing: {
    generationConfig,
    getProfileModels,
    getThinkingConfig,
    responseText,
  },
};
