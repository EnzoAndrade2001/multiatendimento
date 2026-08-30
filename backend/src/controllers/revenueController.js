const prisma = require('../lib/prisma');
const crmController = require('./crmController');
const aiService = require('../services/aiService');
const printGuardService = require('../services/printGuardService');
const { generateText } = aiService;

const SENTINELA_SYNC_STALE_AFTER_MINUTES = 15;

function asFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().replace(/\./g, (match, offset, input) => {
    // Mantem pontos decimais; remove apenas separadores de milhar quando a
    // string tambem possui virgula decimal (ex.: 1.234,56).
    return input.includes(',') ? '' : match;
  }).replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = asFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : 0;
}

function customerMonthlyValue(customer) {
  const raw = customer?.raw && typeof customer.raw === 'object' ? customer.raw : {};
  return positiveNumber(
    raw.total_mensalidade ?? raw.totalMensalidade ?? raw.monthlyValue ?? raw.monthly_value
  );
}

function buildSyncHealth(settings) {
  const lastSyncedAt = settings?.firebirdLastSyncAt ? new Date(settings.firebirdLastSyncAt) : null;
  const validLastSyncedAt = lastSyncedAt && !Number.isNaN(lastSyncedAt.getTime()) ? lastSyncedAt : null;
  const ageMinutes = validLastSyncedAt
    ? Math.max(0, Math.floor((Date.now() - validLastSyncedAt.getTime()) / 60000))
    : null;
  return {
    source: 'firebird-agent-cache',
    status: settings?.firebirdLastSyncStatus || 'unknown',
    lastSyncedAt: validLastSyncedAt,
    ageMinutes,
    stale: ageMinutes === null || ageMinutes > SENTINELA_SYNC_STALE_AFTER_MINUTES,
    staleAfterMinutes: SENTINELA_SYNC_STALE_AFTER_MINUTES,
    error: settings?.firebirdLastSyncError || null,
  };
}

