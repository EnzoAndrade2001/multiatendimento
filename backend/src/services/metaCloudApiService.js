const axios = require('axios');

const GRAPH_BASE = 'https://graph.facebook.com';

function graphVersion() {
  return process.env.META_GRAPH_VERSION || 'v20.0';
}

function graphErrorDetail(error) {
  return error?.response?.data?.error?.message
    || error?.response?.data?.error
    || error?.message
    || 'erro desconhecido';
}

// Inscreve o app dono do access token na WABA e aponta o callback de webhook
// da Meta direto para a Evolution (/webhook/meta). Sem isso a Meta nao entrega
// as mensagens recebidas para o nosso fluxo. Idempotente do lado da Meta.
async function subscribeAppToWaba({ wabaId, accessToken, callbackUrl, verifyToken }) {
  if (!wabaId || !accessToken) {
    throw new Error('WABA ID e access token sao obrigatorios para inscrever o app.');
  }
  const params = new URLSearchParams({ access_token: accessToken });
  if (callbackUrl && verifyToken) {
    params.set('override_callback_uri', callbackUrl);
    params.set('verify_token', verifyToken);
  }
  const { data } = await axios.post(
    `${GRAPH_BASE}/${graphVersion()}/${wabaId}/subscribed_apps`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 },
  );
  return data;
}

async function listWabaSubscriptions({ wabaId, accessToken }) {
  const { data } = await axios.get(
    `${GRAPH_BASE}/${graphVersion()}/${wabaId}/subscribed_apps`,
    { params: { access_token: accessToken }, timeout: 20000 },
  );
  return data;
}

module.exports = { subscribeAppToWaba, listWabaSubscriptions, graphVersion, graphErrorDetail };
