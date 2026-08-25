const prisma = require('../src/lib/prisma');
const {
  isImportedServiceOrderMirror,
  mergeImportedServiceOrderMirror,
} = require('../src/controllers/firebirdSyncController');

const apply = process.argv.includes('--apply');
const requestedSeq = process.argv
  .find((argument) => argument.startsWith('--seq='))
  ?.split('=')[1]
  ?.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function parseConflict(note) {
  const match = String(note || '').match(/SEQOS\s+(\d+).*\(id\s+([^)\s]+)\)/i);
  return match ? { seqOs: match[1], holderId: match[2] } : null;
}

async function main() {
  const candidates = await prisma.serviceOrder.findMany({
    where: {
      externalId: null,
      status: 'ERRO_INTEGRACAO',
      technicalNotes: { contains: 'ja pertence a outra O.S.' },
    },
    select: {
      id: true, tenantId: true, externalId: true, externalSource: true,
      requestKey: true, ticketId: true, userId: true, equipmentId: true,
      defect: true, technicalNotes: true, createdAt: true,
      contact: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const report = [];
  for (const pending of candidates) {
    const conflict = parseConflict(pending.technicalNotes);
    if (!conflict || (requestedSeq?.length && !requestedSeq.includes(conflict.seqOs))) continue;
    const holder = await prisma.serviceOrder.findFirst({
      where: { id: conflict.holderId, tenantId: pending.tenantId },
      select: {
        id: true, externalId: true, externalSource: true, requestKey: true,
        ticketId: true, userId: true, equipmentId: true, defect: true, createdAt: true,
      },
    });
    const safe = isImportedServiceOrderMirror(pending, holder, conflict.seqOs);
    report.push({
      seqOs: conflict.seqOs,
      client: pending.contact?.name || null,
      pendingId: pending.id,
      holderId: holder?.id || null,
      safe,
    });
    if (!apply || !safe) continue;

    await mergeImportedServiceOrderMirror(pending.tenantId, pending, holder, conflict.seqOs);
    await prisma.serviceOrder.update({
      where: { id: pending.id, tenantId: pending.tenantId },
      data: { technicalNotes: null },
    });
  }

  console.table(report);
  const unsafe = report.filter((item) => !item.safe);
  console.log(`${apply ? 'Aplicados' : 'Prontos para aplicar'}: ${report.length - unsafe.length}; bloqueados por seguranca: ${unsafe.length}.`);
  if (!apply) console.log('Previa somente. Execute novamente com --apply depois de validar a lista.');
  if (unsafe.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