async function getRevenueDashboard(req, res) {
  const tenantId = req.user.tenantId;

  try {
    // A leitura de telemetria é independente dos indicadores financeiros. Ela
    // começa em paralelo para não aumentar desnecessariamente o tempo do
    // Sentinela e nunca impede o restante do painel de carregar.
    const telemetryPromise = printGuardService.managerSnapshot(tenantId).catch((error) => {
      console.error('[revenueController] Falha ao montar resumo do PrintGuard:', error);
      return {
        available: false,
        connectionStatus: 'ERROR',
        connectionName: null,
        lastConnectedAt: null,
        lastSignalAt: null,
        windowHours: 24,
        total: 0,
        critical: 0,
        awaitingDecision: 0,
        monitoring: 0,
        errors: 0,
        unlinked: 0,
        lowToner: 0,
        affectedEquipment: 0,
        incidents: [],
        message: 'Resumo de telemetria indisponivel no momento.',
      };
    });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const kpiSlaLimitHours = settings?.kpiSlaLimitHours ?? 24;
    const reincidentThreshold = settings?.kpiReincidentThreshold ?? 2;
    const manualContractFallback = positiveNumber(settings?.kpiContractValue);
    const manualServiceFallback = positiveNumber(settings?.kpiServiceValue);
    const synchronization = buildSyncHealth(settings);
    const slaLimitDate = new Date(Date.now() - kpiSlaLimitHours * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // ───────────────────────────────────────────────────────────────
    // 1. CARREGAR TODAS AS O.S. REAIS DO iLux (Firebird)
    //    Fonte: ExternalSyncRecord com entity = 'serviceOrders'
    // ───────────────────────────────────────────────────────────────
    const allFirebirdOS = await prisma.externalSyncRecord.findMany({
      where: { tenantId, source: 'firebird', entity: 'serviceOrders' },
      select: { externalId: true, payload: true, receivedAt: true },
    });

    function fbStatus(payload) {
      const raw = payload?.raw || payload || {};
      const status = String(raw.status || raw.nmstatus || payload?.status || '').trim().toUpperCase();
      const closedAt = raw.dtfechamento || payload?.closedAt;
      if (closedAt || ['O', 'F', 'C', 'FINALIZADA', 'CONCLUIDA'].includes(status)) return 'FINALIZADA';
      if (status.includes('AGUARD')) return 'AGUARDANDO_RETORNO';
      if (status.includes('ATEND') || ['E', 'M', 'T'].includes(status)) return 'EM_ATENDIMENTO';
      return 'PENDENTE';
    }

    function fbDate(payload, ...keys) {
      const raw = payload?.raw || payload || {};
      for (const key of keys) {
        const val = raw[key] || raw[key.toLowerCase()] || raw[key.toUpperCase()] || payload?.[key];
        if (val) { const d = new Date(val); if (!Number.isNaN(d.getTime())) return d; }
      }
      return null;
    }

    const classified = allFirebirdOS.map(r => {
      const p = r.payload || {};
      const status = fbStatus(p);
      const openedAt = fbDate(p, 'dtinclusao', 'createdAt', 'updatedAt');
      const closedAt = fbDate(p, 'dtfechamento', 'closedAt');
      const raw = p.raw || p;
      return {
        externalId: r.externalId,
        payload: p,
        status,
        openedAt,
        closedAt,
        clientExternalId: String(raw.cdcliente || p.clientExternalId || ''),
        clientName: String(raw.nmcliente || p.clientName || ''),
        technician: raw.nmsuportet || raw.nmsuportel || p.technician || '',
        equipmentId: String(raw.cdequipamento || p.equipmentExternalId || ''),
      };
    });

    // Calcular o Tempo Médio em Aberto (em horas) para O.S. ativas
    const activeOS = classified.filter(o => o.status === 'PENDENTE' || o.status === 'EM_ATENDIMENTO');
    let totalOpenHours = 0;
    let activeOSCount = 0;
    const now = Date.now();
    for (const o of activeOS) {
      if (o.openedAt) {
        totalOpenHours += (now - o.openedAt.getTime()) / (1000 * 60 * 60);
        activeOSCount++;
      }
    }
    const averageOpenTimeHours = activeOSCount > 0 ? totalOpenHours / activeOSCount : 0;


    // ───────────────────────────────────────────────────────────────
    // 2. FUNIL DE ATENDIMENTO (dados reais do iLux)
    // ───────────────────────────────────────────────────────────────
    const pendentes = classified.filter(o => o.status === 'PENDENTE');
    const emAtendimento = classified.filter(o => o.status === 'EM_ATENDIMENTO');
    const aguardando = classified.filter(o => o.status === 'AGUARDANDO_RETORNO');
    const finalizadas30d = classified.filter(o => o.status === 'FINALIZADA' && o.closedAt && o.closedAt >= thirtyDaysAgo);

    // ───────────────────────────────────────────────────────────────
    // 3. MRR EM RISCO — O.S. abertas que quebraram SLA
    // ───────────────────────────────────────────────────────────────
    const criticalOS = classified.filter(o =>
      (o.status === 'PENDENTE' || o.status === 'EM_ATENDIMENTO') &&
      o.openedAt && o.openedAt <= slaLimitDate
    );
    const uniqueClientsAtRisk = [...new Set(criticalOS.map(o => o.clientExternalId).filter(Boolean))];

    // O cadastro sincronizado do cliente pode conter a mensalidade mesmo
    // quando o registro de contrato ainda não informa um valor. Carregamos
    // tudo de uma vez para evitar uma consulta por cliente.
    const crmCustomersAtRisk = uniqueClientsAtRisk.length > 0
      ? await prisma.crmCustomer.findMany({
          where: { tenantId, externalId: { in: uniqueClientsAtRisk } },
          select: { externalId: true, raw: true },
        })
      : [];
    const crmCustomerMap = new Map(crmCustomersAtRisk.map(customer => [String(customer.externalId), customer]));

    let mrrInRisk = 0;
    const mrrRiskBands = { band1to3: 0, band3to7: 0, bandOver7: 0 };
    let clientsAtRiskList = [];
    const mrrValueSources = { firebird: 0, crm: 0, manual_estimate: 0, missing: 0 };

    for (const clientExtId of uniqueClientsAtRisk) {
      try {
        const contracts = await crmController.loadContracts(tenantId, clientExtId);
        const activeContracts = contracts.filter(c => c.isActive);
        const firebirdMRR = activeContracts.reduce((sum, contract) => {
          // monthlyValue é a mensalidade oficial. Só usamos value em
          // snapshots antigos que ainda não possuíam monthlyValue; não
          // transformamos um total anual em MRR por engano.
          const monthly = positiveNumber(contract.monthlyValue);
          if (monthly > 0) return sum + monthly;
          if (contract.monthlyValue === undefined || contract.monthlyValue === null) {
            return sum + positiveNumber(contract.value);
          }
          return sum;
        }, 0);
        const crmMRR = customerMonthlyValue(crmCustomerMap.get(String(clientExtId)));
        let clientMRR = firebirdMRR;
        let valueSource = 'firebird';
        if (clientMRR <= 0 && crmMRR > 0) {
          clientMRR = crmMRR;
          valueSource = 'crm';
        }
        if (clientMRR <= 0 && manualContractFallback > 0) {
          clientMRR = manualContractFallback;
          valueSource = 'manual_estimate';
        }
        if (clientMRR <= 0) valueSource = 'missing';
        mrrValueSources[valueSource] += 1;

        if (activeContracts.length > 0 || clientMRR > 0) {
          mrrInRisk += clientMRR;

          // Encontrar a O.S. mais antiga pendente deste cliente
          const clientOSs = criticalOS.filter(o => o.clientExternalId === clientExtId);
          clientOSs.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
          const oldestOS = clientOSs[0];
          const daysLate = (Date.now() - oldestOS.openedAt.getTime()) / (1000 * 60 * 60 * 24);

          // Agrupar nas faixas
          if (daysLate <= 3) mrrRiskBands.band1to3 += clientMRR;
          else if (daysLate <= 7) mrrRiskBands.band3to7 += clientMRR;
          else mrrRiskBands.bandOver7 += clientMRR;

          clientsAtRiskList.push({
            clientExternalId: clientExtId,
            clientName: oldestOS.clientName || `Cliente #${clientExtId}`,
            mrr: clientMRR,
            valueSource,
            daysLate: daysLate,
            oldestOSExternalId: oldestOS.externalId
          });
        }
      } catch (_err) { /* ignora erro individual */ }
    }

    // Ordenar ranking pelos de maior MRR
    clientsAtRiskList.sort((a, b) => b.mrr - a.mrr);
    const rankingClientsAtRisk = clientsAtRiskList.slice(0, 10);


    // ───────────────────────────────────────────────────────────────
    // 4. GARGALOS CRÍTICOS (dados reais do Firebird)
    // ───────────────────────────────────────────────────────────────
    const noTechnicianCount = pendentes.filter(o => !o.technician).length;

    const equipmentCounts = {};
    for (const o of classified) {
      if (o.openedAt && o.openedAt >= thirtyDaysAgo && o.equipmentId) {
        equipmentCounts[o.equipmentId] = (equipmentCounts[o.equipmentId] || 0) + 1;
      }
    }
    const reincidentEquipmentsCount = Object.values(equipmentCounts).filter(c => c > reincidentThreshold).length;

    const badCsatCount = await prisma.ticket.count({
      where: { tenantId, rating: { not: null, lte: 2 }, resolvedAt: { gte: thirtyDaysAgo } }
    });

    // ───────────────────────────────────────────────────────────────
    // VALOR ESTIMADO DE UMA O.S. (peças/serviço, quando o Firebird informa)
    // ───────────────────────────────────────────────────────────────
    function resolveServiceOrderValue(payload, fallbackValue = 0) {
      const raw = payload?.raw || payload || {};
      const parsedValues = [raw.vltotal, raw.vlservico, raw.vlpecas, payload?.totalValue]
        .map(asFiniteNumber)
        .filter((value) => value !== null);
      const parsed = parsedValues.find((value) => value > 0) ?? parsedValues[0] ?? null;
      if (parsed !== null) return { value: Math.max(0, parsed), source: 'firebird' };
      if (fallbackValue > 0) return { value: fallbackValue, source: 'manual_estimate' };
      return { value: 0, source: 'missing' };
    }

    // Valor dos orçamentos avulsos parados (aguardando aprovação do cliente)
    let stalledEstimatesValue = 0;
    const stalledValueSources = { firebird: 0, manual_estimate: 0, missing: 0 };
    for (const o of aguardando) {
      const resolved = resolveServiceOrderValue(o.payload, manualServiceFallback);
      stalledEstimatesValue += resolved.value;
      stalledValueSources[resolved.source] += 1;
    }

    // ───────────────────────────────────────────────────────────────
    // VAZAMENTO DO FUNIL (Perda Estimada)
    // ───────────────────────────────────────────────────────────────
    const vazamento = classified.filter(o =>
      (o.status === 'PENDENTE' || o.status === 'EM_ATENDIMENTO' || o.status === 'AGUARDANDO_RETORNO') &&
      o.openedAt && o.openedAt < thirtyDaysAgo
    );
    const vazamentoMes = vazamento.length;
    let vazamentoValor = 0;
    let vazamentoSemValorCount = 0;
    let vazamentoFallbackValueCount = 0;
    const leakageValueSources = { firebird: 0, manual_estimate: 0, missing: 0 };
    for (const o of vazamento) {
      const resolved = resolveServiceOrderValue(o.payload, manualServiceFallback);
      leakageValueSources[resolved.source] += 1;
      if (resolved.source === 'missing') vazamentoSemValorCount++;
      if (resolved.source === 'manual_estimate') vazamentoFallbackValueCount++;
      vazamentoValor += resolved.value;
    }

    // Taxa de resolução real: das O.S. abertas nos últimos 30 dias, quantas já foram finalizadas
    const openedLast30d = classified.filter(o => o.openedAt && o.openedAt >= thirtyDaysAgo);
    const resolutionRatePct = openedLast30d.length > 0
      ? Math.round((finalizadas30d.length / openedLast30d.length) * 1000) / 10
      : null;

    // Soma que a "Receita em Risco Hoje" de fato representa: MRR sob quebra de
    // SLA + valor dos orçamentos avulsos parados aguardando aprovação.
    const receitaEmRiscoHoje = mrrInRisk + stalledEstimatesValue;

    // ───────────────────────────────────────────────────────────────
    // TENDÊNCIA — grava a foto do dia e compara com a última anterior
    // registrada, já que o Firebird só reflete o estado atual (sem histórico).
    // ───────────────────────────────────────────────────────────────
    let trend = null;
    try {
      const todayDateOnly = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
      await prisma.revenueSnapshot.upsert({
        where: { tenantId_snapshotDate: { tenantId, snapshotDate: todayDateOnly } },
        update: { mrrInRisk, vazamentoValor, stalledCount: aguardando.length, avgOpenHours: averageOpenTimeHours },
        create: { tenantId, snapshotDate: todayDateOnly, mrrInRisk, vazamentoValor, stalledCount: aguardando.length, avgOpenHours: averageOpenTimeHours },
      });
      const previousSnapshot = await prisma.revenueSnapshot.findFirst({
        where: { tenantId, snapshotDate: { lt: todayDateOnly } },
        orderBy: { snapshotDate: 'desc' },
      });
      if (previousSnapshot) {
        trend = {
          previousDate: previousSnapshot.snapshotDate,
          mrrInRiskDelta: mrrInRisk - previousSnapshot.mrrInRisk,
          vazamentoValorDelta: vazamentoValor - previousSnapshot.vazamentoValor,
          avgOpenHoursDelta: averageOpenTimeHours - previousSnapshot.avgOpenHours,
          stalledCountDelta: aguardando.length - previousSnapshot.stalledCount,
        };
      }
    } catch (trendErr) {
      console.error('[revenueController] Falha ao calcular tendência do Sentinela:', trendErr);
    }

    const telemetry = await telemetryPromise;

    res.json({
      receitaEmRiscoHoje,
      mrrInRisk,
      mrrRiskBands,
      averageOpenTimeHours,
      rankingClientsAtRisk,
      stalledEstimatesCount: aguardando.length,
      stalledEstimatesValue,
      trend,
      synchronization,
      telemetry,
      dataQuality: {
        mrr: {
          valueSources: mrrValueSources,
          manualFallbackConfigured: manualContractFallback > 0,
          manualFallbackValue: manualContractFallback,
        },
        stalledEstimates: {
          valueSources: stalledValueSources,
          manualFallbackConfigured: manualServiceFallback > 0,
          manualFallbackValue: manualServiceFallback,
        },
        leakage: {
          valueSources: leakageValueSources,
          manualFallbackConfigured: manualServiceFallback > 0,
          manualFallbackValue: manualServiceFallback,
        },
      },
      kpis: {
        kpiSlaLimitHours,
        kpiReincidentThreshold: reincidentThreshold,
        kpiContractValue: manualContractFallback,
        kpiServiceValue: manualServiceFallback,
      },
      causas: [
        { id: '1', descricao: 'Chamados pendentes sem técnico designado', quantidade: noTechnicianCount, prioridade: 'alta' },
        { id: '2', descricao: 'Orçamentos de peças/serviço aguardando aprovação', quantidade: aguardando.length, prioridade: 'media' },
        { id: '3', descricao: `Equipamentos reincidentes com falhas recorrentes (> ${reincidentThreshold} OS/mês)`, quantidade: reincidentEquipmentsCount, prioridade: 'alta' },
        { id: '4', descricao: 'Chamados com avaliações ruins dos clientes (CSAT ≤ 2)', quantidade: badCsatCount, prioridade: 'alta' }
      ],
      funnel: {
        novosChamados: pendentes.length,
        emAtendimento: emAtendimento.length,
        aguardandoCliente: aguardando.length,
        finalizadosMes: finalizadas30d.length,
        osOpenedLast30d: openedLast30d.length,
        resolutionRatePct,
        vazamentoMes,
        vazamentoValor,
        vazamentoSemValorCount,
        vazamentoFallbackValueCount,
      }
    });
  } catch (error) {
    console.error('[revenueController] Erro ao obter dados de receita:', error);
    res.status(500).json({ error: 'Erro interno ao processar indicadores de receita.' });
  }
}

async function getBenchmark(req, res) {
  const tenantId = req.user.tenantId;
  try {
    // Janela de período: por padrão últimos 90 dias (evita diluir sinal recente
    // com histórico antigo/técnicos que já saíram); ?days=all remove o filtro.
    const daysParam = req.query.days;
    const periodDays = daysParam === 'all' ? null : (parseInt(daysParam) || 90);
    const periodStart = periodDays ? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000) : null;

    const rawRecords = await prisma.externalSyncRecord.findMany({
      where: { tenantId, entity: 'serviceOrders' }
    });

    const ticketsWhere = { tenantId, rating: { not: null } };
    if (periodStart) ticketsWhere.resolvedAt = { gte: periodStart };
    const tickets = await prisma.ticket.findMany({
      where: ticketsWhere,
      select: { id: true, contactId: true, agentId: true, rating: true, contact: { select: { externalId: true } } }
    });

    function fbStatus(payload) {
      const raw = payload?.raw || payload || {};
      const status = String(raw.status || raw.nmstatus || payload?.status || '').trim().toUpperCase();
      const closedAt = raw.dtfechamento || payload?.closedAt;
      if (closedAt || ['O', 'F', 'C', 'FINALIZADA', 'CONCLUIDA'].includes(status)) return 'FINALIZADA';
      if (status.includes('AGUARD')) return 'AGUARDANDO_RETORNO';
      if (status.includes('ATEND') || ['E', 'M', 'T'].includes(status)) return 'EM_ATENDIMENTO';
      return 'PENDENTE';
    }

    function fbDate(payload, ...keys) {
      const raw = payload?.raw || payload || {};
      for (const key of keys) {
        const val = raw[key] || raw[key.toLowerCase()] || raw[key.toUpperCase()] || payload?.[key];
        if (val) { const d = new Date(val); if (!Number.isNaN(d.getTime())) return d; }
      }
      return null;
    }

    const classified = rawRecords.map(r => {
      const p = r.payload || {};
      const status = fbStatus(p);
      const openedAt = fbDate(p, 'dtinclusao', 'createdAt', 'updatedAt');
      const closedAt = fbDate(p, 'dtfechamento', 'closedAt');
      const raw = p.raw || p;
      return {
        externalId: r.externalId,
        clientExternalId: String(raw.cdcliente || p.clientExternalId || ''),
        clientName: String(raw.nmcliente || p.clientName || 'Cliente Desconhecido'),
        technicianName: String(raw.nmsuportet || raw.nmsuportel || p.technician || 'Sem Técnico'),
        status,
        openedAt,
        closedAt
      };
    }).filter(o => o.openedAt && (!periodStart || o.openedAt >= periodStart));

    // Quais clientExternalId têm de fato um contato de WhatsApp vinculado —
    // sem isso o CSAT nunca vai casar, mesmo que existam avaliações no sistema.
    const clientExtIdsInPeriod = [...new Set(classified.map(o => o.clientExternalId).filter(Boolean))];
    const linkedContacts = clientExtIdsInPeriod.length > 0
      ? await prisma.contact.findMany({
          where: { tenantId, externalId: { in: clientExtIdsInPeriod } },
          select: { externalId: true }
        })
      : [];
    const linkedExternalIds = new Set(linkedContacts.map(c => c.externalId));

    // Agrupar por Cliente
    const clientMap = {};
    for (const o of classified) {
      if (!o.clientName) continue;
      if (!clientMap[o.clientName]) {
        clientMap[o.clientName] = { nome: o.clientName, osCount: 0, finalizadas: [], clientExternalId: o.clientExternalId };
      }
      clientMap[o.clientName].osCount++;
      if (o.status === 'FINALIZADA' && o.closedAt) {
        clientMap[o.clientName].finalizadas.push(o);
      }
    }

    const clientBenchmark = Object.values(clientMap).map(c => {
      let avgSla = null;
      if (c.finalizadas.length > 0) {
        const totalSla = c.finalizadas.reduce((sum, so) => {
          const diffMs = so.closedAt.getTime() - so.openedAt.getTime();
          return sum + (diffMs / (1000 * 60 * 60)); // horas
        }, 0);
        avgSla = Math.round((totalSla / c.finalizadas.length) * 10) / 10;
      }
      
      // CSAT
      const clientTickets = tickets.filter(t => t.contact?.externalId === c.clientExternalId);
      let avgCsat = null;
      if (clientTickets.length > 0) {
        const totalCsat = clientTickets.reduce((sum, t) => sum + t.rating, 0);
        avgCsat = Math.round((totalCsat / clientTickets.length) * 10) / 10;
      }

      return {
        id: c.clientExternalId || c.nome,
        nome: c.nome,
        osCount: c.osCount,
        avgSla,
        avgCsat,
        csatSampleSize: clientTickets.length,
        csatLinked: linkedExternalIds.has(c.clientExternalId)
      };
    }).sort((a, b) => b.osCount - a.osCount).slice(0, 10);

    // Agrupar por Atendente
    const agentMap = {};
    for (const o of classified) {
      if (!o.technicianName || o.technicianName === 'Sem Técnico') continue;
      if (!agentMap[o.technicianName]) {
        agentMap[o.technicianName] = { nome: o.technicianName, osCount: 0, finalizadas: [] };
      }
      agentMap[o.technicianName].osCount++;
      if (o.status === 'FINALIZADA' && o.closedAt) {
        agentMap[o.technicianName].finalizadas.push(o);
      }
    }

    // Para CSAT do atendente local, precisariamos mapear o usuario logado, mas como o firebird só tem NOME_TECNICO, 
    // vamos tentar cruzar pelo nome.
    const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true } });

    const agentBenchmark = Object.values(agentMap).map(a => {
      let avgSla = null;
      if (a.finalizadas.length > 0) {
        const totalSla = a.finalizadas.reduce((sum, so) => {
          const diffMs = so.closedAt.getTime() - so.openedAt.getTime();
          return sum + (diffMs / (1000 * 60 * 60));
        }, 0);
        avgSla = Math.round((totalSla / a.finalizadas.length) * 10) / 10;
      }

      // Tenta achar o atendente local para pegar o CSAT (o Firebird só tem o
      // técnico de campo por nome — se não bater exatamente com o usuário do
      // sistema, o CSAT fica indisponível mesmo que existam avaliações).
      const localUser = users.find(u => u.name.toLowerCase() === a.nome.toLowerCase());
      let avgCsat = null;
      let csatSampleSize = 0;
      if (localUser) {
        const agentTickets = tickets.filter(t => t.agentId === localUser.id);
        csatSampleSize = agentTickets.length;
        if (agentTickets.length > 0) {
          const totalCsat = agentTickets.reduce((sum, t) => sum + t.rating, 0);
          avgCsat = Math.round((totalCsat / agentTickets.length) * 10) / 10;
        }
      }

      return {
        id: a.nome,
        nome: a.nome,
        osCount: a.osCount,
        avgSla,
        avgCsat,
        csatSampleSize,
        // false = não achamos usuário do sistema com esse nome (o CSAT é
        // estruturalmente indisponível, não é "sem avaliações")
        matched: Boolean(localUser)
      };
    }).sort((a, b) => b.osCount - a.osCount);

    res.json({
      clientes: clientBenchmark,
      atendentes: agentBenchmark,
      periodDays,
      // CSAT do atendente vem do canal de atendimento (ticket WhatsApp), que
      // pode ser conduzido por pessoa diferente do técnico que foi a campo.
      note: 'O CSAT de "Performance de Atendentes" reflete o canal de atendimento (WhatsApp), não necessariamente quem executou a visita técnica.'
    });
  } catch (error) {
    console.error('[revenueController] Erro ao obter benchmark:', error);
    res.status(500).json({ error: 'Erro interno ao processar benchmark.' });
  }
}

