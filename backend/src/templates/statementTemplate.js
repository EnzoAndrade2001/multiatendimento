// Demonstrativo de faturamento re-renderizado pelo CRM (Fase 2 "faturamento sem
// a pasta"). Layout modelado no relatorio do iLux (A4 paisagem, tabela de
// medidores + "Quadro Resumo Contrato" + "Total Contrato"). Todos os numeros vem
// fechados de CrmBillingStatement / CrmBillingStatementLine -- este arquivo NAO
// recalcula franquia nem excedente, so agrupa e formata.

const ACCENT_DEFAULT = '#D62828';

function normalizeAccent(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toUpperCase() : ACCENT_DEFAULT;
}

function accentTextColor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#111111' : '#FFFFFF';
}

const nf = (value, dec) => {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};
const money = (value) => nf(value, 2);
const money4 = (value) => nf(value, 4);

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

// Valor efetivamente cobrado na linha: franquia + excedente COBRADOS (as colunas
// *COB do iLux, que somadas reconciliam com o header). invoiceValue entra so
// quando as duas estao zeradas mas ha VALFATURA.
function lineValue(line) {
  const charged = Number(line.franchiseCharged || 0) + Number(line.excessCharged || 0);
  if (charged === 0 && Number(line.invoiceValue || 0) > 0) return Number(line.invoiceValue);
  return charged;
}

function acrescDesc(line) {
  return Number(line.surchargeValue || 0) - Number(line.discountValue || 0);
}

// --- Tabela de medidores (13 colunas do iLux) -------------------------------
const DETAIL_COLS = [
  'Medidor', 'Data Leitura', 'Medidor Inicial', 'Medidor Final', 'Págs. Desc.',
  'Págs. Produzidas', 'Págs. Excedente', 'Franquia', 'Val.Franquia/Taxa Fixa',
  'Excedente/Produção(mil)', 'Val.Excedido/Produzido', 'Acresc/Desc', 'Valor Total ($)',
];
const DETAIL_WIDTHS = [38, 48, 47, 47, 36, 46, 46, 38, 62, 60, 62, 46, 64];

function detailHeaderRow(accent, accentText) {
  return DETAIL_COLS.map((text, i) => ({
    text, bold: true, fontSize: 5.4, color: accentText, fillColor: accent,
    alignment: i === 0 || i === 1 ? 'left' : 'right', margin: [2, 2, 2, 2],
  }));
}

function detailDataRow(line) {
  const ad = acrescDesc(line);
  const cell = (text, align = 'right') => ({ text, fontSize: 6, alignment: align, margin: [2, 2, 2, 2] });
  return [
    cell(line.meterCode || '', 'left'),
    cell(formatDateBr(line.readingDate), 'left'),
    cell(intBr(line.meterStart)),
    cell(intBr(line.meterEnd)),
    cell(intBr(line.meterDiscount)),
    cell(intBr(line.qtyProduction)),
    cell(intBr(line.qtyExcess)),
    cell(intBr(line.qtyFranchise)),
    cell(money(line.franchiseCharged)),
    cell(money4(line.excessValue)),
    cell(money4(line.excessCharged)),
    cell(ad ? money(ad) : ''),
    cell(money4(lineValue(line))),
  ];
}

// --- Quadro Resumo Contrato (9 colunas) ------------------------------------
const SUMMARY_COLS = [
  'Medidor', 'Págs. Desc.', 'Págs. Produzidas', 'Págs. Excedente', 'Franquia',
  'Val.Franquia/Taxa Fixa', 'Val.Excedido/Produzido', 'Acresc/Desc', 'Valor Total ($)',
];
const SUMMARY_WIDTHS = [60, 60, 78, 74, 56, 90, 90, 66, 92];

function summaryRow(line) {
  const ad = acrescDesc(line);
  const cell = (text, align = 'right') => ({ text, fontSize: 6, alignment: align, margin: [2, 2, 2, 2] });
  return [
    cell(line.meterCode || '', 'left'),
    cell(intBr(line.meterDiscount)),
    cell(intBr(line.qtyProduction)),
    cell(intBr(line.qtyExcess)),
    cell(intBr(line.qtyFranchise)),
    cell(money(line.franchiseCharged)),
    cell(money4(line.excessCharged)),
    cell(ad ? money(ad) : ''),
    cell(money4(lineValue(line))),
  ];
}

function contractTotals(groupLines) {
  return groupLines.reduce((acc, l) => ({
    franquia: acc.franquia + Number(l.qtyFranchise || 0),
    valFranquia: acc.valFranquia + Number(l.franchiseCharged || 0),
    valExcedido: acc.valExcedido + Number(l.excessCharged || 0),
    acrescDesc: acc.acrescDesc + acrescDesc(l),
    total: acc.total + lineValue(l),
  }), { franquia: 0, valFranquia: 0, valExcedido: 0, acrescDesc: 0, total: 0 });
}

