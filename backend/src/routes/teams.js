const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { list, create, update, remove, addMember, removeMember } = require('../controllers/teamController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate);
router.get('/', list);
router.use(requirePermission('teams.manage'));
router.post('/', auditEvent('TEAM_CREATE', 'team'), create);
router.patch('/:id', auditEvent('TEAM_UPDATE', 'team'), update);
router.delete('/:id', auditEvent('TEAM_DELETE', 'team'), remove);
router.post('/members', auditEvent('TEAM_MEMBER_ADD', 'team'), addMember);
router.delete('/members/:teamId/:userId', auditEvent('TEAM_MEMBER_REMOVE', 'team', { resourceId: (req) => req.params.teamId }), removeMember);

module.exports = router;