async function getDetective(req, res) {
  const tenantId = req.user.tenantId;

  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId }
    });

    const kpiSlaLimitHours = settings?.kpiSlaLimitHours ?? 24;

    // Datas limites
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // 1. Métricas da Semana Atual (últimos 7 dias)
    const currentTickets = await prisma.ticket.count({
      where: { tenantId, createdAt: { gte: sevenDaysAgo } }
    });
    const currentOS = await prisma.serviceOrder.count({
      where: { tenantId, createdAt: { gte: sevenDaysAgo } }
    });

    // O.S. fora do SLA na semana atual (aberta nos últimos 7 dias E já além
    // do limite de SLA). Antes havia duas chaves `createdAt` no mesmo objeto
    // — a segunda sobrescrevia a primeira em JS e o filtro de 7 dias era
    // descartado silenciosamente; corrigido combinando gte+lte numa só chave.
    const slaLimitDateCurrent = new Date(now.getTime() - kpiSlaLimitHours * 60 * 60 * 1000);
    const currentOverdueOS = await prisma.serviceOrder.count({
      where: {
        tenantId,
        status: { in: ['PENDENTE', 'EM_ATENDIMENTO'] },
        createdAt: { gte: sevenDaysAgo, lte: slaLimitDateCurrent }
      }
    });

    const currentCsatList = await prisma.ticket.findMany({
      where: { tenantId, rating: { not: null }, resolvedAt: { gte: sevenDaysAgo } },
      select: { rating: true }
    });
    const currentCsat = currentCsatList.length > 0 
      ? Math.round((currentCsatList.reduce((sum, t) => sum + t.rating, 0) / currentCsatList.length) * 10) / 10 
      : 0;

    // 2. Métricas da Semana Anterior (7 a 14 dias atrás)
    const prevTickets = await prisma.ticket.count({
      where: { tenantId, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } }
    });
    const prevOS = await prisma.serviceOrder.count({
      where: { tenantId, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } }
    });

    const slaLimitDatePrev = new Date(sevenDaysAgo.getTime() - kpiSlaLimitHours * 60 * 60 * 1000);
    const prevOverdueOS = await prisma.serviceOrder.count({
      where: {
        tenantId,
        status: { in: ['PENDENTE', 'EM_ATENDIMENTO'] },
        createdAt: { gte: fourteenDaysAgo, lte: slaLimitDatePrev }
      }
    });

    const prevCsatList = await prisma.ticket.findMany({
      where: { tenantId, rating: { not: null }, resolvedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      select: { rating: true }
    });
    const prevCsat = prevCsatList.length > 0 
      ? Math.round((prevCsatList.reduce((sum, t) => sum + t.rating, 0) / prevCsatList.length) * 10) / 10 
      : 0;

    // Montar o comparativo
    const stats = {
      atual: { tickets: currentTickets, os: currentOS, overdue: currentOverdueOS, csat: currentCsat },
      anterior: { tickets: prevTickets, os: prevOS, overdue: prevOverdueOS, csat: prevCsat }
    };

    let aiDiagnosis = '';

    if (!aiService.hasConfiguredProvider(settings)) {
      aiDiagnosis = '**Provedor de IA não configurado.** Vá em Ajustes para selecionar e testar Gemini, OpenAI ou Claude.';
    } else {
      try {
        const prompt = `Você é o Detetive IA do iLux Sentinela, um analista operacional de suporte e inteligência de receita especialista em locação de impressoras.
        Analise o relatório operacional abaixo de duas semanas consecutivas da empresa e escreva um diagnóstico operacional conciso (em português, formato de parágrafos corridos, use negrito nas métricas chaves para dar impacto).
        Explique as possíveis causas dos desvios (ex: por que o SLA aumentou, impacto nas rescisões de contrato) e sugira 2 ações corretivas imediatas.
        NÃO retorne tópicos, marcadores (bullets) ou cabeçalhos. Apenas texto fluido e profissional em 2 a 3 parágrafos.

        Dados Operacionais (Semana Atual vs. Semana Anterior):
        - Novos Chamados Iniciados: ${currentTickets} vs ${prevTickets}
        - Novas Ordens de Serviço (O.S.): ${currentOS} vs ${prevOS}
        - O.S. ativas estouradas fora do SLA (${kpiSlaLimitHours}h+): ${currentOverdueOS} vs ${prevOverdueOS}
        - Índice Médio de Satisfação (CSAT): ${currentCsat}/5 vs ${prevCsat}/5

        Diagnóstico:`;

        aiDiagnosis = await generateText(settings, prompt, {
          profile: 'chat',
          maxOutputTokens: 1400,
        });
      } catch (err) {
        console.error('[revenueController] Falha ao gerar diagnóstico com Gemini:', err);
        aiDiagnosis = `**Erro na análise por IA:** ${err.message}. Mas você pode acompanhar as variações dos números no painel acima.`;
      }
    }

    res.json({
      stats,
      diagnosis: aiDiagnosis,
      // As O.S. aqui vêm do módulo interno (prisma.serviceOrder), não do
      // Firebird usado no Centro de Crise/Benchmark — os totais não são
      // diretamente comparáveis entre as abas.
      dataSourceNote: 'Os números de "O.S." nesta aba vêm dos registros internos do sistema, e não do ERP Firebird usado no Centro de Crise e no Benchmark — os totais podem não bater entre as abas.'
    });
  } catch (error) {
    console.error('[revenueController] Erro no Detetive IA:', error);
    res.status(500).json({ error: 'Erro ao processar dados do Detetive IA.' });
  }
}

