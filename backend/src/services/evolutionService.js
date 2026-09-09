const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

function sanitizeUrl(url) {
  let baseUrl = String(url || '').trim();
  if (!baseUrl || baseUrl === 'undefined' || baseUrl === 'null') {
    throw new Error('Evolution API URL não configurada ou inválida');
  }
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }
  return baseUrl.replace(/\/+$/, '');
}

function getClient(url, key, timeout = 60000) {
  const baseUrl = sanitizeUrl(url);
  return axios.create({
    baseURL: baseUrl,
    headers: { apikey: key, 'Content-Type': 'application/json' },
    maxContentLength: 100 * 1024 * 1024, // 100MB
    maxBodyLength: 100 * 1024 * 1024,    // 100MB
    timeout // 60 segundos por padrão; o monitor usa um limite menor
  });
}

function buildQuotedPayload(quoted) {
  if (!quoted) return undefined;
  if (typeof quoted === 'object' && quoted !== null) {
    const quotedBody = quoted.body || quoted.text || quoted.message?.conversation;
    return {
      key: {
        id: quoted.id || quoted,
        ...(quoted.remoteJid ? { remoteJid: quoted.remoteJid } : {}),
        ...(typeof quoted.fromMe === 'boolean' ? { fromMe: quoted.fromMe } : {})
      },
      ...(quotedBody ? { message: { conversation: String(quotedBody) } } : {})
    };
  }
  return { key: { id: quoted } };
}

function getMessageKeyId(data) {
  return data?.key?.id || data?.message?.key?.id || null;
}

function ensureAccepted(data, context) {
  const messageId = getMessageKeyId(data);
  if (messageId) return data;

  const status = typeof data?.status === 'string' ? data.status : 'sem-status';
  const preview = JSON.stringify(data || {}).slice(0, 500);
  throw new Error(`${context} sem confirmação da Evolution (status=${status}). Resposta: ${preview}`);
}

