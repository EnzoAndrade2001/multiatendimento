const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const webhookRoutes = require('./routes/webhook');
const settingsRoutes = require('./routes/settings');
const instanceRoutes = require('./routes/instance');
const contactRoutes = require('./routes/contacts');
const userRoutes = require('./routes/users');
const teamRoutes = require('./routes/teams');
const dashboardRoutes = require('./routes/dashboardRoutes');
const superadminRoutes = require('./routes/superadmin');
const quickResponseRoutes = require('./routes/quickResponses');
const internalMessageRoutes = require('./routes/internalMessages');
const scheduledMessageRoutes = require('./routes/scheduledMessages');
const scheduleProcessor = require('./services/scheduleProcessor');
const { setIo: setIoWebhook } = require('./controllers/webhookController');
const { setIo: setIoTicket } = require('./controllers/ticketController');
const { setIo: setIoInternal } = require('./controllers/internalMessageController');
const campaignRoutes = require('./routes/campaignRoutes');
const { setIo: setIoCampaign } = require('./controllers/campaignController');
const { setIo: setIoBilling } = require('./controllers/billingController');
const { setIo: setIoManagerCopy } = require('./services/serviceOrderManagerCopyService');
const { setIo: setIoBillingDocuments } = require('./services/billingDocumentService');
const tagRoutes = require('./routes/tagRoutes');
const uploadRoutes = require('./routes/upload');
const osRoutes = require('./routes/osRoutes');
const leadRoutes = require('./routes/leadRoutes');
const revenueRoutes = require('./routes/revenue');
const crmRoutes = require('./routes/crm');
const integrationRoutes = require('./routes/integrations');
const firebirdSyncRoutes = require('./routes/firebirdSync');
const privacyRoutes = require('./routes/privacy');
const mediaRoutes = require('./routes/media');

const app = express();
app.use('/api/report', require('./routes/report'));

const server = http.createServer(app);
const bootAt = Date.now();

const io = new Server(server, {
  cors: { 
    origin: process.env.FRONTEND_URL || '*', 
    credentials: true,
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  transports: ['websocket', 'polling']
});

setIoWebhook(io);
setIoTicket(io);
setIoInternal(io);
setIoCampaign(io);
setIoBilling(io);
setIoManagerCopy(io);
setIoBillingDocuments(io);

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5174', credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;

    if (durationMs < 1500) return;

    const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.warn(
      `[perf] ${req.method} ${req.path} -> ${res.statusCode} em ${durationMs}ms | rss=${memoryMb}MB | uptime=${Math.round(process.uptime())}s`
    );
  });

  next();
});

