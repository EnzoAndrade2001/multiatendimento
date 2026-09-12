const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const requireTicketAccess = require('../middlewares/requireTicketAccess');
const { heartbeat, leave } = require('../services/ticketPresenceService');

router.use(authenticate, requirePermission('inbox.view'), requireEntitlement('inbox'));
router.use('/:id', requireTicketAccess);
router.post('/:id', async (req, res) => {
  try {
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId }, select: { id: true } });
    if (!ticket) return res.status(404).json({ error: 'Atendimento não encontrado.' });
    return res.json(await heartbeat(prisma, req.user, ticket.id, req.body));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível atualizar a presença.' });
  }
});
router.delete('/:id', async (req, res) => {
  try { await leave(prisma, req.user, req.params.id, req.body); return res.sendStatus(204); }
  catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível encerrar a presença.' }); }
});
module.exports = router;
