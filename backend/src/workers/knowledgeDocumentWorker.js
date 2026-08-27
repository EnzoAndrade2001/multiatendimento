const prisma = require('../lib/prisma');
const { processDocument } = require('../services/knowledgeDocumentService');

async function main() {
  const documentId = String(process.argv[2] || '').trim();
  if (!documentId) throw new Error('Identificador do documento ausente.');
  await processDocument(documentId);
}

main()
  .catch((error) => {
    console.error('[knowledge-document-worker] processamento encerrado:', error?.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