// Serve arquivos estáticos ANTES das rotas da API
const { uploadsPath } = require('./utils/uploads');
// Mídias de atendimento/documentos exigem autorização tenant-aware em /api/media.
// Arquivos públicos não sensíveis (ex.: logotipo da empresa) continuam em /uploads.
app.use('/uploads/media', (_req, res) => res.status(404).json({ error: 'Arquivo não encontrado.' }));
app.use('/uploads', express.static(uploadsPath, {
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
  },
}));

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/instance', instanceRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/users', userRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/quick-responses', quickResponseRoutes);
app.use('/api/internal-messages', internalMessageRoutes);
app.use('/api/scheduled-messages', scheduledMessageRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/upload', uploadRoutes);
app.use('/api/os', osRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/integrations/firebird', firebirdSyncRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/media', mediaRoutes);

const jwt = require('jsonwebtoken');
const prisma = require('./lib/prisma');
const { resolveUserAccess, hasPermission } = require('./auth/permissions');
const onlineUsersByTenant = new Map();
const internalViewersByTenant = new Map();

function changeCounter(container, key, delta) {
  const next = Math.max(0, Number(container.get(key) || 0) + delta);
  if (next === 0) container.delete(key);
  else container.set(key, next);
}

function emitInternalPresence(tenantId) {
  const users = onlineUsersByTenant.get(tenantId) || new Map();
  io.to(tenantId).emit('internal_presence', { onlineUserIds: [...users.keys()] });
}

function internalConversationKey(left, right) {
  return [String(left), String(right)].sort().join(':');
}

function leaveInternalConversation(socket) {
  const { tenantId, userId } = socket.user;
  const peerId = socket.internalViewingPeerId;
  if (!peerId) return;
  const tenantViews = internalViewersByTenant.get(tenantId);
  const conversationKey = internalConversationKey(userId, peerId);
  const viewers = tenantViews?.get(conversationKey);
  if (viewers) {
    changeCounter(viewers, userId, -1);
    if (!viewers.size) tenantViews.delete(conversationKey);
    io.to(tenantId).emit('internal_viewers', {
      conversationKey,
      viewerUserIds: [...viewers.keys()]
    });
  }
  socket.internalViewingPeerId = null;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) return next(new Error('Autenticação requerida'));
  
  if (!process.env.JWT_SECRET) {
    console.error('[CRITICAL] JWT_SECRET não configurada!');
    return next(new Error('Erro interno do servidor'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true, tenantId: true, role: true, active: true,
        accessProfile: true, permissions: true,
        tenant: { select: { active: true } },
      },
    });
    if (!user || !user.active || !user.tenant?.active) return next(new Error('Usuario inativo'));
    const access = resolveUserAccess(user);
    socket.user = {
      userId: user.id, tenantId: user.tenantId, role: user.role,
      accessProfile: access.profile, permissions: access.permissions,
    };
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

io.on('connection', (socket) => {
  const { tenantId, userId } = socket.user;
  socket.join(tenantId);
  socket.join(`user:${userId}`);
  prisma.teamMember.findMany({
    where: { userId, team: { tenantId } }, select: { teamId: true },
  }).then((memberships) => {
    memberships.forEach(({ teamId }) => socket.join(`team:${teamId}`));
  }).catch((error) => {
    console.warn(`[socket] falha ao carregar salas internas: ${error.message}`);
  });

  if (!onlineUsersByTenant.has(tenantId)) onlineUsersByTenant.set(tenantId, new Map());
  changeCounter(onlineUsersByTenant.get(tenantId), userId, 1);
  emitInternalPresence(tenantId);

  socket.on('internal_viewing', ({ peerId } = {}) => {
    if (!hasPermission(socket.user, 'internal_chat.view')) return;
    leaveInternalConversation(socket);
    if (!peerId || peerId === userId) return;

    socket.internalViewingPeerId = peerId;
    if (!internalViewersByTenant.has(tenantId)) internalViewersByTenant.set(tenantId, new Map());
    const tenantViews = internalViewersByTenant.get(tenantId);
    const conversationKey = internalConversationKey(userId, peerId);
    if (!tenantViews.has(conversationKey)) tenantViews.set(conversationKey, new Map());
    changeCounter(tenantViews.get(conversationKey), userId, 1);
    io.to(tenantId).emit('internal_viewers', {
      conversationKey,
      viewerUserIds: [...tenantViews.get(conversationKey).keys()]
    });
  });

  socket.on('disconnect', (reason) => {
    leaveInternalConversation(socket);
    const onlineUsers = onlineUsersByTenant.get(tenantId);
    if (onlineUsers) {
      changeCounter(onlineUsers, userId, -1);
      if (!onlineUsers.size) onlineUsersByTenant.delete(tenantId);
    }
    emitInternalPresence(tenantId);
    console.log(`[socket] usuário ${userId} DESCONECTADO do tenant ${tenantId}. Motivo: ${reason}`);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`[server] rodando na porta ${PORT}`);
  console.log(`[server] boot=${new Date(bootAt).toISOString()} pid=${process.pid}`);
  scheduleProcessor.start();

  // Auto-correção de URLs da Evolution inválidas (ex: contendo '@' ou emails)
  (async () => {
    try {
      const prisma = require('./lib/prisma');
      const { repairInvalidEvolutionSettings } = require('./services/startupEvolutionSettingsService');
      await repairInvalidEvolutionSettings(prisma);
    } catch (err) {
      console.error('[startup-fix] Erro ao executar auto-correção:', err.message);
    }

    // Sincronização automática de webhooks para garantir que MESSAGES_SET esteja ativo
    try {
      const prisma = require('./lib/prisma');
      const evolution = require('./services/evolutionService');
      const instances = await prisma.waInstance.findMany();
      if (instances.length > 0) {
        console.log(`[startup-webhook-fix] Verificando/atualizando webhooks para ${instances.length} instâncias...`);
        const backendUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3002}`;
        const webhookUrl = `${backendUrl}/api/webhook`;
        
        for (const inst of instances) {
          const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: inst.tenantId } });
          const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
          const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;
          if (evolutionUrl && evolutionKey) {
            console.log(`[startup-webhook-fix] Atualizando webhook da instância ${inst.instanceName} com URL ${webhookUrl}...`);
            await evolution.setWebhook(evolutionUrl, evolutionKey, inst.instanceName, webhookUrl);
          }
        }
        console.log(`[startup-webhook-fix] Concluído.`);
      }
    } catch (err) {
      console.error('[startup-webhook-fix] Erro ao sincronizar webhooks:', err.message);
    }
  })();
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});

module.exports = { app, server };