function formatEvolutionErrorValue(value) {
  if (Array.isArray(value)) {
    return value.map(formatEvolutionErrorValue).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value == null ? '' : String(value);
}

function getEvolutionErrorDetail(error) {
  const responseData = error?.response?.data;
  const detail = responseData?.response?.message || responseData?.message || responseData?.error;
  return formatEvolutionErrorValue(detail) || error?.message || 'erro desconhecido';
}

async function sendText(url, key, instanceName, phone, text, quoted = null) {
  const client = getClient(url, key);
  try {
    const payload = { 
      number: phone, 
      text,
      linkPreview: false,
      options: { linkPreview: false }
    };
    if (quoted) {
      payload.quoted = buildQuotedPayload(quoted);
      payload.options.quoted = buildQuotedPayload(quoted);
    }
    const targetPath = `/message/sendText/${instanceName}`;
    const sanitizedUrl = sanitizeUrl(url);
    console.log(`[evolutionService] Attempting sendText to URL: ${sanitizedUrl}${targetPath} (key prefix: ${(key || '').slice(0, 5)}...)`);
    const { data } = await client.post(targetPath, payload);
    console.log(`[evolutionService] sendText OK:`, data?.key?.id || 'id-não-retornado');
    return ensureAccepted(data, 'sendText');
  } catch (err) {
    console.error(`[evolutionService] sendText ERROR:`, err.response?.data || err.message);
    const explicitLocalMock = process.env.EVOLUTION_SEND_MOCK === 'true'
      && (url.includes('localhost') || url.includes('127.0.0.1'));
    if (explicitLocalMock) {
      console.warn(`[evolutionService] [DEV MOCK] Simulação de envio de texto no ambiente local.`);
      return { key: { id: `MOCK-TXT-${Date.now()}` } };
    }
    throw err;
  }
}

async function sendMediaMultipart(url, key, instanceName, phone, { mediatype, mimetype, filename, caption, quoted, filePath }) {
  const endpointBase = sanitizeUrl(url);
  const form = new FormData();
  form.append('number', phone);
  form.append('mediatype', mediatype);
  // Algumas versões da Evolution usam este campo para validar o anexo antes
  // de ler o contentType enviado no stream multipart.
  form.append('mimetype', mimetype || 'application/octet-stream');
  form.append('caption', caption || '');
  form.append('fileName', filename || path.basename(filePath) || 'arquivo');
  // Evolution API 2.4.0 recebe o arquivo multipart no campo "file".
  form.append('file', fs.createReadStream(filePath), {
    filename: filename || path.basename(filePath) || 'arquivo',
    contentType: mimetype || 'application/octet-stream'
  });

  if (quoted) {
    const qPayload = buildQuotedPayload(quoted);
    form.append('quoted', JSON.stringify(qPayload));
    form.append('options', JSON.stringify({ quoted: qPayload }));
  }

  const { data } = await axios.post(`${endpointBase}/message/sendMedia/${instanceName}`, form, {
    headers: {
      apikey: key,
      ...form.getHeaders()
    },
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength: 100 * 1024 * 1024,
    timeout: 60000
  });

  console.log(`[evolutionService] sendMedia multipart OK:`, getMessageKeyId(data) || 'id-nÃ£o-retornado');
  return ensureAccepted(data, 'sendMedia multipart');
}

async function sendMediaJson(url, key, instanceName, phone, { mediatype, media, mimetype, filename, caption, quoted }) {
  const client = getClient(url, key);
  const payload = {
    number: phone,
    mediatype,
    mimetype,
    media,
    fileName: filename || 'arquivo',
    caption: caption || ''
  };
  if (quoted) {
    payload.quoted = buildQuotedPayload(quoted);
    payload.options = { quoted: buildQuotedPayload(quoted) };
  }
  const { data } = await client.post(`/message/sendMedia/${instanceName}`, payload);
  console.log(`[evolutionService] sendMedia json OK:`, getMessageKeyId(data) || 'id-nÃ£o-retornado');
  return ensureAccepted(data, 'sendMedia json');
}

async function sendMedia(url, key, instanceName, phone, { mediatype, media, mimetype, filename, caption, quoted, filePath }) {
  let multipartError = null;

  if (filePath && fs.existsSync(filePath)) {
    try {
      return await sendMediaMultipart(url, key, instanceName, phone, {
        mediatype,
        mimetype,
        filename,
        caption,
        quoted,
        filePath
      });
    } catch (err) {
      multipartError = err;
      console.warn('[evolutionService] sendMedia multipart falhou, tentando JSON/base64...', err.response?.data || err.message);
    }
  }

  try {
    const mediaPayload = media || (filePath && fs.existsSync(filePath)
      ? (await fs.promises.readFile(filePath)).toString('base64')
      : media);

    return await sendMediaJson(url, key, instanceName, phone, {
      mediatype,
      media: mediaPayload,
      mimetype,
      filename,
      caption,
      quoted
    });
  } catch (err) {
    if (multipartError) {
      console.warn('[evolutionService] sendMedia falhou em multipart e JSON/base64.');
      err.message = `multipart: ${getEvolutionErrorDetail(multipartError)}; json/base64: ${getEvolutionErrorDetail(err)}`;
    }
    throw err;
  }
}

async function sendAudio(url, key, instanceName, phone, audio, quoted = null) {
  const client = getClient(url, key);
  const payload = {
    number: phone,
    audio,        // base64
    encoding: true,
  };
  if (quoted) {
    payload.quoted = buildQuotedPayload(quoted);
    payload.options = { quoted: buildQuotedPayload(quoted) };
  }
  const { data } = await client.post(`/message/sendWhatsAppAudio/${instanceName}`, payload);
  console.log(`[evolutionService] sendAudio OK:`, getMessageKeyId(data) || 'id-nÃ£o-retornado');
  return ensureAccepted(data, 'sendAudio');
}

// Função de compatibilidade para evitar erros de "not a function" em códigos legados
async function sendMessage(url, key, instanceName, phone, body, quoted = null) {
  console.warn('[evolutionService] sendMessage (legado) chamado. Redirecionando para sendText.');
  return sendText(url, key, instanceName, phone, body, quoted);
}

async function getMediaBase64(url, key, instanceName, messageKey) {
  const client = getClient(url, key);
  
  // Lista de tentativas em ordem de probabilidade para Evolution v2
  const attempts = [
    { url: `/chat/getBase64FromMediaMessage/${instanceName}`, payload: { message: { key: messageKey } } },
    { url: `/chat/getBase64FromMediaMessage/${instanceName}`, payload: { key: messageKey } },
    { url: `/chat/getBase64FromMessage/${instanceName}`, payload: { message: { key: messageKey } } },
    { url: `/chat/getBase64FromMessage/${instanceName}`, payload: { key: messageKey } },
  ];

  for (const attempt of attempts) {
    try {
      const { data } = await client.post(attempt.url, attempt.payload);
      // Se retornou algo que pareça um base64, sucesso
      const base64 = data?.base64 || data?.data?.base64 || data?.data?.data?.base64;
      if (base64) return data;
    } catch (err) {
      // Se for 401 ou 403, nem tenta os outros
      if (err.response?.status === 401 || err.response?.status === 403) throw err;
      continue;
    }
  }

  throw new Error('Não foi possível obter o Base64 da mídia em nenhum endpoint conhecido.');
}

// Salva base64 como arquivo e retorna URL relativa
async function saveMediaFile(base64, mimetype, messageId) {
  const mainType = (mimetype || '').split(';')[0].trim();
  const isAudio = mainType.startsWith('audio/');
  const extMap = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/opus': 'ogg', 'audio/webm': 'webm',
    'application/pdf': 'pdf', 
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
  };
  const ext = extMap[mainType] || (isAudio ? 'ogg' : 'bin');

  const { mediaPath } = require('../utils/uploads');
  const dir = mediaPath;

  const rawFilename = `${messageId}.${ext}`;
  const rawPath = path.join(dir, rawFilename);
  await fs.promises.writeFile(rawPath, Buffer.from(base64, 'base64'));

  // Converte áudio (WhatsApp PTT OGG/Opus) para MP3 para playback correto no browser
  if (isAudio) {
    const mp3Filename = `${messageId}.mp3`;
    const mp3Path = path.join(dir, mp3Filename);
    console.log(`[audio] mimetype="${mimetype}" ext="${ext}"`);
    // Roda ffprobe para ver o sample rate real do OGG antes de converter
    await new Promise(resolve => ffmpeg.ffprobe(rawPath, (err, data) => {
      if (data?.streams?.[0]) {
        const st = data.streams[0];
        console.log(`[audio] ffprobe: codec=${st.codec_name} sample_rate=${st.sample_rate} channels=${st.channels} duration=${st.duration} bit_rate=${st.bit_rate}`);
      } else if (err) {
        console.log('[audio] ffprobe erro:', err.message);
      }
      resolve();
    }));
    console.log(`[audio] convertendo ${rawPath} → ${mp3Path}`);
    try {
      await new Promise((resolve, reject) =>
        ffmpeg(rawPath)
          .inputOptions(['-analyzeduration', '10M', '-probesize', '10M'])
          .noVideo()
          .audioCodec('libmp3lame')
          .audioFrequency(44100)
          .audioChannels(1)
          .audioBitrate('128k')
          .toFormat('mp3')
          .on('start', cmd => console.log('[audio] cmd:', cmd))
          .on('end', () => { console.log('[audio] conversão OK'); resolve(); })
          .on('error', err => { console.error('[audio] FFmpeg erro:', err.message); reject(err); })
          .save(mp3Path)
      );
      await fs.promises.unlink(rawPath);
      return `/uploads/media/${mp3Filename}`;
    } catch (err) {
      console.error('[audio] falhou, usando arquivo original:', err.message);
    }
  }

  return `/uploads/media/${rawFilename}`;
}

