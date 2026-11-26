const crypto = require('crypto');
const prisma = require('../lib/prisma');
const evolution = require('./evolutionService');
const { getLocalBusinessClock } = require('./businessHourService');

// Verificacao automatica de RECEBIMENTO.
//
// Incidente 25/11: a conexao do atendimento ficou "conectada", enviando
// normalmente, mas sem receber NENHUMA mensagem de cliente desde 11:17 -- o
// WhatsApp parou de entregar para aquele aparelho vinculado. Nenhum alarme
// disparou porque o monitor olhava lastWebhookAt, que envios/acks mantinham
// vivo. Aqui a empresa usa as proprias conexoes como sonda: de tempos em
// tempos uma conexao manda uma mensagem curta para o numero da outra; se ela
// nao chega pelo webhook no prazo, a conexao destino NAO esta recebendo.
// As sondas sao filtradas no webhook (nao viram ticket nem mensagem no CRM).

const PROBE_TEXT_PREFIX = '🔄 Verificação automática de recebimento do sistema (pode ignorar)';
const PROBE_TOKEN_REGEX = /#MAP-PROBE-([a-z0-9]{8,40})/i;

function envMs(name, fallback, min) {
  const value = Number(process.env[name]);
  return Math.max(min, Number.isFinite(value) && value > 0 ? value : fallback);
}

const PROBE_INTERVAL_MS = envMs('INBOUND_PROBE_INTERVAL_MS', 60 * 60 * 1000, 10 * 60 * 1000);
const PROBE_TIMEOUT_MS = envMs('INBOUND_PROBE_TIMEOUT_MS', 8 * 60 * 1000, 2 * 60 * 1000);
// Sem mensagem de cliente ha este tempo (em horario comercial) -> sonda antes
// do intervalo normal, para descobrir rapido.
const SILENCE_TRIGGER_MS = envMs('INBOUND_SILENCE_TRIGGER_MS', 45 * 60 * 1000, 10 * 60 * 1000);
const EARLY_PROBE_MIN_GAP_MS = 15 * 60 * 1000;
const SEND_ERROR_BACKOFF_MS = 5 * 60 * 1000;
// Falhas seguidas para declarar "nao esta recebendo" (1 falha pode ser atraso).
const FAILURES_TO_ALERT = Math.max(1, Number(process.env.INBOUND_PROBE_FAILURES_TO_ALERT || 2));
const DEFAULT_WINDOW = { start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] };

const sendBackoff = new Map();
const inboundNoteCache = new Map();

function isEnabled() {
  return String(process.env.INBOUND_PROBE_ENABLED || 'true').toLowerCase() !== 'false'
    && String(process.env.LOCAL_DEMO || '').toLowerCase() !== 'true';
}

function buildProbeText(token) {
  return `${PROBE_TEXT_PREFIX} #MAP-PROBE-${token}`;
}

function unwrapMessage(message) {
  let m = message || {};
  for (let i = 0; i < 4; i += 1) {
    const inner = m.ephemeralMessage?.message
      || m.viewOnceMessage?.message
      || m.viewOnceMessageV2?.message
      || m.documentWithCaptionMessage?.message
      || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function extractProbeToken(msg) {
  const m = unwrapMessage(msg?.message);
  const text = m.conversation || m.extendedTextMessage?.text || '';
  if (!text || typeof text !== 'string') return null;
  const match = text.match(PROBE_TOKEN_REGEX);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Chamado pelo webhook para TODA mensagem. Retorna true se for uma sonda
 * (enviada ou recebida) -- nesse caso o webhook descarta a mensagem.
 */
async function consumeProbeMessage(waInstance, msg, fromMe) {
  const token = extractProbeToken(msg);
  if (!token) return false;
  if (fromMe || !waInstance?.id) return true;
  try {
    const now = new Date();
    const result = await prisma.waInstance.updateMany({
      where: { id: waInstance.id, probeToken: token },
      data: { probeToken: null, probeOkAt: now, probeFailures: 0, lastInboundAt: now },
    });
    if (result.count > 0) {
      console.log(`[inbound-probe] ${waInstance.instanceName}: verificação recebida OK.`);
    }
  } catch (err) {
    console.warn(`[inbound-probe] falha ao registrar verificação recebida: ${err.message}`);
  }
  return true;
}

/** Registra a ultima mensagem RECEBIDA de cliente (throttle de 1 min). */
function noteInbound(waInstanceId, occurredAt = new Date()) {
  if (!waInstanceId) return;
  const at = occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime()) ? occurredAt : new Date();
  const last = inboundNoteCache.get(waInstanceId) || 0;
  if (at.getTime() - last < 60 * 1000) return;
  inboundNoteCache.set(waInstanceId, at.getTime());
  prisma.waInstance.updateMany({
    where: { id: waInstanceId, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: at } }] },
    data: { lastInboundAt: at },
  }).catch((err) => console.warn(`[inbound-probe] falha ao registrar recebimento: ${err.message}`));
}

async function isProbeWindow(tenantId, now = new Date()) {
  const { dayOfWeek, currentTime } = getLocalBusinessClock(now);
  let hours = null;
  try {
    hours = await prisma.businessHour.findUnique({
      where: { tenantId_dayOfWeek: { tenantId, dayOfWeek } },
    });
  } catch {
    hours = null;
  }
  if (hours) return Boolean(hours.active) && currentTime >= hours.start && currentTime <= hours.end;
  return DEFAULT_WINDOW.weekdays.includes(dayOfWeek)
    && currentTime >= DEFAULT_WINDOW.start && currentTime <= DEFAULT_WINDOW.end;
}