async function getAuditedTickets(req, res) {
  const tenantId = req.user.tenantId;
  try {
    const [totalResolvedCount, auditedTickets] = await Promise.all([
      prisma.ticket.count({ where: { tenantId, status: 'resolved' } }),
      prisma.ticket.findMany({
        where: { tenantId, status: 'resolved', auditScore: { not: null } },
        select: { auditScore: true }
      })
    ]);
    const totalAuditedCount = auditedTickets.length;
    const avgAuditScore = totalAuditedCount > 0
      ? Math.round(auditedTickets.reduce((sum, t) => sum + t.auditScore, 0) / totalAuditedCount)
      : null;
    const scoreDistribution = { baixo: 0, medio: 0, alto: 0 }; // <60 / 60-84 / 85+
    for (const t of auditedTickets) {
      if (t.auditScore >= 85) scoreDistribution.alto++;
      else if (t.auditScore >= 60) scoreDistribution.medio++;
      else scoreDistribution.baixo++;
    }

    const tickets = await prisma.ticket.findMany({
      where: {
        tenantId,
        status: 'resolved'
      },
      select: {
        id: true,
        rating: true,
        ratingFeedback: true,
        auditScore: true,
        auditResult: true,
        auditedAt: true,
        createdAt: true,
        resolvedAt: true,
        contact: { select: { name: true, phone: true } },
        agent: { select: { name: true } }
      },
      orderBy: { resolvedAt: 'desc' },
      take: 50
    });

    const formatted = tickets.map(t => ({
      id: t.id,
      contactName: t.contact?.name || t.contact?.phone || 'Cliente',
      agentName: t.agent?.name || 'IA/Sistema',
      rating: t.rating,
      auditScore: t.auditScore,
      auditResult: t.auditResult,
      auditedAt: t.auditedAt,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt
    }));

    res.json({
      tickets: formatted,
      summary: {
        totalResolvedCount,
        totalAuditedCount,
        avgAuditScore,
        scoreDistribution
      }
    });
  } catch (error) {
    console.error('[revenueController] Erro ao buscar atendimentos auditados:', error);
    res.status(500).json({ error: 'Erro ao buscar atendimentos para auditoria.' });
  }
}

