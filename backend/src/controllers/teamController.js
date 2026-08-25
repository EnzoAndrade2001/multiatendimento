const prisma = require('../lib/prisma');

async function list(req, res) {
  const teams = await prisma.team.findMany({
    where: { tenantId: req.user.tenantId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } }
      }
    },
    orderBy: { name: 'asc' },
  });
  res.json(teams);
}

async function create(req, res) {
  const { name } = req.body;

  const team = await prisma.team.create({
    data: {
      tenantId: req.user.tenantId,
      name,
    },
  });
  res.json(team);
}

async function update(req, res) {
  const { id } = req.params;
  const { name } = req.body;

  try {
    const existing = await prisma.team.findFirst({ where: { id, tenantId: req.user.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Equipe não encontrada ou acesso negado' });

    const team = await prisma.team.update({
      where: { id },
      data: { name },
    });
    res.json(team);
  } catch (err) {
    res.status(404).json({ error: 'Equipe não encontrada ou acesso negado' });
  }
}

async function remove(req, res) {
  const { id } = req.params;

  try {
    // Verifica se a equipe pertence ao tenant
    const team = await prisma.team.findFirst({ where: { id, tenantId: req.user.tenantId } });
    if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

    const messageCount = await prisma.internalMessage.count({ where: { tenantId: req.user.tenantId, teamId: id } });
    if (messageCount > 0) {
      return res.status(409).json({ error: 'Equipe possui histórico no chat interno e não pode ser excluída.' });
    }

    await prisma.teamMember.deleteMany({ where: { teamId: id } });
    await prisma.team.delete({ where: { id } });
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function addMember(req, res) {
  const { teamId, userId } = req.body;

  // Valida se a equipe pertence ao tenant
  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId: req.user.tenantId } });
  if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

  // Valida se o usuário pertence ao tenant
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId: req.user.tenantId } });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const member = await prisma.teamMember.create({
    data: { teamId, userId },
    include: { user: { select: { id: true, name: true } } }
  });
  res.json(member);
}

async function removeMember(req, res) {
  const { teamId, userId } = req.params;

  // Valida se a equipe pertence ao tenant
  const team = await prisma.team.findFirst({ where: { id: teamId, tenantId: req.user.tenantId } });
  if (!team) return res.status(404).json({ error: 'Equipe não encontrada' });

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId } }
  });
  res.sendStatus(204);
}

module.exports = { list, create, update, remove, addMember, removeMember };