function isEligible(instance) {
  return instance
    && !String(instance.instanceName || '').startsWith('DELETED_')
    && (instance.provider || 'evolution_qr') === 'evolution_qr'
    && instance.lastConnectionState === 'open'
    && Boolean(String(instance.phone || '').replace(/\D/g, ''));
}

/** Decide se a instancia destino precisa de uma nova sonda agora. */
function isProbeDue(target, nowMs = Date.now()) {
  if (target.probeToken) return false;
  const sentMs = target.probeSentAt ? new Date(target.probeSentAt).getTime() : 0;
  if (!sentMs) return true;
  const sinceSent = nowMs - sentMs;
  // Falhou a ultima: confirma logo (sem esperar o intervalo cheio).
  if ((target.probeFailures || 0) > 0) return sinceSent >= PROBE_TIMEOUT_MS;
  if (sinceSent >= PROBE_INTERVAL_MS) return true;
  const inboundMs = target.lastInboundAt ? new Date(target.lastInboundAt).getTime() : 0;
  const silentFor = nowMs - Math.max(inboundMs, target.probeOkAt ? new Date(target.probeOkAt).getTime() : 0);
  return silentFor >= SILENCE_TRIGGER_MS && sinceSent >= EARLY_PROBE_MIN_GAP_MS;
}

function isProbeExpired(target, nowMs = Date.now()) {
  if (!target.probeToken || !target.probeSentAt) return false;
  return nowMs - new Date(target.probeSentAt).getTime() >= PROBE_TIMEOUT_MS;
}

function pickSender(target, candidates) {
  const others = candidates.filter((c) => c.id !== target.id
    && !evolution.samePhoneNumber(String(c.phone || ''), String(target.phone || '')));
  if (others.length === 0) return null;
  // Prefere quem esta recebendo bem (menos falhas) -- enviar funciona mesmo
  // numa conexao que nao recebe, mas assim o diagnostico fica mais limpo.
  others.sort((a, b) => (a.probeFailures || 0) - (b.probeFailures || 0));
  return others[0];
}

async function expireProbe(target) {
  const result = await prisma.waInstance.updateMany({
    where: { id: target.id, probeToken: target.probeToken },
    data: { probeToken: null, probeFailures: { increment: 1 } },
  });
  if (result.count > 0) {
    console.warn(`[inbound-probe] ${target.instanceName}: verificação NÃO chegou em ${Math.round(PROBE_TIMEOUT_MS / 60000)} min (falha ${(target.probeFailures || 0) + 1}).`);
  }
  return result.count > 0;
}

async function sendProbe(target, sender) {
  const backoffUntil = sendBackoff.get(sender.id) || 0;
  if (Date.now() < backoffUntil) return false;
  const settings = sender.tenant?.settings;
  const { evolutionUrl, evolutionKey } = evolution.resolveEvolutionConfig(settings, sender);
  if (!evolutionUrl || !evolutionKey) return false;
  const token = crypto.randomBytes(8).toString('hex');
  try {
    await evolution.sendText(
      evolutionUrl,
      evolutionKey,
      sender.instanceName,
      String(target.phone).replace(/\D/g, ''),
      buildProbeText(token),
    );
  } catch (err) {
    sendBackoff.set(sender.id, Date.now() + SEND_ERROR_BACKOFF_MS);
    console.warn(`[inbound-probe] falha ao enviar verificação ${sender.instanceName} -> ${target.instanceName}: ${err.message}`);
    return false;
  }
  await prisma.waInstance.update({
    where: { id: target.id },
    data: { probeToken: token, probeSentAt: new Date() },
  });
  return true;
}

/**
 * Um ciclo: expira sondas sem resposta (conta falha) e envia novas onde
 * necessario. Chamado pelo monitor de saude a cada ciclo; o ritmo real e
 * controlado pelos timestamps gravados em cada instancia.
 */
async function runProbeCycle(instances, nowMs = Date.now()) {
  if (!isEnabled()) return;
  const byTenant = new Map();
  for (const inst of instances || []) {
    if (!byTenant.has(inst.tenantId)) byTenant.set(inst.tenantId, []);
    byTenant.get(inst.tenantId).push(inst);
  }

  for (const [tenantId, list] of byTenant) {
    // Expira sempre (mesmo fora do horario) para nao deixar sonda pendurada.
    // Se o token ja foi consumido entre a leitura e agora (sonda chegou), a
    // instancia fica fora deste ciclo -- o proximo le o estado atualizado.
    const skip = new Set();
    for (const inst of list) {
      if (isProbeExpired(inst, nowMs)) {
        try {
          if (await expireProbe(inst)) {
            inst.probeToken = null;
            inst.probeFailures = (inst.probeFailures || 0) + 1;
          } else {
            skip.add(inst.id);
          }
        } catch (err) {
          skip.add(inst.id);
          console.warn(`[inbound-probe] falha ao expirar verificação: ${err.message}`);
        }
      }
    }

    const candidates = list.filter((inst) => isEligible(inst) && !skip.has(inst.id));
    if (candidates.length < 2) continue;
    if (!(await isProbeWindow(tenantId, new Date(nowMs)))) continue;

    for (const target of candidates) {
      if (!isProbeDue(target, nowMs)) continue;
      const sender = pickSender(target, candidates);
      if (!sender) continue;
      await sendProbe(target, sender);
    }
  }
}

module.exports = {
  consumeProbeMessage,
  noteInbound,
  runProbeCycle,
  isEnabled,
  FAILURES_TO_ALERT,
  __testing: {
    buildProbeText,
    extractProbeToken,
    isProbeDue,
    isProbeExpired,
    pickSender,
    isEligible,
    PROBE_INTERVAL_MS,
    PROBE_TIMEOUT_MS,
    SILENCE_TRIGGER_MS,
  },
};
