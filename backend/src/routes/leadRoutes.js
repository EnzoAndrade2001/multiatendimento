const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const leadController = require('../controllers/leadController');
const { uploadsPath } = require('../utils/uploads');

const leadUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsPath),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 12)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    cb(null, allowed.has(String(file.mimetype || '').toLowerCase()));
  },
});

router.use(auth, requirePermission('leads.manage'));

router.get('/', leadController.getLeads);
router.get('/instances', leadController.getLeadInstances);
router.get('/audit', leadController.getLeadAudit);
router.get('/campaigns', leadController.getLeadCampaigns);
router.get('/:id/history', leadController.getLeadHistory);
router.post('/:id/convert', leadController.convertLead);
router.post('/upload', leadUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem válida foi enviada.' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size });
});
router.post('/search', leadController.searchLeads);
router.post('/manual', leadController.createManualLeads);
router.post('/send', leadController.sendToLeads);
router.delete('/all', leadController.deleteAllLeads);
router.delete('/:id', leadController.deleteLead);

module.exports = router;
