const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

async function updateProfile(req, res) {
  const { name, email, password } = req.body;
  const userId = req.user.userId;

  const data = {
    ...(name && { name }),
    ...(email && { email }),
  };

  if (password) {
    data.password = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, role: true, avatarUrl: true },
  });

  res.json(user);
}

module.exports = { updateProfile };
