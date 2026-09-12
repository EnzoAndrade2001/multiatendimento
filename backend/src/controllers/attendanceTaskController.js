const prisma = require('../lib/prisma');
const { createTaskService } = require('../services/attendanceTaskService');
const service = createTaskService(prisma);
const handle = (action, status = 200) => async (req, res) => {
  try { return res.status(status).json(await action(req)); }
  catch (error) {
    if (!error.statusCode) console.error('[AttendanceTasks]', error.message);
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível processar a pendência.' });
  }
};
exports.list = handle(req => service.list(req.user, req.query));
exports.options = handle(req => service.options(req.user, req.query));
exports.waiting = handle(req => service.waiting(req.user, req.query));
exports.create = handle(req => service.create(req.user, req.body), 201);
exports.update = handle(req => service.update(req.user, req.params.id, req.body));
