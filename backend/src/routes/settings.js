const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const filterSettingsAccess = require('../middlewares/filterSettingsAccess');
const auditSensitiveAction = require('../middlewares/auditSensitiveAction');
const auditEvent = require('../middlewares/auditEvent');
const { getSettings, saveSettings, testAiProvider, syncCompanyFromFirebird, syncPlugBoletoConfig, getSystemPromptPreview, getBusinessHours, saveBusinessHours, uploadLogo } = require('../controllers/settingsController');
const { getAgentInfo, downloadAgent, getAgentStatus } = require('../controllers/agentController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { uploadsPath } = require('../utils/uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens nos formatos PNG, JPG ou JPEG são permitidas.'));
    }
  }
});

router.use(authenticate);
router.get('/', requirePermission('settings.bot.manage', 'settings.attendance.manage', 'settings.company.manage', 'settings.agent.manage', 'connections.manage', 'leads.manage', 'revenue.view'), getSettings);
router.post('/', requirePermission('settings.bot.manage', 'settings.attendance.manage', 'settings.company.manage', 'settings.agent.manage', 'connections.manage', 'leads.manage', 'revenue.view'), filterSettingsAccess, auditSensitiveAction('SETTINGS_UPDATE', 'tenant_settings'), auditEvent('SETTINGS_UPDATE', 'tenant_settings'), saveSettings);
router.post('/ai/test', requirePermission('settings.bot.manage'), auditSensitiveAction('AI_PROVIDER_TEST', 'tenant_settings'), auditEvent('AI_PROVIDER_TEST', 'tenant_settings'), testAiProvider);
router.get('/agent-info', requirePermission('settings.agent.manage'), getAgentInfo);
router.get('/agent-status', requirePermission('settings.agent.manage'), getAgentStatus);
router.get('/agent-download', requirePermission('settings.agent.manage'), downloadAgent);
router.post('/company/sync', requirePermission('settings.company.manage'), auditSensitiveAction('COMPANY_SYNC_REQUEST', 'tenant_settings'), auditEvent('COMPANY_SYNC_REQUEST', 'tenant_settings'), syncCompanyFromFirebird);
router.post('/plugboleto/sync', requirePermission('settings.agent.manage'), auditSensitiveAction('PLUGBOLETO_CONFIG_SYNC', 'tenant_settings'), auditEvent('PLUGBOLETO_CONFIG_SYNC', 'tenant_settings'), syncPlugBoletoConfig);
router.post('/system-prompt-preview', requirePermission('settings.bot.manage'), getSystemPromptPreview);
router.get('/business-hours', getBusinessHours);
router.post('/business-hours', requirePermission('settings.attendance.manage'), auditSensitiveAction('BUSINESS_HOURS_UPDATE', 'tenant_settings'), auditEvent('BUSINESS_HOURS_UPDATE', 'tenant_settings'), saveBusinessHours);
router.post('/logo', requirePermission('settings.company.manage'), upload.single('file'), auditSensitiveAction('COMPANY_LOGO_UPDATE', 'tenant_settings'), auditEvent('COMPANY_LOGO_UPDATE', 'tenant_settings'), uploadLogo);

module.exports = router;
