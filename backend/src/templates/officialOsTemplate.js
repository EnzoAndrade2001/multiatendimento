function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function text(value, fallback = '-') {
  const result = String(value ?? '').trim();
  return escapeHtml(result || fallback);
}

function multiline(value, fallback = '') {
  const result = String(value ?? '').trim();
  return escapeHtml(result || fallback).replace(/\r?\n/g, '<br>');
}

function checkbox(label, checked) {
  return `<span class="check ${checked ? 'on' : ''}">${escapeHtml(label)}</span>`;
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '<tr><td class="history-empty" colspan="2">Nenhum chamado anterior encontrado para este código de cliente iLux.</td></tr>';
  }

  return history.slice(0, 5).map((item) => `
    <tr>
      <td class="history-date">${text(item.date, '')}<br>${text(item.time, '')}</td>
      <td><b>O.S. ${text(item.number)}</b> &nbsp;
        <b>Tipo:</b> ${text(item.type)} &nbsp;
        <b>Equip.:</b> ${text(item.equipment)} &nbsp;
        <b>Abertura:</b> ${text(item.openedBy)} &nbsp;
        <b>Status:</b> ${text(item.status)}<br>
        <div class="history-summary">
          <span class="history-detail"><b>Chamado:</b> ${multiline(item.defect, 'Sem descrição informada.')}</span>
          <span class="history-detail"><b>Fechamento:</b> ${multiline(item.closing, 'Sem fechamento registrado.')}</span>
          <span class="history-owner"><b>Fechada por:</b> ${text(item.closedBy, 'Não informado')}<br><b>Técnico:</b> ${text(item.technician, 'Não informado')}</span>
        </div>
      </td>
    </tr>`).join('');
}