async function auditTicket(req, res) {
  const { ticketId } = req.params;
  const tenantId = req.user.tenantId;

  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId }
    });

    if (!aiService.hasConfiguredProvider(settings)) {
      return res.status(400).json({ error: 'Provedor de IA não configurado em Ajustes.' });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      include: {
        contact: true,
        agent: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado.' });
    }

    if (ticket.messages.length === 0) {
      return res.status(400).json({ error: 'Este atendimento não possui mensagens gravadas para serem auditadas.' });
    }

    // Formatar histórico de mensagens
    const historyText = ticket.messages.map(m => {
      const sender = m.fromBot ? 'IA/Sistema' : (m.fromMe ? (ticket.agent?.name || 'Atendente') : 'Cliente');
      const text = m.body || (m.transcription ? `[Áudio Transcrito: ${m.transcription}]` : '[Mídia/Outro]');
      return `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${sender}: ${text}`;
    }).join('\n');

    const prompt = `Você é um auditor de qualidade de atendimento ao cliente por inteligência artificial (QA Analyst).
    Analise a conversa abaixo que ocorreu entre o cliente, a IA/Sistema (robô) e o atendente humano da empresa. Atribua uma nota de 0 a 100 de conformidade geral e elabore um parecer detalhado.

    A sua avaliação deve analisar rigorosamente os seguintes critérios:
    1. **Interação da IA (Robô)**: Se a IA/Sistema respondeu com cordialidade, precisão e de acordo com as informações da empresa.
    2. **Atendimento Humano**: A empatia, o tom de voz e a educação do atendente humano ao falar com o cliente.
    3. **Passagem de Bastão (Transição IA ➔ Humano)**: Avalie se o atendente humano leu o histórico do robô antes de interagir. É considerado um erro grave o atendente fazer perguntas repetidas que o cliente já havia respondido para o robô. A transição deve ser fluida e sem atrito.
    4. **Resolução e Processo**: Se o problema do cliente foi de fato solucionado, se os prazos informados foram corretos e se as diretrizes da empresa foram seguidas.

    Retorne estritamente um JSON contendo as chaves:
    1. "score": número inteiro de 0 a 100.
    2. "report": texto formatado em Markdown descrevendo a análise detalhada de cada critério acima, destacando os "Pontos Fortes", as "Oportunidades de Melhoria" (especialmente em relação à transição IA/Humano e perguntas repetitivas) e um curto "Veredito Final".

    Conversa:
    ${historyText}

    JSON de retorno:`;

    let responseText = await generateText(settings, prompt, {
      profile: 'chat',
      maxOutputTokens: 2400,
      json: true,
    });

    // Limpar tag ```json se houver
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    const parsed = JSON.parse(responseText);

    const updatedTicket = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        auditScore: parseInt(parsed.score),
        auditResult: parsed.report,
        auditedAt: new Date()
      }
    });

    res.json({
      id: updatedTicket.id,
      auditScore: updatedTicket.auditScore,
      auditResult: updatedTicket.auditResult,
      auditedAt: updatedTicket.auditedAt
    });
  } catch (error) {
    console.error('[revenueController] Erro ao auditar ticket:', error);
    res.status(500).json({ error: `Falha na auditoria por IA: ${error.message}` });
  }
}

