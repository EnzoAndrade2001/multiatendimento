const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const filterSettingsAccess = require('../middlewares/filterSettingsAccess');
const { getSettings, saveSettings, syncCompanyFromFirebird, getSystemPromptPreview, getBusinessHours, saveBusinessHours, uploadLogo } = require('../controllers/settingsController');
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
router.post('/', requirePermission('settings.bot.manage', 'settings.attendance.manage', 'settings.company.manage', 'settings.agent.manage', 'connections.manage', 'leads.manage', 'revenue.view'), filterSettingsAccess, saveSettings);
router.post('/company/sync', requirePermission('settings.company.manage'), syncCompanyFromFirebird);
router.post('/system-prompt-preview', requirePermission('settings.bot.manage'), getSystemPromptPreview);
router.get('/business-hours', getBusinessHours);
router.post('/business-hours', requirePermission('settings.attendance.manage'), saveBusinessHours);
router.post('/logo', requirePermission('settings.company.manage'), upload.single('file'), uploadLogo);

module.exports = router;