function renderOfficialOsTemplate(model) {
  // Cor de destaque por empresa (cabeçalho da marca + bandas "Descrição/Visita"
  // e "Follow-up/Ação"). O corpo do documento segue preto. Valor inválido volta
  // ao vermelho padrão.
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(model.accentColor || ''))
    ? String(model.accentColor).toUpperCase()
    : '#C62828';
  const accentText = /^#[0-9a-fA-F]{6}$/.test(String(model.accentTextColor || ''))
    ? String(model.accentTextColor).toUpperCase()
    : '#FFFFFF';
  const brandName = (model.company && (model.company.brand || model.company.name)) || '';
  const logoInitials = text(
    String(brandName).trim().split(/\s+/).map((word) => word[0]).filter(Boolean).slice(0, 3).join('').toUpperCase() || 'OS',
    'OS',
  );

  const logo = model.logoDataUri
    ? `<img class="logo-lcd" src="${model.logoDataUri}" alt="${logoInitials}">`
    : `<span class="logo-fallback">${logoInitials}</span>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ordem de Serviço ${text(model.number, '')}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 4mm; }
    body { margin: 0; padding: 4mm; color: #111; font: 12px Arial, Helvetica, sans-serif; line-height: 1.16; background: #fff; }
    .sheet { display: flex; flex-direction: column; width: 202mm; height: 289mm; min-height: 289mm; max-height: 289mm; margin: 0 auto; border: 1px solid #111; overflow: hidden; background: #fff; }
    .sheet > table, .sheet > div { flex: 0 0 auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td, th { border: 1px solid #111; padding: 2px 3px; vertical-align: top; line-height: 1.16; }
    .company { width: 53%; padding: 2px 4px; text-align: center; font-size: 12px; line-height: 1.16; }
    .company strong { font-size: 12px; }
    .company-head { display: flex; align-items: center; justify-content: center; gap: 4px; margin-bottom: 2px; }
    .company-copy { flex: 1; }
    .company-brand { display: block; font-size: 16px; font-weight: 700; line-height: 1.05; }
    .company-legal { display: block; margin-top: 1px; font-size: 10px; font-weight: 700; line-height: 1.1; }
    .logo-lcd { width: 15mm; height: 13mm; object-fit: contain; flex: 0 0 auto; }
    .logo-fallback { width: 15mm; color: ${accent}; font-size: 23px; font-weight: 700; line-height: 1; }
    .title { width: 22%; text-align: center; font-size: 12px; vertical-align: middle; }
    .meta { width: 25%; padding: 2px 4px; font-size: 12px; line-height: 1.16; }
    .meta-top { display: flex; justify-content: space-between; gap: 4px; white-space: nowrap; font-size: 11px; }
    .section-title { background: #cfcfcf; font-weight: 700; font-size: 12px; line-height: 1.1; padding: 1.5px 4px; border: 1px solid #111; }
    .section-title-red { background: ${accent}; color: ${accentText}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .label { display: inline-block; margin-right: 2px; font-weight: 700; }
    .check { display: inline-block; margin: 1px 6px 0 0; font-size: 12px; white-space: nowrap; }
    .check::before { content: ""; display: inline-flex; width: 12px; height: 12px; margin-right: 3px; align-items: center; justify-content: center; border: 1.5px solid #111; font-size: 10px; font-weight: 700; line-height: 1; vertical-align: -1px; }
    .check.on::before { content: "✓"; }
    .info-cell { padding: 3px 4px; line-height: 1.2; }
    .cabecalho-destaque { color: #000; font-size: calc(1em + 1px); font-weight: 700; line-height: 1.2; }
    .cabecalho-destaque .label { color: #000; font-weight: 700; }
    .localizacao-equipamento { color: #000; font-size: calc(1em + 6px); font-weight: 700; line-height: 1.2; }
    .localizacao-equipamento .label { color: #000; font-weight: 700; }
    .spaced-cell { padding: 3px 4px; line-height: 1.2; }
    .description, .followup { border-left: 3px solid ${accent}; border-right: 3px solid ${accent}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .description td, .followup td { border-left-color: ${accent}; border-right-color: ${accent}; }
    .description { min-height: 29mm; }
    .technical-notes { margin-top: 5px; }
    .technical-note { display: grid; grid-template-columns: 64px minmax(0, 1fr); column-gap: 8px; min-height: 24px; }
    .technical-note b { padding-top: 5px; font-size: 12px; line-height: 1.2; white-space: nowrap; }
    .technical-note span { min-width: 0; font-size: 19px; line-height: 1.24; overflow-wrap: anywhere; }
    .followup { min-height: 8mm; }
    .history-block { flex: 1 1 0 !important; min-height: 0; border: 1px solid #111; border-top: 0; padding: 3px; overflow: hidden; }
    .history-table { table-layout: fixed; }
    .history-table td { padding: 3px 4px; font-size: 11px; line-height: 1.14; }
    .history-date { width: 23mm; text-align: center; white-space: nowrap; }
    .history-summary { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.25fr) 34mm; gap: 5px; align-items: start; margin-top: 2px; }
    .history-detail { min-width: 0; overflow-wrap: anywhere; }
    .history-owner { min-width: 0; color: #333; }
    .history-empty { height: 18mm; color: #555; text-align: center; vertical-align: middle; }
    .accept-block { margin-top: auto; break-inside: avoid; }
    .accept { min-height: 17mm; }
    .signature { width: 34%; height: 14mm; text-align: center; vertical-align: bottom; }
    .signature span { display: block; border-top: 1px solid #111; margin: 0 8px 4px; padding-top: 2px; }
    .actions { width: 202mm; margin: 0 auto 8px; display: flex; justify-content: flex-end; }
    .actions button { border: 0; border-radius: 5px; padding: 9px 14px; color: #fff; background: #111827; cursor: pointer; font-weight: 700; }
    @media screen { body { background: #e5e7eb; } .sheet { box-shadow: 0 2px 10px #888; } }
    @media print { body { padding: 0; } .actions { display: none; } .sheet { border: 0; width: 100%; height: 289mm; min-height: 289mm; max-height: 289mm; } }
  </style>
</head>
<body>
  <div class="actions"><button type="button" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button></div>
  <main class="sheet">
    <table><tr>
      <td class="company">
        <div class="company-head">${logo}<div class="company-copy"><span class="company-brand">LCD DIGITAL OUTSOURCING DE IMPRESSÃO</span><strong class="company-legal">${text(model.company.name)}</strong></div></div>
        CNPJ: ${text(model.company.cnpj)} &nbsp; Insc.Estadual: ${text(model.company.stateRegistration)}<br>
        Endereço: ${text(model.company.address)}<br>
        Cidade: ${text(model.company.city)} (${text(model.company.state, '')}) &nbsp; Bairro: ${text(model.company.neighborhood)}<br>
        Fone: ${text(model.company.phone)} &nbsp; CEP: ${text(model.company.zipCode)}
      </td>
      <td class="title">ORDEM DE SERVIÇO</td>
      <td class="meta"><div class="meta-top"><span><b>Número:</b> ${text(model.number)}</span><span><b>Data:</b> ${text(model.date, '')}</span></div>
        <b>Hora:</b> ${text(model.time, '')}<br>
        <b>Técnico abertura:</b> ${text(model.openedBy, '')}<br>
        <b>Técnico atendimento:</b> ${text(model.technician, '')}<br>
        <b>Atendimento Prev:</b> ${text(model.expectedDate, '')} ${text(model.expectedTime, '')} &nbsp; <b>Priorid.</b> ${text(model.priority, '')}<br>
        <b>Tipo O.S.:</b> ${text(model.type, '')}<br>
        ${checkbox('Atendimento', model.isAttendance)}
        ${checkbox('Garantia', model.isWarranty)}
        ${checkbox('Orçamento', model.isBudget)}
      </td>
    </tr></table>

    <div class="section-title">Cliente &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Equipamento</div>
    <table><tr><td class="info-cell" style="width:54%">
      <span class="label">Código iLux:</span> ${text(model.client.code)} &nbsp; <span class="cabecalho-destaque"><span class="label">Cliente:</span> ${text(model.client.name)}</span><br>
      <span class="cabecalho-destaque"><span class="label">Endereço:</span> ${text(model.client.address)}</span><br>
      <span class="label">Bairro:</span> ${text(model.client.neighborhood)} &nbsp; <span class="label">CEP:</span> ${text(model.client.zipCode)}<br>
      <span class="label">Cidade:</span> ${text(model.client.city)} (${text(model.client.state, '')}) &nbsp; <span class="label">U.F.:</span> ${text(model.client.state)}<br>
      <span class="label">CNPJ/CPF:</span> ${text(model.client.document)} &nbsp; <span class="label">Insc.Estadual:</span> ${text(model.client.stateRegistration)}<br>
      <span class="label">Contato:</span> ${text(model.client.contact)} &nbsp; <span class="label">Fone:</span> ${text(model.client.phone)}
    </td><td class="info-cell">
      <span class="label">Equipamento:</span> ${text(model.equipment.code)}<br>
      <span class="label">Modelo:</span> ${text(model.equipment.model)}<br>
      <span class="label">Série:</span> ${text(model.equipment.serial)} &nbsp; <span class="label">Patrimônio:</span> ${text(model.equipment.asset)}<br>
      <span class="label">Tipo de Contrato:</span> ${text(model.equipment.contractType)} &nbsp; <span class="label">Território:</span> ${text(model.equipment.territory)}<br>
      <span class="label">Departamento:</span> ${text(model.equipment.department)}<br>
      <span class="localizacao-equipamento"><span class="label">Localização:</span> ${text(model.equipment.location)}</span>
    </td></tr></table>

    <div class="section-title section-title-red">Descrição/Visita</div>
    <table class="description"><tr><td class="spaced-cell">
      <span class="label">Data Visita:</span> ${text(model.visit.date, '')} &nbsp;&nbsp; <span class="label">Hora Inicial:</span> ${text(model.visit.start, '')} &nbsp;&nbsp; <span class="label">Hora Final:</span> ${text(model.visit.end, '')}<br>
      <span class="label">Medidor 01:</span> ${text(model.visit.meterCode, '')} &nbsp;&nbsp; <span class="label">Contador Medidor 01:</span> ${text(model.visit.meterValue, '0')}<br><br>
      <div class="technical-notes">
        <div class="technical-note"><b>Defeito:</b><span>${multiline(model.defect)}</span></div>
        <div class="technical-note"><b>Sintoma:</b><span>${multiline(model.symptom)}</span></div>
        <div class="technical-note"><b>Causa:</b><span>${multiline(model.cause)}</span></div>
        <div class="technical-note"><b>Ação:</b><span>${multiline(model.action)}</span></div>
      </div>
    </td></tr></table>

    <div class="section-title section-title-red">Follow-up/Ação</div>
    <table class="followup"><tr><td class="spaced-cell">${model.followUp ? multiline(model.followUp) : '&nbsp;'}</td></tr></table>

    <div class="section-title">HISTÓRICO DOS ÚLTIMOS CHAMADOS</div>
    <div class="history-block"><table class="history-table"><tbody>${renderHistory(model.history)}</tbody></table></div>

    <div class="accept-block">
      <div class="section-title">Aceite da O.S.</div>
      <table class="accept"><tr><td><b>Favor efetuar o aceite da implantação/retirada dos serviços (se mais relacionado(s))</b><br><br><b>Local:</b> ________________________________ &nbsp;&nbsp; <b>Data:</b> ____ / ____ / ______</td><td class="signature"><span>Assinatura/Carimbo Cliente</span></td></tr></table>
    </div>
  </main>
</body>
  </html>`;

  // O layout antigo trazia o nome da LCD fixo no HTML. O conteúdo exibido
  // deve acompanhar o cadastro oficial da empresa sem reescrever o template.
  const brand = text(model.company.brand || model.company.name);
  return html.replace(/<span class="company-brand">[^<]*<\/span>/, `<span class="company-brand">${brand}</span>`);
}

module.exports = { renderOfficialOsTemplate };
