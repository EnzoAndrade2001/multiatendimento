const { PrismaClient } = require('@prisma/client');
const readXlsxFile = require('read-excel-file/node');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();
const filePath = "C:\\Users\\diego\\Documents\\Relatório Equipamentos - Completo 2026.xls";

async function testImport() {
    console.log('--- Iniciando Teste de Importação ---');
    
    // 1. Pegar Tenant e Instância
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) {
        console.error('Erro: Nenhum tenant encontrado no banco.');
        return;
    }
    const tenantId = tenant.id;
    console.log('Tenant ID:', tenantId);

    // Verificar instâncias
    const insts = await prisma.waInstance.findMany({ where: { tenantId } });
    console.log('Instâncias encontradas:', insts.map(i => ({ id: i.id, status: i.status })));

    // Tentar encontrar instância conectada (simulando a lógica do controller)
    const inst = await prisma.waInstance.findFirst({ 
        where: { 
            tenantId, 
            status: { in: ['CONNECTED', 'connected', 'open'] } // Sendo flexível no teste
        } 
    });

    if (!inst) {
        console.error('Erro: Nenhuma instância conectada encontrada para este tenant.');
        return;
    }
    console.log('Usando Instância:', inst.id, 'Status:', inst.status);

    // 2. Ler Arquivo
    try {
        if (!/\.xlsx$/i.test(filePath)) throw new Error('Este script de teste aceita somente .xlsx.');
        const rawRows = await readXlsxFile(filePath);
        const headers = (rawRows[0] || []).map((value) => String(value ?? '').trim());
        const rows = rawRows.slice(1).map((values) => Object.fromEntries(
            values.map((value, index) => [headers[index], value]).filter(([header]) => header)
        ));
        console.log('Total de linhas na planilha:', rows.length);

        let importedContacts = 0;
        let importedEquipments = 0;

        for (const row of rows.slice(0, 5)) { // Testar apenas as primeiras 5 linhas
            const name = row['Nome'] || row['NOME'] || row['name'] || row['Cliente'] || row['Empresa'];
            let ddd = row['DDD'] || '';
            let phone = row['Telefone'] || row['TELEFONE'] || row['phone'] || row['celular'] || row['Fone'] || row['FONE'];
            
            if (ddd && phone && !String(phone).startsWith(String(ddd))) {
                phone = String(ddd) + String(phone);
            }

            if (!phone) {
                console.warn('Linha sem telefone ignorada:', row);
                continue;
            }

            phone = String(phone).replace(/\D/g, '');
            console.log(`Processando: ${name} (${phone})`);

            // Upsert do Contato
            let contact = await prisma.contact.findFirst({ where: { tenantId, phone } });

            if (!contact) {
                contact = await prisma.contact.create({
                    data: {
                        tenantId,
                        instanceId: inst.id,
                        phone,
                        name: name || 'Cliente Importado',
                    }
                });
                importedContacts++;
            }

            // Equipamento
            const equipModel = row['Modelo'] || row['MODELO'] || row['Modelo Equipamento'] || row['Equipamento'] || row['Máquina'] || row['model'];
            const equipSerial = row['Serie'] || row['SERIE'] || row['Série'] || row['Número Série'] || row['serial'];
            const equipSector = row['Departamento'] || row['DEPARTAMENTO'] || row['Setor'] || row['sector'];

            if (equipModel || equipSerial) {
                await prisma.equipment.create({
                    data: {
                        tenantId,
                        contactId: contact.id,
                        model: String(equipModel || 'Desconhecido'),
                        serial: String(equipSerial || 'S/N'),
                        sector: String(equipSector || ''),
                    }
                });
                importedEquipments++;
            }
        }

        console.log(`--- Sucesso ---`);
        console.log(`Contatos novos: ${importedContacts}`);
        console.log(`Equipamentos cadastrados: ${importedEquipments}`);

    } catch (err) {
        console.error('Erro fatal durante a importação:', err);
    }
}

testImport().then(() => prisma.$disconnect());
