function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

const CANCELLED_VALUES = new Set(['CANCELADA', 'CANCELADO', 'CANCELLED', 'CANCELED']);
const FINISHED_VALUES = new Set(['O', 'F', 'C', 'FINALIZADA', 'FINALIZADO', 'CONCLUIDA', 'CONCLUIDO', 'FECHADA', 'FECHADO', 'ENCERRADA', 'ENCERRADO']);
const ATTENDING_VALUES = new Set(['E', 'M', 'T']);

function isCancelledServiceOrderStatus(value) {
  const status = normalizedText(value);
  return CANCELLED_VALUES.has(status) || status.includes('CANCEL');
}

function normalizeServiceOrderStatus(value, { closedAt = null, closing = null } = {}) {
  const status = normalizedText(value);
  if (isCancelledServiceOrderStatus(status)) return 'CANCELADA';
  if (closedAt || FINISHED_VALUES.has(status) || status.includes('CONCLU') || status.includes('FINALIZ') || status.includes('FECHAD') || status.includes('ENCERRAD')) return 'FINALIZADA';
  if (!status && closing) return 'FINALIZADA';
  if (status.includes('AGUARD') || status.includes('RETORNO')) return 'AGUARDANDO_RETORNO';
  if (status.includes('ATEND') || ATTENDING_VALUES.has(status)) return 'EM_ATENDIMENTO';
  return 'PENDENTE';
}

function isServiceOrderClosed(orderOrStatus, options = {}) {
  const order = orderOrStatus && typeof orderOrStatus === 'object' ? orderOrStatus : null;
  const status = order ? order.status : orderOrStatus;
  const closedAt = order?.closedAt || order?.resolvedAt || options.closedAt || null;
  const normalized = normalizeServiceOrderStatus(status, { ...options, closedAt });
  return normalized === 'FINALIZADA' || normalized === 'CANCELADA';
}

function rawServiceOrderStatus(payload) {
  const raw = payload?.raw && typeof payload.raw === 'object' ? payload.raw : payload || {};
  return raw.status ?? raw.nmstatus ?? raw.nmStatus ?? payload?.status ?? payload?.nmStatus ?? raw.tffaturar ?? null;
}

module.exports = {
  isCancelledServiceOrderStatus,
  isServiceOrderClosed,
  normalizeServiceOrderStatus,
  normalizedText,
  rawServiceOrderStatus,
};
