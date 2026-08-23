const fs = require('fs');
const path = require('path');

const DEFAULT_AGENT_DOWNLOAD_URL = 'https://github.com/connectbrazilads/multiatendimento/raw/main/firebird-client/FirebirdCRMClient.exe';
const DEFAULT_AGENT_RELEASE_DIR = '/data/agent-releases';

function getAgentFileName() {
  // Nunca permite que uma configuração de ambiente escape da pasta de releases.
  return path.basename(process.env.FIREBIRD_AGENT_FILE_NAME || 'FirebirdCRMClient.exe');
}

function getLocalAgentPath() {
  const releaseDir = path.resolve(process.env.FIREBIRD_AGENT_RELEASE_DIR || DEFAULT_AGENT_RELEASE_DIR);
  const filePath = path.resolve(releaseDir, getAgentFileName());
  if (!filePath.startsWith(`${releaseDir}${path.sep}`)) return null;
  return { releaseDir, filePath };
}

function getAgentInfo(req, res) {
  const downloadUrl = String(process.env.FIREBIRD_AGENT_DOWNLOAD_URL || DEFAULT_AGENT_DOWNLOAD_URL).trim();
  const local = getLocalAgentPath();
  const downloadAvailable = Boolean(local && fs.existsSync(local.filePath));

  res.json({
    version: process.env.FIREBIRD_AGENT_VERSION || '1.0.0',
    fileName: getAgentFileName(),
    downloadUrl: '/api/settings/agent-download',
    externalDownloadUrl: downloadUrl,
    downloadAvailable,
    storage: 'volume',
    storagePath: process.env.FIREBIRD_AGENT_RELEASE_DIR || DEFAULT_AGENT_RELEASE_DIR,
    sha256: process.env.FIREBIRD_AGENT_SHA256 || null,
    releasedAt: process.env.FIREBIRD_AGENT_RELEASED_AT || null,
    supportUrl: process.env.FIREBIRD_AGENT_SUPPORT_URL || null,
  });
}

function downloadAgent(req, res) {
  const local = getLocalAgentPath();
  if (!local || !fs.existsSync(local.filePath)) {
    return res.status(404).json({
      error: 'Pacote do agente ainda não publicado no volume persistente.',
      path: process.env.FIREBIRD_AGENT_RELEASE_DIR || DEFAULT_AGENT_RELEASE_DIR,
    });
  }

  return res.download(local.filePath, getAgentFileName(), (error) => {
    if (error && !res.headersSent) {
      res.status(500).json({ error: 'Não foi possível preparar o download do agente.' });
    }
  });
}

module.exports = { getAgentInfo, downloadAgent };