async function getQrCode(url, key, instanceName) {
  const client = getClient(url, key);
  const { data } = await client.get(`/instance/connect/${instanceName}`);
  return data;
}

async function getConnectionState(url, key, instanceName, options = {}) {
  const timeout = Number(options?.timeout);
  const client = getClient(url, key, Number.isFinite(timeout) && timeout > 0 ? timeout : 60000);
  const { data } = await client.get(`/instance/connectionState/${instanceName}`);
  return data;
}

// URL que a Evolution vai chamar de volta. Por padrao usa PUBLIC_URL (dominio
// publico via Traefik). EVOLUTION_WEBHOOK_URL permite apontar para um endereco
// interno (ex.: http://<servico>:8000) quando houver rota interna verificada --
// tira DNS/proxy/TLS/internet do caminho, que e onde os soluços acontecem.
function getWebhookCallbackUrl() {
  const base = String(
    process.env.EVOLUTION_WEBHOOK_URL
    || process.env.PUBLIC_URL
    || `http://localhost:${process.env.PORT || 3002}`,
  ).replace(/\/+$/, '');
  return `${base}/api/webhook`;
}

async function setWebhook(url, key, instanceName, webhookUrl) {
  const client = getClient(url, key);
  const secret = String(process.env.WEBHOOK_SECRET || '').trim();
  // Evolution versions differ in support for custom webhook headers. The
  // signed query fallback keeps the callback authenticated even on versions
  // that only accept a URL; the middleware still prefers the header/bearer.
  const securedWebhookUrl = secret && !webhookUrl.includes('token=')
    ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(secret)}`
    : webhookUrl;
  const { data } = await client.post(`/webhook/set/${instanceName}`, {
    webhook: {
      url: securedWebhookUrl,
      enabled: true,
      webhook_by_events: false,
      webhook_base64: false,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_SET'],
    },
  });
  return data;
}

function buildCreateInstancePayload(instanceName, options = {}) {
  const provider = options.provider === 'evolution_official' ? 'WHATSAPP-BUSINESS' : 'WHATSAPP-BAILEYS';
  const payload = {
    instanceName,
    qrcode: provider === 'WHATSAPP-BAILEYS',
    integration: provider,
  };
  if (provider === 'WHATSAPP-BUSINESS') {
    payload.number = options.phoneNumberId;
    payload.token = options.accessToken;
    const businessId = options.businessId || options.businessAccountId;
    if (businessId) payload.businessId = businessId;
  }
  return payload;
}

async function findTemplates(url, key, instanceName) {
  const client = getClient(url, key);
  const { data } = await client.get(`/template/find/${instanceName}`);
  return data;
}

async function sendTemplate(url, key, instanceName, phone, { name, language = 'pt_BR', components = [] }) {
  const client = getClient(url, key);
  const payload = {
    number: normalizePhoneNumber(phone),
    name,
    language,
    components,
  };
  const { data } = await client.post(`/message/sendTemplate/${instanceName}`, payload);
  return ensureAccepted(data, 'sendTemplate');
}

async function createInstance(url, key, instanceName, options = {}) {
  const client = getClient(url, key);
  const payload = buildCreateInstancePayload(instanceName, options);
  const { data } = await client.post('/instance/create', payload);
  return data;
}

function isInstanceAlreadyInUse(err) {
  const responseData = err?.response?.data;
  const responseMsg = responseData?.response?.message || responseData?.message || err?.message;
  return Array.isArray(responseMsg)
    ? responseMsg.some(msg => String(msg).includes('already in use'))
    : String(responseMsg || '').includes('already in use');
}

async function deleteInstance(url, key, instanceName) {
  const client = getClient(url, key);
  const attempts = [
    () => client.delete(`/instance/delete/${instanceName}`),
    () => client.delete(`/instance/logout/${instanceName}`),
    () => client.post(`/instance/logout/${instanceName}`),
  ];

  let lastErr;
  for (const attempt of attempts) {
    try {
      const { data } = await attempt();
      return data;
    } catch (err) {
      lastErr = err;
      if (err.response?.status === 404) return { ok: true, alreadyDeleted: true };
    }
  }

  throw lastErr;
}

function normalizePhoneNumber(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') return '';
  const rawValue = String(phone).trim();
  if (isGroupJid(rawValue)) return rawValue.toLowerCase();

  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('550')) {
    digits = `55${digits.slice(3)}`;
  }

  if (!digits.startsWith('55')) {
    if (digits.startsWith('0') && digits.length >= 11) {
      digits = digits.slice(1);
    }

    if (digits.length <= 11) {
      digits = `55${digits}`;
    }
  }

  return digits;
}

function isGroupJid(value) {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith('@g.us');
}

// A Cloud API do WhatsApp devolve números de celular do Brasil sem o 9º dígito
// (ex.: 555186876737), enquanto os cadastros costumam ter o 9 (5551986876737).
// Gera as duas formas para casar contato e evitar duplicidade.
function brazilNinthDigitVariants(digits) {
  const match = String(digits || '').match(/^55(\d{2})(\d{8,9})$/);
  if (!match) return [];
  const [, ddd, subscriber] = match;
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    return [`55${ddd}9${subscriber}`];
  }
  if (subscriber.length === 9 && subscriber.startsWith('9')) {
    return [`55${ddd}${subscriber.slice(1)}`];
  }
  return [];
}

function buildPhoneLookupCandidates(phone) {
  if (isGroupJid(String(phone || ''))) {
    return [normalizePhoneNumber(phone)];
  }

  const rawDigits = typeof phone === 'string' || typeof phone === 'number'
    ? String(phone).replace(/\D/g, '')
    : '';

  if (!rawDigits) return [];

  const candidates = new Set([rawDigits]);
  const normalized = normalizePhoneNumber(rawDigits);
  if (normalized) {
    candidates.add(normalized);
  }

  if (rawDigits.startsWith('00')) {
    candidates.add(rawDigits.slice(2));
  }

  const brVariants = [normalized, rawDigits].flatMap(brazilNinthDigitVariants);
  for (const variant of brVariants) {
    candidates.add(variant);
  }

  for (const value of [normalized, ...brVariants]) {
    if (value && value.startsWith('55')) {
      const localDigits = value.slice(2);
      candidates.add(localDigits);
      candidates.add(`0${localDigits}`);
      candidates.add(`550${localDigits}`);
    }
  }

  return Array.from(candidates).filter(Boolean);
}

function extractProfilePictureUrl(payload) {
  if (!payload) return null;
  if (typeof payload === 'string' && payload.startsWith('http')) return payload;

  const candidates = [
    payload.profilePictureUrl,
    payload.picture,
    payload.pictureUrl,
    payload.profilePicUrl,
    payload.profile_pic_url,
    payload.data?.profilePictureUrl,
    payload.data?.picture,
    payload.response?.profilePictureUrl,
    payload.response?.picture,
  ];

  return candidates.find((value) => typeof value === 'string' && value.startsWith('http')) || null;
}

async function fetchProfilePicture(url, key, instanceName, phone) {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) return null;

  try {
    const client = getClient(url, key);
    const endpoints = [
      `/chat/fetchProfilePictureUrl/${instanceName}`,
      `/chat/fetchProfile/${instanceName}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const { data } = await client.post(endpoint, { number: normalizedPhone });
        const picture = extractProfilePictureUrl(data);
        if (picture) return picture;
      } catch {
        // Tenta o proximo endpoint compativel.
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchInstanceInfo(url, key, instanceName) {
  const client = getClient(url, key);
  try {
    const { data } = await client.get(`/instance/fetchInstances?instanceName=${instanceName}`);
    return Array.isArray(data) ? data[0] : data;
  } catch {
    return null;
  }
}

async function revokeMessage(url, key, instanceName, remoteJid, messageId) {
  const client = getClient(url, key);
  const jid = remoteJid.includes('@') ? remoteJid : `${remoteJid}@s.whatsapp.net`;
  
  // Tenta DELETE /chat/deleteMessageForEveryone (Evolution API v2+)
  try {
    const { data } = await client.delete(`/chat/deleteMessageForEveryone/${instanceName}`, {
      data: {
        id: messageId,
        remoteJid: jid,
        fromMe: true
      }
    });
    return data;
  } catch (err) {
    console.warn('[evolutionService] deleteMessageForEveryone falhou, tentando fallback legacy...', err.message);
    try {
      const { data } = await client.post(`/message/deleteMessage/${instanceName}`, {
        number: jid,
        id: messageId,
        fromMe: true
      });
      return data;
    } catch (err2) {
      console.warn('[evolutionService] deleteMessage falhou, tentando revokeMessage...', err2.message);
      const { data } = await client.post(`/chat/revokeMessage/${instanceName}`, {
        message: {
          key: {
            remoteJid: jid,
            id: messageId,
            fromMe: true
          }
        }
      });
      return data;
    }
  }
}

async function findChats(url, key, instanceName) {
  const client = getClient(url, key);
  const { data } = await client.get(`/chat/findChats/${instanceName}`);
  return data;
}

async function findMessages(url, key, instanceName, remoteJid, limit = 50) {
  const client = getClient(url, key);
  const { data } = await client.post(`/chat/findMessages/${instanceName}?limit=${limit}`, {
    where: {
      key: {
        remoteJid: remoteJid
      }
    }
  });
  return data;
}

async function findConversationJidsByMessageIds(url, key, instanceName, messageIds = []) {
  const client = getClient(url, key);

  for (const messageId of messageIds) {
    if (!messageId) continue;

    const { data } = await client.post(`/chat/findMessages/${instanceName}`, {
      where: { key: { id: messageId } },
      limit: 1,
    });
    const records = data?.messages?.records || data?.records || [];
    const messageKey = records[0]?.key;
    if (!messageKey || typeof messageKey !== 'object') continue;

    const jids = [messageKey.remoteJid, messageKey.remoteJidAlt]
      .filter((jid) => typeof jid === 'string')
      .map((jid) => jid.trim().toLowerCase())
      .filter((jid) => jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

    if (jids.length > 0) return [...new Set(jids)];
  }

  return [];
}

module.exports = {
  sendText, sendTemplate, findTemplates, sendMedia, sendAudio, sendMessage, getMediaBase64, saveMediaFile,
  getQrCode, getConnectionState, setWebhook, getWebhookCallbackUrl, createInstance, deleteInstance, isInstanceAlreadyInUse, fetchInstanceInfo, fetchProfilePicture, revokeMessage,
  normalizePhoneNumber, buildPhoneLookupCandidates, isGroupJid,
  findChats, findMessages, findConversationJidsByMessageIds,
  getEvolutionErrorDetail,
  __testing: { buildCreateInstancePayload }
};
