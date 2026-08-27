const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { list, usage, create, update, remove, archive, restore } = require('../controllers/tagController');

router.use(authenticate, requirePermission('tags.manage'));
router.get('/', list);
router.get('/usage', usage);
router.post('/', create);
router.patch('/:id/archive', archive);
router.patch('/:id/restore', restore);
router.patch('/:id', update);
router.delete('/:id', remove);

module.exports = router;
