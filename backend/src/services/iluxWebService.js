const DEFAULT_SYNC_PATH = '/api/assistencia/os/sincronizar-lcd';
const DEFAULT_ORDERS_PATH = '/api/assistencia/os/integracao-crm/clientes';
const DEFAULT_COMPANY_PATH = '/api/assistencia/os/integracao-crm/empresa';
const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.ILUX_WEB_REQUEST_TIMEOUT_MS, 10) || 30000,
);

function getBaseUrl() {
  return String(process.env.ILUX_WEB_URL || '').trim().replace(/\/+$/, '');
}

function getToken() {
  return String(process.env.ILUX_WEB_SYNC_TOKEN || '').trim();
}

function isIluxWebConfigured() {
  return Boolean(getBaseUrl() && getToken());
}

function integrationConfigError() {
  if (!getBaseUrl()) return 'ILUX_WEB_URL não configurada no CRM.';
  if (!getToken()) return 'ILUX_WEB_SYNC_TOKEN não configurado no CRM.';
  return null;
}

function buildUrl(pathname) {
  const base = getBaseUrl();
  if (!base) throw new Error('ILUX_WEB_URL não configurada no CRM.');
  return new URL(pathname, `${base}/`).toString();
}

async function requestJson(pathname, options = {}) {
  const configError = integrationConfigError();
  if (configError) throw new Error(configError);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(pathname), {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Ilux-Agente-Token': getToken(),
        'X-Lcd-Agente-Token': getToken(),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // A mensagem abaixo identifica o endpoint sem expor o token.
    }
    if (!response.ok || data?.ok === false) {
      const detail = data?.error || data?.message || text.slice(0, 500) || `HTTP ${response.status}`;
      throw new Error(`ILUX_WEB respondeu ${response.status}: ${detail}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Tempo esgotado ao comunicar com o ILUX_WEB (${REQUEST_TIMEOUT_MS} ms).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createServiceOrderInIluxWeb(payload) {
  const path = process.env.ILUX_WEB_OS_SYNC_PATH || DEFAULT_SYNC_PATH;
  return requestJson(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function listServiceOrdersFromIluxWeb(customerExternalId, { limit = 100 } = {}) {
  if (!isIluxWebConfigured() || !customerExternalId) return { items: [], lastSyncedAt: null, source: null };
  const basePath = process.env.ILUX_WEB_OS_ORDERS_PATH || DEFAULT_ORDERS_PATH;
  const path = `${basePath.replace(/\/+$/, '')}/${encodeURIComponent(String(customerExternalId))}/ordens`;
  const data = await requestJson(path, { method: 'GET' });
  const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
  return {
    items: items.slice(0, Math.max(1, Math.min(Number(limit) || 100, 250))),
    lastSyncedAt: data.generatedAt || data.lastSyncedAt || new Date().toISOString(),
    source: 'ilux_web',
  };
}

async function getCompanyProfileFromIluxWeb() {
  if (!isIluxWebConfigured()) return null;
  const path = process.env.ILUX_WEB_COMPANY_PATH || DEFAULT_COMPANY_PATH;
  const data = await requestJson(path, { method: 'GET' });
  return data?.empresa || data || null;
}

module.exports = {
  createServiceOrderInIluxWeb,
  getCompanyProfileFromIluxWeb,
  isIluxWebConfigured,
  listServiceOrdersFromIluxWeb,
};