function equipmentStrip(line) {
  const bits = [
    `Equipamento ${line.equipmentExternalId || ''}`.trim(),
    line.equipmentAsset ? `Patrimônio: ${line.equipmentAsset}` : 'Patrimônio:',
    line.equipmentName || line.equipmentModel ? `Produto: ${line.equipmentName || line.equipmentModel}` : 'Produto:',
    line.equipmentSerial ? `Série: ${line.equipmentSerial}` : 'Série:',
    line.department ? `Depto.: ${line.department}` : 'Depto.:',
    line.equipmentModel ? `Modelo: ${line.equipmentModel}` : 'Modelo:',
    line.installLocation ? `Local: ${line.installLocation}` : null,
  ].filter(Boolean);
  return { text: bits.join('     '), fontSize: 6, bold: true, margin: [1, 3, 1, 1] };
}

function headerBox(statement, customer, lines) {
  const c = customer || {};
  const firstLine = (lines && lines[0]) || {};
  const contractSeq = firstLine.contractExternalId || statement.contractGroupExternalId || '';
  const contractNr = firstLine.contractNumber || '';
  const addr = [c.address, c.number].filter(Boolean).join(', ');
  const rowStyle = { fontSize: 6.4, margin: [3, 2, 3, 2] };
  return {
    table: {
      widths: ['auto', 'auto', '*', 'auto'],
      body: [
        [
          { text: `Demost.: ${statement.externalId || ''}`, ...rowStyle, bold: true },
          { text: `Contrato (Seq / Nr): ${contractSeq}${contractNr ? ` / ${contractNr}` : ''}`, ...rowStyle },
          { text: `Cliente: ${c.code ? `${c.code} - ` : ''}${(c.name || '').toUpperCase()}`, ...rowStyle, bold: true },
          { text: `Vencimento: ${formatDateBr(statement.dueDate)}`, ...rowStyle },
        ],
        [
          { text: `CNPJ/CPF: ${c.document || '-'}`, ...rowStyle },
          { text: `Insc.Estadual: ${c.stateRegistration || '-'}`, ...rowStyle },
          { text: `Fone: ${c.phone || '-'}`, ...rowStyle },
          { text: `Emissão: ${formatDateBr(statement.statementDate)}`, ...rowStyle },
        ],
        [
          { text: `Endereço: ${addr || '-'}`, ...rowStyle },
          { text: `Bairro: ${c.neighborhood || '-'}`, ...rowStyle },
          { text: `CEP: ${c.zipCode || '-'}`, ...rowStyle },
          { text: `Cidade: ${[c.city, c.state].filter(Boolean).join('/') || '-'}`, ...rowStyle },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.6, vLineWidth: () => 0.6,
      hLineColor: () => '#666666', vLineColor: () => '#666666',
      paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
    },
    margin: [0, 0, 0, 6],
  };
}

/**
 * @param {object} model
 * @param {object} model.statement  CrmBillingStatement
 * @param {Array}  model.lines      linhas ja enriquecidas (contractNumber, equipmentAsset)
 * @param {object} model.company    perfil da empresa
 * @param {object} model.customer   { name, code, document, address, number, neighborhood, city, state, zipCode, phone, stateRegistration }
 * @param {string} model.accentColor #RRGGBB
 * @returns {object} docDefinition do pdfmake
 */
function buildStatementDocDefinition(model = {}) {
  const statement = model.statement || {};
  const lines = Array.isArray(model.lines) ? model.lines
    : Array.isArray(statement.lines) ? statement.lines : [];
  const accent = normalizeAccent(model.accentColor);
  const accentText = accentTextColor(accent);
  const company = model.company || {};

  const detailLayout = {
    hLineWidth: (i) => (i <= 1 ? 0.6 : 0.25),
    vLineWidth: () => 0.25,
    hLineColor: () => '#AAAAAA',
    vLineColor: () => '#CCCCCC',
    paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 0.5, paddingBottom: () => 0.5,
  };

  // Cabecalho tipo carta: empresa a esquerda, titulo no centro, meta a direita.
  const companyName = String(company.tradeName || company.name || 'Empresa').toUpperCase();
  const companyMeta = [
    company.cnpj && `CNPJ: ${company.cnpj}`,
    company.stateRegistration && `IE: ${company.stateRegistration}`,
  ].filter(Boolean).join('   ');
  const companyAddr = [
    [company.addressFull || company.address, company.number].filter(Boolean).join(', '),
    [company.city, company.state].filter(Boolean).join('/'),
    company.phone && `Fone: ${company.phone}`,
  ].filter(Boolean).join(' - ');

  const content = [
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: companyName, bold: true, fontSize: 8 },
            companyMeta ? { text: companyMeta, fontSize: 6 } : '',
            companyAddr ? { text: companyAddr, fontSize: 6 } : '',
          ].filter(Boolean),
        },
        {
          width: 'auto',
          stack: [
            { text: 'DEMONSTRATIVO DO FATURAMENTO', bold: true, fontSize: 13, alignment: 'center' },
            { text: statement.period ? `Período: ${statement.period}` : '', fontSize: 8, alignment: 'center', color: '#555555' },
          ],
        },
        {
          width: '*',
          stack: [
            { text: `Demonstrativo nº ${statement.externalId || ''}`, fontSize: 7, alignment: 'right' },
            statement.invoiceNumber ? { text: `NF: ${statement.invoiceNumber}`, fontSize: 7, alignment: 'right' } : '',
            { text: `Emissão: ${formatDateBr(statement.statementDate)}`, fontSize: 7, alignment: 'right' },
          ].filter(Boolean),
        },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 8],
    },
    headerBox(statement, model.customer, lines),
  ];

  // Agrupa por contrato (SEQCONTRATO) e, dentro, por equipamento (CDEQUIPAMENTO).
  const groups = new Map();
  for (const line of lines) {
    const key = String(line.contractExternalId || '—');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  if (lines.length === 0) {
    content.push({
      text: 'Contrato com valor fixo — o iLux não detalha produção neste demonstrativo.',
      italics: true, fontSize: 7, color: '#555555', margin: [0, 4, 0, 6],
    });
  }

  for (const [contractId, groupLines] of groups) {
    content.push({
      text: `Contrato ${contractId}${groupLines[0].contractNumber ? ` / ${groupLines[0].contractNumber}` : ''}`,
      bold: true, fontSize: 7, color: accent, margin: [0, 6, 0, 2],
    });

    // Detalhe por equipamento
    const byEquip = new Map();
    for (const line of groupLines) {
      const key = String(line.equipmentExternalId || line.meterCode || '—');
      if (!byEquip.has(key)) byEquip.set(key, []);
      byEquip.get(key).push(line);
    }
    for (const equipLines of byEquip.values()) {
      content.push(equipmentStrip(equipLines[0]));
      content.push({
        table: {
          headerRows: 1,
          widths: DETAIL_WIDTHS,
          body: [detailHeaderRow(accent, accentText), ...equipLines.map(detailDataRow)],
          dontBreakRows: true,
        },
        layout: detailLayout,
        margin: [0, 0, 0, 3],
      });
    }

    // Quadro Resumo Contrato
    const t = contractTotals(groupLines);
    const totalRow = [
      { text: 'Total Contrato:', bold: true, fontSize: 6, colSpan: 4, margin: [2, 2, 2, 2] }, {}, {}, {},
      { text: intBr(t.franquia), bold: true, fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
      { text: money(t.valFranquia), bold: true, fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
      { text: money4(t.valExcedido), bold: true, fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
      { text: t.acrescDesc ? money(t.acrescDesc) : '', bold: true, fontSize: 6, alignment: 'right', margin: [2, 2, 2, 2] },
      { text: money4(t.total), bold: true, fontSize: 6, alignment: 'right', fillColor: accent, color: accentText, margin: [2, 2, 2, 2] },
    ];
    content.push({
      text: 'Quadro Resumo Contrato', bold: true, fontSize: 6.5, margin: [0, 3, 0, 1],
    });
    content.push({
      table: {
        headerRows: 1,
        widths: SUMMARY_WIDTHS,
        body: [
          SUMMARY_COLS.map((text, i) => ({
            text, bold: true, fontSize: 5.4, color: accentText, fillColor: accent,
            alignment: i === 0 ? 'left' : 'right', margin: [2, 2, 2, 2],
          })),
          ...groupLines.map(summaryRow),
          totalRow,
        ],
      },
      layout: detailLayout,
      margin: [0, 0, 0, 6],
    });
  }

  // Total geral (so quando ha mais de um contrato -- senao "Total Contrato" ja e o total)
  if (groups.size > 1) {
    content.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 260,
          table: {
            widths: ['*', 90],
            body: [
              [{ text: 'Valor fixo (franquias)', alignment: 'right', fontSize: 7, margin: [2, 2, 6, 2] },
                { text: money(statement.fixedValue), alignment: 'right', fontSize: 7, bold: true, margin: [2, 2, 2, 2] }],
              [{ text: 'Excedentes', alignment: 'right', fontSize: 7, margin: [2, 2, 6, 2] },
                { text: money(statement.excessValue), alignment: 'right', fontSize: 7, bold: true, margin: [2, 2, 2, 2] }],
              [{ text: 'TOTAL DO DEMONSTRATIVO', alignment: 'right', fontSize: 8, bold: true, margin: [2, 2, 6, 2] },
                { text: money(statement.totalValue), alignment: 'right', fontSize: 8, bold: true, fillColor: accent, color: accentText, margin: [2, 2, 2, 2] }],
            ],
          },
          layout: {
            hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => '#CCCCCC',
            paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3,
          },
        },
      ],
      margin: [0, 4, 0, 0],
    });
  }

  if (statement.notes) {
    content.push({ text: `Observações: ${String(statement.notes)}`, fontSize: 6.5, margin: [0, 6, 0, 0] });
  }

  content.push({
    text: 'Documento gerado pelo CRM a partir dos valores fechados no iLux. Confira o boleto para o valor a pagar.',
    fontSize: 5.5, italics: true, color: '#999999', margin: [0, 6, 0, 0],
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [22, 22, 22, 26],
    info: { title: `Demonstrativo ${statement.externalId || ''}` },
    defaultStyle: { font: 'Roboto', fontSize: 7, color: '#111111' },
    content,
  };
}

module.exports = { buildStatementDocDefinition, lineValue, normalizeAccent, accentTextColor };