async function getDrilldown(req, res) {
  const tenantId = req.user.tenantId;
  const { type } = req.params;

  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const kpiSlaLimitHours = settings?.kpiSlaLimitHours ?? 24;
    const reincidentThreshold = settings?.kpiReincidentThreshold ?? 2;
    const slaLimitDate = new Date(Date.now() - kpiSlaLimitHours * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Carregar O.S. reais do Firebird
    const allFirebirdOS = await prisma.externalSyncRecord.findMany({
      where: { tenantId, source: 'firebird', entity: 'serviceOrders' },
      select: { externalId: true, payload: true, receivedAt: true },
    });

    function fbStatus(payload) {
      const raw = payload?.raw || payload || {};
      const status = String(raw.status || raw.nmstatus || payload?.status || '').trim().toUpperCase();
      const closedAt = raw.dtfechamento || payload?.closedAt;
      if (closedAt || ['O', 'F', 'C', 'FINALIZADA', 'CONCLUIDA'].includes(status)) return 'FINALIZADA';
      if (status.includes('AGUARD')) return 'AGUARDANDO_RETORNO';
      if (status.includes('ATEND') || ['E', 'M', 'T'].includes(status)) return 'EM_ATENDIMENTO';
      return 'PENDENTE';
    }

    function fbDate(payload, ...keys) {
      const raw = payload?.raw || payload || {};
      for (const key of keys) {
        const val = raw[key] || raw[key.toLowerCase()] || raw[key.toUpperCase()] || payload?.[key];
        if (val) { const d = new Date(val); if (!Number.isNaN(d.getTime())) return d; }
      }
      return null;
    }

    const classified = allFirebirdOS.map(r => {
      const p = r.payload || {};
      const raw = p.raw || p;
      return {
        externalId: r.externalId,
        status: fbStatus(p),
        openedAt: fbDate(p, 'dtinclusao', 'createdAt', 'updatedAt'),
        closedAt: fbDate(p, 'dtfechamento', 'closedAt'),
        clientExternalId: String(raw.cdcliente || p.clientExternalId || ''),
        clientName: String(raw.nmcliente || p.clientName || ''),
        technician: raw.nmsuportet || raw.nmsuportel || p.technician || '',
        equipmentId: String(raw.cdequipamento || p.equipmentExternalId || ''),
        equipmentModel: String(raw.modelo || p.equipmentModel || ''),
        osType: String(raw.nmostp || p.osType || ''),
        defect: String(raw.obsdefeitocli || p.defect || ''),
      };
    });

    // Buscar nomes de clientes do CRM para complementar
    const allClientIds = [...new Set(classified.map(o => o.clientExternalId).filter(Boolean))];
    const crmCustomers = allClientIds.length > 0
      ? await prisma.crmCustomer.findMany({
          where: { tenantId, externalId: { in: allClientIds } },
          select: { externalId: true, name: true, fantasyName: true, phone: true },
        })
      : [];
    const customerMap = Object.fromEntries(crmCustomers.map(c => [c.externalId, c]));

    function enrich(item) {
      const cust = customerMap[item.clientExternalId];
      return {
        externalId: item.externalId,
        status: item.status,
        openedAt: item.openedAt,
        clientName: cust?.fantasyName || cust?.name || item.clientName || 'Cliente #' + item.clientExternalId,
        clientPhone: cust?.phone || '',
        technician: item.technician,
        equipmentModel: item.equipmentModel,
        osType: item.osType,
        defect: item.defect,
      };
    }

    let results = [];

    if (type === 'mrr_risk') {
      results = classified
        .filter(o => (o.status === 'PENDENTE' || o.status === 'EM_ATENDIMENTO') && o.openedAt && o.openedAt <= slaLimitDate)
        .map(enrich);
    } else if (type === 'stalled_estimates') {
      results = classified
        .filter(o => o.status === 'AGUARDANDO_RETORNO')
        .map(enrich);
    } else if (type === 'no_technician') {
      results = classified
        .filter(o => o.status === 'PENDENTE' && !o.technician)
        .map(enrich);
    } else if (type === 'bad_csat') {
      // CSAT vem dos tickets do WhatsApp (tabela local)
      const tickets = await prisma.ticket.findMany({
        where: { tenantId, rating: { not: null, lte: 2 }, resolvedAt: { gte: thirtyDaysAgo } },
        include: { contact: { select: { id: true, name: true, phone: true } } },
        orderBy: { resolvedAt: 'desc' }
      });
      results = tickets.map(t => ({
        externalId: t.id,
        status: 'CSAT ≤ 2',
        openedAt: t.resolvedAt,
        clientName: t.contact?.name || 'Desconhecido',
        clientPhone: t.contact?.phone || '',
        rating: t.rating,
      }));
    } else if (type === 'reincident_equipments') {
      const equipCounts = {};
      for (const o of classified) {
        if (o.openedAt && o.openedAt >= thirtyDaysAgo && o.equipmentId) {
          if (!equipCounts[o.equipmentId]) equipCounts[o.equipmentId] = { count: 0, model: o.equipmentModel, clientName: '', items: [] };
          equipCounts[o.equipmentId].count++;
          equipCounts[o.equipmentId].items.push(o);
          const cust = customerMap[o.clientExternalId];
          if (cust) equipCounts[o.equipmentId].clientName = cust.fantasyName || cust.name || '';
        }
      }
      results = Object.entries(equipCounts)
        .filter(([, v]) => v.count > reincidentThreshold)
        .map(([equipId, v]) => ({
          externalId: equipId,
          equipmentModel: v.model,
          clientName: v.clientName,
          count: v.count,
        }));
    }

    res.json(results);
  } catch (error) {
    console.error('[revenueController] Erro no getDrilldown:', error);
    res.status(500).json({ error: 'Erro ao buscar dados detalhados' });
  }
}

module.exports = { 
  getRevenueDashboard, 
  getBenchmark, 
  getDetective, 
  getAuditedTickets, 
  auditTicket,
  getDrilldown
};
