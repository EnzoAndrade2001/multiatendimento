// Demonstrativo de faturamento re-renderizado pelo CRM (Fase 2 "faturamento sem
// a pasta"). Modelado no "Quadro Resumo - Producao por Contrato/Cliente" do iLux
// (MODELO_DEMO_CAPA = 1). Todos os numeros vem fechados de CrmBillingStatement /
// CrmBillingStatementLine -- este arquivo NAO recalcula franquia nem excedente,
// so agrupa e formata.

const ACCENT_DEFAULT = '#D62828';

function normalizeAccent(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toUpperCase() : ACCENT_DEFAULT;
}

function accentTextColor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#111111' : '#FFFFFF';
}

const money = (value) => {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const intBr = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '';
};

function formatDateBr(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function periodLabel(line) {
  const start = formatDateBr(line.periodStart);
  const end = formatDateBr(line.periodEnd);
  if (start && end) return `${start} a ${end}`;
  return start || end || '';
}

// Valor efetivamente cobrado na linha: franquia + excedente COBRADOS (as colunas
// *COB do iLux, que somadas reconciliam com o header). invoiceValue entra so
// quando as duas estao zeradas mas ha VALFATURA -- caso raro de contrato fixo
// lancado direto na linha.
function lineValue(line) {
  const charged = Number(line.franchiseCharged || 0) + Number(line.excessCharged || 0);
  if (charged === 0 && Number(line.invoiceValue || 0) > 0) return Number(line.invoiceValue);
  return charged;
}

function companyLines(company = {}) {
  const parts = [];
  if (company.name || company.tradeName) parts.push({ text: String(company.tradeName || company.name).toUpperCase(), bold: true });
  const idBits = [];
  if (company.cnpj) idBits.push(`CNPJ: ${company.cnpj}`);
  if (company.stateRegistration) idBits.push(`IE: ${company.stateRegistration}`);
  if (idBits.length) parts.push({ text: idBits.join('   ') });
  const addr = [company.addressFull || company.address, company.neighborhood].filter(Boolean).join(' - ');
  const cityLine = [company.city, company.state].filter(Boolean).join('/');
  const addrLine = [addr, cityLine, company.zipCode && `CEP ${company.zipCode}`].filter(Boolean).join(' - ');
  if (addrLine) parts.push({ text: addrLine });
  if (company.phone) parts.push({ text: `Tel: ${company.phone}` });
  return parts.length ? parts : [{ text: 'Empresa', bold: true }];
}

function customerLines(customer = {}) {
  const parts = [{ text: String(customer.name || 'Cliente').toUpperCase(), bold: true }];
  const idBits = [];
  if (customer.code) idBits.push(`Cod. ${customer.code}`);
  if (customer.document) idBits.push(`CNPJ/CPF: ${customer.document}`);
  if (idBits.length) parts.push({ text: idBits.join('   ') });
  const addr = [customer.address, customer.neighborhood].filter(Boolean).join(' - ');
  const cityLine = [customer.city, customer.state].filter(Boolean).join('/');
  const addrLine = [addr, cityLine, customer.zipCode && `CEP ${customer.zipCode}`].filter(Boolean).join(' - ');
  if (addrLine) parts.push({ text: addrLine });
  return parts;
}

/**
 * @param {object} model
 * @param {object} model.statement  CrmBillingStatement (+ lines[])
 * @param {object} model.company    perfil da empresa (companyProfileService)
 * @param {object} model.customer   { name, code, document, address, ... }
 * @param {string} model.accentColor  #RRGGBB (osAccentColor do tenant)
 * @returns {object} docDefinition do pdfmake
 */
function buildStatementDocDefinition(model = {}) {
  const statement = model.statement || {};
  const lines = Array.isArray(statement.lines) ? statement.lines : [];
  const accent = normalizeAccent(model.accentColor);
  const accentText = accentTextColor(accent);

  const bandHeader = (text) => ({
    text,
    bold: true,
    fontSize: 8,
    color: accentText,
    fillColor: accent,
    margin: [4, 3, 4, 3],
  });

  const columns = ['Equipamento', 'Local / Depto', 'Medidor', 'Período faturado', 'Leit. inicial', 'Leit. final', 'Produção', 'Franquia', 'Exced.', 'Valor R$'];
  const widths = [92, 58, 30, 82, 40, 40, 36, 34, 34, 44];

  const headerRow = columns.map((text, i) => ({
    text,
    bold: true,
    fontSize: 6.5,
    color: accentText,
    fillColor: accent,
    alignment: i >= 4 ? 'right' : 'left',
    margin: [2, 3, 2, 3],
  }));

  const body = [headerRow];

  // Agrupa por contrato (SEQCONTRATO). Uma faixa leve por grupo.
  const groups = new Map();
  for (const line of lines) {
    const key = line.contractExternalId || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  if (lines.length === 0) {
    body.push([
      { text: 'Contrato com valor fixo — sem detalhamento de produção neste período.', colSpan: 9, fontSize: 7, italics: true, color: '#555555', margin: [2, 4, 2, 4] },
      {}, {}, {}, {}, {}, {}, {}, {},
      { text: money(statement.totalValue), fontSize: 7, alignment: 'right', bold: true, margin: [2, 4, 2, 4] },
    ]);
  } else {
    for (const [contractId, groupLines] of groups) {
      if (groups.size > 1) {
        body.push([
          {
            text: `Contrato nº ${contractId}`,
            colSpan: 10,
            bold: true,
            fontSize: 6.5,
            fillColor: '#EEEEEE',
            color: '#333333',
            margin: [2, 2, 2, 2],
          },
          {}, {}, {}, {}, {}, {}, {}, {}, {},
        ]);
      }
      for (const line of groupLines) {
        const equip = [line.equipmentName || line.equipmentModel || `Equip. ${line.equipmentExternalId || ''}`.trim()];
        const equipSub = [line.equipmentExternalId && `#${line.equipmentExternalId}`, line.equipmentSerial].filter(Boolean).join('  ');
        const local = [line.installLocation, line.department].filter(Boolean).join(' / ');
        const tags = [];
        if (line.isProrated) tags.push('proporcional');
        if (line.isExempt) tags.push('isento');
        if (line.isBonus) tags.push('bonificado');
        body.push([
          { text: [{ text: equip[0], fontSize: 6.5 }, equipSub ? { text: `\n${equipSub}`, fontSize: 5.5, color: '#777777' } : ''], margin: [2, 2, 2, 2] },
          { text: [local || '', tags.length ? `\n(${tags.join(', ')})` : ''].join(''), fontSize: 6, margin: [2, 2, 2, 2] },
          { text: line.meterCode || '', fontSize: 6, margin: [2, 2, 2, 2] },
          { text: periodLabel(line), fontSize: 6, margin: [2, 2, 2, 2] },
          { text: intBr(line.meterStart), fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
          { text: intBr(line.meterEnd), fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
          { text: intBr(line.qtyProduction), fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
          { text: intBr(line.qtyFranchise), fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
          { text: intBr(line.qtyExcess), fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
          { text: money(lineValue(line)), fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
        ]);
      }
    }
  }

  const totalsRows = [];
  const totalLine = (label, value, opts = {}) => ([
    { text: label, alignment: 'right', fontSize: opts.big ? 8 : 7, bold: Boolean(opts.big), margin: [2, 2, 6, 2] },
    { text: money(value), alignment: 'right', fontSize: opts.big ? 8 : 7, bold: true, margin: [2, 2, 2, 2], fillColor: opts.big ? accent : undefined, color: opts.big ? accentText : undefined },
  ]);
  // Reconciliacao validada em producao: VALDEMONSTRATIVO == VALDEMONSTRATIVOF +
  // VALDEMONSTRATIVOE (Σ das colunas *COB das linhas). VALDESCONTO/VALACRESCIMO
  // do header nao entram nessa conta -- sao tratados no boleto -- entao nao vao
  // no bloco de totais para nao sugerir uma subtracao que nao acontece aqui.
  totalsRows.push(totalLine('Valor fixo (franquias)', statement.fixedValue));
  totalsRows.push(totalLine('Excedentes', statement.excessValue));
  totalsRows.push(totalLine('TOTAL DO DEMONSTRATIVO', statement.totalValue, { big: true }));

  const content = [
    { text: 'DEMONSTRATIVO DE FATURAMENTO', style: 'title' },
    { text: statement.period ? `Período de referência: ${statement.period}` : '', style: 'subtitle' },
    { text: '', margin: [0, 0, 0, 6] },
    {
      table: {
        widths: ['*', '*', 150],
        body: [[
          { stack: companyLines(model.company), fontSize: 7 },
          { stack: customerLines(model.customer), fontSize: 7 },
          {
            stack: [
              statement.invoiceNumber ? { text: `NF: ${statement.invoiceNumber}`, fontSize: 7 } : '',
              { text: `Demonstrativo nº ${statement.externalId || ''}`, fontSize: 7 },
              statement.statementDate ? { text: `Emissão: ${formatDateBr(statement.statementDate)}`, fontSize: 7 } : '',
              statement.dueDate ? { text: `Vencimento: ${formatDateBr(statement.dueDate)}`, fontSize: 7, bold: true } : '',
            ].filter(Boolean),
          },
        ]],
      },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#999999', vLineColor: () => '#999999',
        paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
      },
      margin: [0, 0, 0, 8],
    },
    bandHeader('QUADRO RESUMO — PRODUÇÃO POR CONTRATO / CLIENTE'),
    {
      table: { headerRows: 1, widths, body, dontBreakRows: true },
      layout: {
        hLineWidth: (i) => (i === 0 || i === 1 ? 0.6 : 0.25),
        vLineWidth: () => 0.25,
        hLineColor: () => '#BBBBBB',
        vLineColor: () => accent,
      },
      margin: [0, 0, 0, 8],
    },
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 230,
          table: { widths: ['*', 80], body: totalsRows },
          layout: {
            hLineWidth: () => 0.4, vLineWidth: () => 0,
            hLineColor: () => '#CCCCCC',
            paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3,
          },
        },
      ],
    },
  ];

  if (statement.notes) {
    content.push({ text: '', margin: [0, 6, 0, 0] });
    content.push(bandHeader('OBSERVAÇÕES'));
    content.push({ text: String(statement.notes), fontSize: 7, margin: [2, 4, 2, 4] });
  }

  content.push({
    text: 'Documento gerado pelo CRM a partir dos valores fechados no iLux. Confira o boleto para o valor a pagar.',
    fontSize: 6, italics: true, color: '#888888', margin: [0, 14, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageMargins: [22, 26, 22, 30],
    info: { title: `Demonstrativo ${statement.externalId || ''}` },
    defaultStyle: { font: 'Roboto', fontSize: 7, color: '#111111' },
    styles: {
      title: { fontSize: 14, bold: true, alignment: 'center', color: '#111111' },
      subtitle: { fontSize: 8, alignment: 'center', color: '#555555' },
    },
    content,
  };
}

module.exports = { buildStatementDocDefinition, lineValue, normalizeAccent, accentTextColor };
