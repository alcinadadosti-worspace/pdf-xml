/* ══════════════════════════════════════════════════════════════════
   NFS-e PDF → XML Converter  |  app.js
   Parses DANFSe / NFS-e Nacional PDFs and generates the
   NFSe XML following the sped.fazenda.gov.br/nfse v1.01 schema.
   ══════════════════════════════════════════════════════════════════ */

// ─── DOM refs ────────────────────────────────────────────────────
const fileInput    = document.getElementById('fileInput');
const uploadArea   = document.getElementById('uploadArea');
const fileNameEl   = document.getElementById('fileName');
const progress     = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const errorBox     = document.getElementById('errorBox');
const results      = document.getElementById('results');
const dataPreview  = document.getElementById('dataPreview');
const xmlOutput    = document.getElementById('xmlOutput');
const downloadBtn  = document.getElementById('downloadBtn');

// ─── Event wiring ────────────────────────────────────────────────
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', e => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) processFile(fileInput.files[0]);
});

downloadBtn.addEventListener('click', downloadXML);

// ─── Main flow ───────────────────────────────────────────────────
async function processFile(file) {
  const name = file.name.toLowerCase();
  const isPDF = name.endsWith('.pdf');
  const isXML = name.endsWith('.xml');

  if (!isPDF && !isXML) {
    showError('Por favor, selecione um arquivo PDF ou XML.');
    return;
  }

  reset();
  fileNameEl.textContent = `📎 ${file.name}`;
  fileNameEl.classList.remove('hidden');

  try {
    let data;
    if (isXML) {
      showProgress(30, 'Lendo XML...');
      const text = await file.text();
      showProgress(70, 'Extraindo campos do XML...');
      data = extractFieldsFromXML(text);
    } else {
      showProgress(10, 'Lendo PDF...');
      const text = await extractTextFromPDF(file);
      showProgress(50, 'Extraindo campos do PDF...');
      data = extractFields(text);
    }
    showProgress(90, 'Gerando XML...');

    const xml = buildXML(data);
    showProgress(100, 'Concluído!');

    renderPreview(data);
    xmlOutput.textContent = xml;
    results.classList.remove('hidden');

    downloadBtn.dataset.xml      = xml;
    downloadBtn.dataset.filename = deriveFilename(data);

    setTimeout(() => progress.classList.add('hidden'), 800);
  } catch (err) {
    showError('Erro ao processar o arquivo:\n' + err.message);
  }
}

// ─── PDF text extraction (pdf.js) ────────────────────────────────
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page  = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Join items with a space; use newline between items that have
    // a significant vertical gap (robust for 2-column layouts).
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        fullText += '\n';
      }
      fullText += item.str + ' ';
      if (y !== null) lastY = y;
    }
    fullText += '\n--- PAGE BREAK ---\n';
  }
  return fullText;
}

// ─── XML field extraction ─────────────────────────────────────────
function extractFieldsFromXML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('XML inválido: ' + parseErr.textContent.substring(0, 200));

  const txt = (tagName, ctx) => {
    if (!ctx) return '';
    const el = ctx.getElementsByTagName(tagName)[0];
    return el ? el.textContent.trim() : '';
  };

  // infNFSe
  const infNFSe = doc.getElementsByTagName('infNFSe')[0];
  const idAttr   = infNFSe ? (infNFSe.getAttribute('Id') || '') : '';
  const chaveAcesso = idAttr.replace(/^NFS/, '');

  const nNFSe       = txt('nNFSe',       infNFSe);
  const nDFSe       = txt('nDFSe',       infNFSe);
  const xLocEmi     = txt('xLocEmi',     infNFSe);
  const xLocPrestacao = txt('xLocPrestacao', infNFSe);
  const cLocIncid   = txt('cLocIncid',   infNFSe);
  const xLocIncid   = txt('xLocIncid',   infNFSe);
  const xTribNac    = txt('xTribNac',    infNFSe);
  const xNBS        = txt('xNBS',        infNFSe);
  const verAplic    = txt('verAplic',    infNFSe);
  const ambGer      = txt('ambGer',      infNFSe) || '2';
  const cStat       = txt('cStat',       infNFSe) || '100';
  const dhProc      = txt('dhProc',      infNFSe);
  const tpEmis      = txt('tpEmis',      infNFSe) || '1';
  const procEmi     = txt('procEmi',     infNFSe) || '1';

  // emit
  const emitEl  = infNFSe ? infNFSe.getElementsByTagName('emit')[0] : null;
  const emitCNPJ  = normalizeCNPJ(txt('CNPJ',   emitEl));
  const emitNome  = txt('xNome',  emitEl);
  const emitLgr   = txt('xLgr',   emitEl);
  const emitNro   = txt('nro',    emitEl);
  const emitBairro= txt('xBairro',emitEl);
  const emitCMun  = txt('cMun',   emitEl);
  const emitUF    = txt('UF',     emitEl);
  const emitCEP   = normalizeCEP(txt('CEP',  emitEl));
  const emitFone  = formatPhone(txt('fone',  emitEl));
  const emitEmail = txt('email',  emitEl);

  // valores NFSe (first direct 'valores' child of infNFSe)
  let nfseVal = null;
  if (infNFSe) {
    for (const c of infNFSe.children) { if (c.tagName === 'valores') { nfseVal = c; break; } }
  }
  const vBC    = txt('vBC',        nfseVal);
  const pAliq  = txt('pAliqAplic', nfseVal);
  const vISSQN = txt('vISSQN',     nfseVal);
  const vLiq   = txt('vLiq',       nfseVal);

  // IBSCBS NFSe (first direct 'IBSCBS' child of infNFSe)
  let nfseIBS = null;
  if (infNFSe) {
    for (const c of infNFSe.children) { if (c.tagName === 'IBSCBS') { nfseIBS = c; break; } }
  }
  const cLocalidadeIncid = txt('cLocalidadeIncid', nfseIBS);
  const xLocalidadeIncid = txt('xLocalidadeIncid', nfseIBS);
  const vBCIBS  = txt('vBC',     nfseIBS);
  const pIBSUF  = txt('pIBSUF',  nfseIBS);
  const pIBSMun = txt('pIBSMun', nfseIBS);
  const pCBS    = txt('pCBS',    nfseIBS);
  const vTotNF  = txt('vTotNF',  nfseIBS);
  const vIBSTot = txt('vIBSTot', nfseIBS);
  const vIBSUF  = txt('vIBSUF',  nfseIBS);
  const vIBSMun = txt('vIBSMun', nfseIBS);
  const vCBS    = txt('vCBS',    nfseIBS);

  // infDPS
  const infDPS   = doc.getElementsByTagName('infDPS')[0];
  const dhEmi    = txt('dhEmi',   infDPS);
  const dCompet  = txt('dCompet', infDPS);
  const nDPS     = txt('nDPS',    infDPS);
  const serie    = txt('serie',   infDPS) || '001';
  const tpEmit   = txt('tpEmit',  infDPS) || '1';
  const cLocEmi  = txt('cLocEmi', infDPS);

  // regTrib (inside prest)
  const prestEl   = infDPS ? infDPS.getElementsByTagName('prest')[0]   : null;
  const regTribEl = prestEl ? prestEl.getElementsByTagName('regTrib')[0] : null;
  const opSimpNac  = txt('opSimpNac',  regTribEl) || '1';
  const regEspTrib = txt('regEspTrib', regTribEl) || '0';

  // toma
  const tomaEl    = infDPS ? infDPS.getElementsByTagName('toma')[0] : null;
  const tomaCNPJ  = normalizeCNPJ(txt('CNPJ',   tomaEl));
  const tomaNome  = txt('xNome',  tomaEl);
  const tomaLgr   = txt('xLgr',   tomaEl);
  const tomaNro   = txt('nro',    tomaEl);
  const tomaBairro= txt('xBairro',tomaEl);
  const tomaCMun  = txt('cMun',   tomaEl);
  const tomaCEP   = normalizeCEP(txt('CEP',  tomaEl));
  const tomaFone  = formatPhone(txt('fone',  tomaEl));
  const tomaEmail = txt('email',  tomaEl);

  // serv
  const servEl    = infDPS ? infDPS.getElementsByTagName('serv')[0] : null;
  const xDescServ    = txt('xDescServ',    servEl);
  const cTribNac     = txt('cTribNac',     servEl);
  const cNBS         = txt('cNBS',         servEl);
  const cIntContrib  = txt('cIntContrib',  servEl);
  const cLocPrestacao= txt('cLocPrestacao',servEl);
  const xInfComp     = txt('xInfComp',     servEl);
  const docRef       = txt('docRef',       servEl) || '0000000000';

  // valores DPS (first direct 'valores' child of infDPS)
  let dpsVal = null;
  if (infDPS) {
    for (const c of infDPS.children) { if (c.tagName === 'valores') { dpsVal = c; break; } }
  }
  const vServPrestEl = dpsVal ? dpsVal.getElementsByTagName('vServPrest')[0]      : null;
  const vServ        = txt('vServ', vServPrestEl);
  const vDescEl      = dpsVal ? dpsVal.getElementsByTagName('vDescCondIncond')[0] : null;
  const vDescIncond  = txt('vDescIncond', vDescEl);

  // trib
  const tribEl    = dpsVal ? dpsVal.getElementsByTagName('trib')[0] : null;
  const tribMunEl = tribEl ? tribEl.getElementsByTagName('tribMun')[0] : null;
  const tpRetISSQN= txt('tpRetISSQN', tribMunEl) || '1';

  // PIS/COFINS
  const pisEl       = tribEl ? tribEl.getElementsByTagName('piscofins')[0] : null;
  const CST_PIS     = txt('CST',            pisEl) || '01';
  const vBCPis      = txt('vBCPisCofins',   pisEl);
  const pAliqPis    = txt('pAliqPis',       pisEl);
  const pAliqCof    = txt('pAliqCofins',    pisEl);
  const vPis        = txt('vPis',           pisEl);
  const vCofins     = txt('vCofins',        pisEl);
  const tpRetPisCofins = txt('tpRetPisCofins', pisEl) || '2';

  // IBSCBS DPS (first direct 'IBSCBS' child of infDPS)
  let dpsIBS = null;
  if (infDPS) {
    for (const c of infDPS.children) { if (c.tagName === 'IBSCBS') { dpsIBS = c; break; } }
  }
  const cIndOp     = txt('cIndOp', dpsIBS) || '100301';
  const gIBSCBSEl  = dpsIBS ? dpsIBS.getElementsByTagName('gIBSCBS')[0] : null;
  const CST_IBS    = txt('CST',        gIBSCBSEl) || '000';
  const cClassTrib = txt('cClassTrib', gIBSCBSEl) || '000001';

  return {
    chaveAcesso,
    nNFSe, nDFSe, nDPS, dhEmi, dCompet,
    xLocEmi, xLocPrestacao, cLocIncid, xLocIncid,
    verAplic, ambGer, cStat, dhProc,
    tpEmis, procEmi, serie, tpEmit,
    emitCNPJ, emitNome, emitLgr, emitNro, emitBairro,
    emitCEP, emitMun: '', emitUF, emitFone, emitEmail,
    emitCMun: emitCMun || cLocEmi,
    tomaCNPJ, tomaNome, tomaLgr, tomaNro, tomaBairro,
    tomaCEP, tomaMun: '', tomaUF: '', tomaFone, tomaEmail, tomaCMun,
    xDescServ, cTribNac, cNBS, xTribNac, xNBS, cIntContrib,
    cLocPrestacao, xInfComp, docRef,
    vServ, vDescIncond, vBC, pAliq, vISSQN, vLiq,
    vBCIBS, pIBSUF, pIBSMun, pCBS,
    vIBSTot, vIBSUF, vIBSMun, vCBS, vTotNF,
    cLocalidadeIncid, xLocalidadeIncid,
    vBCPis, pAliqPis, pAliqCof, vPis, vCofins,
    CST_PIS, tpRetPisCofins,
    opSimpNac, regEspTrib, tpRetISSQN,
    cIndOp, cClassTrib, CST_IBS,
  };
}

// ─── Field extraction ─────────────────────────────────────────────
/*
  Strategy:
  1. Try labelled-field patterns first (e.g. "Número NFS-e: 123456")
  2. Fall back to positional / contextual patterns
  3. Normalise formats (CNPJ, money, date)
  Brazilian PDFs are noisy — every regex is wrapped in a try/catch.
*/

function extractNationalDanfseFields(text) {
  const raw = text.replace(/\r/g, '');
  if (!/DANFSe/i.test(raw) || !/Documento Auxiliar da NFS-e/i.test(raw)) {
    return null;
  }

  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const normalizeText = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const lineMatches = (line, patterns) => {
    const normalized = normalizeText(line);
    return patterns.some(pattern => pattern.test(normalized));
  };

  const findLineIndex = (sourceLines, patterns, start = 0) => {
    for (let i = start; i < sourceLines.length; i++) {
      if (lineMatches(sourceLines[i], patterns)) return i;
    }
    return -1;
  };

  const valueAfter = (sourceLines, patterns, start = 0) => {
    const index = findLineIndex(sourceLines, patterns, start);
    if (index < 0) return '';
    for (let i = index + 1; i < sourceLines.length; i++) {
      const value = sourceLines[i].trim();
      if (!value) continue;
      return value === '-' ? '' : value;
    }
    return '';
  };

  const valueAfterOccurrence = (patterns, occurrence = 0, sourceLines = lines) => {
    let matches = 0;
    for (let i = 0; i < sourceLines.length; i++) {
      if (!lineMatches(sourceLines[i], patterns)) continue;
      if (matches === occurrence) {
        for (let j = i + 1; j < sourceLines.length; j++) {
          const value = sourceLines[j].trim();
          if (!value) continue;
          return value === '-' ? '' : value;
        }
      }
      matches++;
    }
    return '';
  };

  const section = (startPatterns, endPatterns) => {
    const start = findLineIndex(lines, startPatterns);
    if (start < 0) return [];
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lineMatches(lines[i], endPatterns)) {
        end = i;
        break;
      }
    }
    return lines.slice(start + 1, end);
  };

  const onlyDigits = value => (value || '').replace(/\D/g, '');

  const parseAddress = value => {
    const parts = (value || '').split(',').map(part => part.trim()).filter(Boolean);
    return {
      street: parts[0] || '',
      number: parts[1] || '',
      district: parts.slice(2).join(', '),
    };
  };

  const parseCityUF = value => {
    const match = (value || '').match(/^(.+?)\s*-\s*([A-Z]{2})$/i);
    return {
      city: match ? match[1].trim() : (value || '').trim(),
      uf: match ? match[2].toUpperCase() : '',
    };
  };

  const cityCode = (city, uf) => {
    const key = `${normalizeText(city)}|${String(uf || '').toUpperCase()}`;
    const codes = {
      'sao jose dos pinhais|PR': '4125506',
      'penedo|AL': '2706703',
    };
    return codes[key] || '';
  };

  const moneyAfter = (sourceLines, patterns) => normalizeMoney(valueAfter(sourceLines, patterns));
  const percentAfter = (sourceLines, patterns) => normalizeMoney(valueAfter(sourceLines, patterns).replace('%', ''));
  const toRate = (value, base) => {
    const n = parseFloat(value);
    const b = parseFloat(base);
    if (!isFinite(n) || !isFinite(b) || b === 0) return '';
    return ((n / b) * 100).toFixed(2);
  };

  const prestador = section([/^emitente da nfs-e$/], [/^tomador do servico$/]);
  const tomador = section([/^tomador do servico$/], [/^intermediario do servico/, /^servico prestado$/]);
  const servico = section([/^servico prestado$/], [/^tributacao municipal$/]);
  const tributacaoMunicipal = section([/^tributacao municipal$/], [/^tributacao federal$/]);
  const tributacaoFederal = section([/^tributacao federal$/], [/^valor total da nfs-e$/]);
  const valorTotal = section([/^valor total da nfs-e$/], [/^totais aproximados dos tributos$/]);
  const informacoes = section([/^informacoes complementares$/], [/^--- page break ---$/]);

  const cnpjCpfNifLabel = [/^cnpj \/ cpf \/ nif$/];
  const phoneLabel = [/^telefone$/];
  const nameLabel = [/^nome \/ nome empresarial$/];
  const emailLabel = [/^e-mail$/];
  const addressLabel = [/^endereco$/];
  const cityLabel = [/^municipio$/];
  const cepLabel = [/^cep$/];

  const chaveAcesso = onlyDigits(valueAfter(lines, [/^chave de acesso da nfs-e$/]));
  const nNFSe = onlyDigits(valueAfter(lines, [/^numero da nfs-e$/]));
  const nDPS = onlyDigits(valueAfter(lines, [/^numero da dps$/]));
  const serieRaw = onlyDigits(valueAfter(lines, [/^serie da dps$/]));
  const serie = (serieRaw || '1').padStart(3, '0');
  const dCompet = valueAfter(lines, [/^competencia da nfs-e$/]);
  const dhProc = toISODate(valueAfter(lines, [/^data e hora da emissao da nfs-e$/]));
  const dhEmi = toISODate(valueAfter(lines, [/^data e hora da emissao da dps$/]));

  const emitAddress = parseAddress(valueAfter(prestador, [/^endereco$/]));
  const emitCity = parseCityUF(valueAfter(prestador, [/^municipio$/]));
  const emitCMun = cityCode(emitCity.city, emitCity.uf) || chaveAcesso.substring(0, 7);

  const tomaCNPJRaw = valueAfter(tomador, cnpjCpfNifLabel) || valueAfterOccurrence(cnpjCpfNifLabel, 1);
  const tomaPhoneRaw = valueAfter(tomador, phoneLabel) || valueAfterOccurrence(phoneLabel, 1);
  const tomaName = valueAfter(tomador, nameLabel) || valueAfterOccurrence(nameLabel, 1);
  const tomaEmailValue = valueAfter(tomador, emailLabel) || valueAfterOccurrence(emailLabel, 1);
  const tomaAddress = parseAddress(valueAfter(tomador, addressLabel) || valueAfterOccurrence(addressLabel, 1));
  const tomaCity = parseCityUF(valueAfter(tomador, cityLabel) || valueAfterOccurrence(cityLabel, 1));
  const tomaCEPValue = valueAfter(tomador, cepLabel) || valueAfterOccurrence(cepLabel, 1);
  const tomaCMun = cityCode(tomaCity.city, tomaCity.uf);

  const locPrest = parseCityUF(valueAfter(servico, [/^local da prestacao$/]));
  const cLocPrestacao = cityCode(locPrest.city, locPrest.uf) || tomaCMun;

  const tributacaoNacional = valueAfter(servico, [/^codigo de tributacao nacional$/]);
  const tribMatch = tributacaoNacional.match(/^([\d.]+)\s*-\s*(.+)$/);
  const cTribNac = tribMatch ? onlyDigits(tribMatch[1]) : onlyDigits(tributacaoNacional);
  const xTribNac = tribMatch ? tribMatch[2].trim() : '';
  const xNBS = xTribNac.replace(/\s*\(.+\)\.?$/, '').trim();

  const infoText = informacoes.join(' ').replace(/\s+/g, ' ').trim();
  const docRefMatch = infoText.match(/\|\s*Doc Ref:\s*([0-9]+)/i);
  const nbsMatch = infoText.match(/\|\s*NBS:\s*([0-9]+)/i);
  const xInfComp = infoText
    .replace(/^Inf Cont:\s*/i, '')
    .replace(/\s*\|\s*Doc Ref:.*$/i, '')
    .trim();

  const vServ = moneyAfter(tributacaoMunicipal, [/^valor do servico$/]);
  const vDescIncond = moneyAfter(tributacaoMunicipal, [/^desconto incondicionado$/]);
  const vBC = moneyAfter(tributacaoMunicipal, [/^bc issqn$/]);
  const pAliq = percentAfter(tributacaoMunicipal, [/^aliquota aplicada$/]);
  const vISSQN = moneyAfter(tributacaoMunicipal, [/^issqn apurado$/]);
  const vLiq = moneyAfter(valorTotal, [/^valor liquido da nfs-e$/]) || vBC;
  const vPis = moneyAfter(tributacaoFederal, [/^pis - debito apuracao propria$/]);
  const vCofins = moneyAfter(tributacaoFederal, [/^cofins - debito apuracao propria$/]);
  const vBCPis = (vPis || vCofins) ? vBC : '';

  return {
    nNFSe,
    nDFSe: '',
    nDPS,
    chaveAcesso,
    dhEmi,
    dCompet,
    xLocEmi: emitCity.city,
    xLocPrestacao: locPrest.city,
    cLocIncid: emitCMun,
    xLocIncid: emitCity.city,
    verAplic: '',
    ambGer: '2',
    cStat: '100',
    dhProc,
    tpEmis: '1',
    procEmi: '1',
    serie,
    tpEmit: '1',
    emitCNPJ: normalizeCNPJ(valueAfter(prestador, [/^cnpj \/ cpf \/ nif$/])),
    emitNome: valueAfter(prestador, [/^nome \/ nome empresarial$/]),
    emitLgr: emitAddress.street,
    emitNro: emitAddress.number,
    emitBairro: emitAddress.district,
    emitCEP: normalizeCEP(valueAfter(prestador, [/^cep$/])),
    emitMun: emitCity.city,
    emitUF: emitCity.uf,
    emitFone: formatPhone(valueAfter(prestador, [/^telefone$/])),
    emitEmail: valueAfter(prestador, [/^e-mail$/]),
    emitCMun,
    tomaCNPJ: normalizeCNPJ(tomaCNPJRaw),
    tomaNome: tomaName,
    tomaLgr: tomaAddress.street,
    tomaNro: tomaAddress.number,
    tomaBairro: tomaAddress.district,
    tomaCEP: normalizeCEP(tomaCEPValue),
    tomaMun: tomaCity.city,
    tomaUF: tomaCity.uf,
    tomaFone: formatPhone(tomaPhoneRaw),
    tomaEmail: tomaEmailValue,
    tomaCMun,
    xDescServ: valueAfter(servico, [/^descricao do servico$/]),
    cTribNac,
    cNBS: nbsMatch ? nbsMatch[1] : '',
    xTribNac,
    xNBS,
    cIntContrib: '',
    cLocPrestacao,
    xInfComp,
    docRef: docRefMatch ? docRefMatch[1] : '0000000000',
    vServ,
    vDescIncond,
    vBC,
    pAliq,
    vISSQN,
    vLiq,
    vBCIBS: '',
    pIBSUF: '',
    pIBSMun: '',
    pCBS: '',
    vIBSTot: '',
    vIBSUF: '',
    vIBSMun: '',
    vCBS: '',
    vTotNF: vLiq,
    cLocalidadeIncid: cLocPrestacao,
    xLocalidadeIncid: locPrest.city,
    vBCPis,
    pAliqPis: toRate(vPis, vBCPis),
    pAliqCof: toRate(vCofins, vBCPis),
    vPis,
    vCofins,
    CST_PIS: '01',
    tpRetPisCofins: '2',
    opSimpNac: '1',
    regEspTrib: '0',
    tpRetISSQN: '1',
    cIndOp: '100301',
    cClassTrib: '000001',
    CST_IBS: '000',
  };
}

function extractFields(text) {
  const nationalDanfse = extractNationalDanfseFields(text);
  if (nationalDanfse) return nationalDanfse;

  // Normalise: collapse multiple spaces, keep newlines
  const t = text.replace(/ {2,}/g, ' ').replace(/\r/g, '');

  const get = (patterns, flags = 'i') => {
    for (const p of patterns) {
      try {
        const m = new RegExp(p, flags).exec(t);
        if (m && m[1] && m[1].trim()) return m[1].trim();
      } catch (_) { /* bad pattern — skip */ }
    }
    return '';
  };

  // ── Identification ───────────────────────────────────────────
  const nNFSe = get([
    'N[uú]mero\\s+(?:da\\s+)?NFS-?e[:\\s]+([\\d]+)',
    'NFS-?e\\s+N[oº°]?\\.?\\s*([\\d]+)',
    '(?:^|\\s)n[uú]mero[:\\s]+([0-9]{4,8})',
    'nNFSe[:\\s]+([\\d]+)',
    '(?:Nota|NF)\\s*N[oº°]?\\.?\\s*([\\d]+)',
  ]);

  const nDFSe = get([
    'N[uú]mero\\s+DPS[:\\s]+([\\d]+)',
    'nDFSe[:\\s]+([\\d]+)',
    'DPS\\s+N[oº°]?\\.?\\s*([\\d]+)',
  ]);

  const chaveAcesso = get([
    'Chave\\s+(?:de\\s+)?Acesso[:\\s]+([\\d]{44,50})',
    'Id[:\\s]+"?NFS([\\d]{40,50})',
    'NFS([A-Z0-9]{40,55})',
  ]);

  // Date: prefer ISO-like, fall back to dd/mm/yyyy
  const dhEmi = get([
    'Data\\s+(?:e\\s+Hora\\s+)?(?:de\\s+)?Emiss[aã]o[:\\s]+([\\d]{4}-[\\d]{2}-[\\d]{2}T[\\d:+\\-]+)',
    'Data\\s+(?:e\\s+Hora\\s+)?(?:de\\s+)?Emiss[aã]o[:\\s]+([\\d]{2}/[\\d]{2}/[\\d]{4}(?:\\s+[\\d:]+)?)',
    'dhEmi[:\\s]+([\\d]{4}-[\\d]{2}-[\\d]{2}T[\\d:+\\-]+)',
    'Emitida\\s+em[:\\s]+([\\d]{2}/[\\d]{2}/[\\d]{4})',
  ]);

  const dCompet = get([
    'Compet[eê]ncia[:\\s]+([\\d]{2}/[\\d]{4}|[\\d]{4}-[\\d]{2}-[\\d]{2})',
    'Per[ií]odo\\s+(?:de\\s+)?Compet[eê]ncia[:\\s]+([\\d]{2}/[\\d]{4})',
    'dCompet[:\\s]+([\\d]{4}-[\\d]{2}-[\\d]{2})',
  ]);

  // ── Local emission / prestação ────────────────────────────────
  const xLocEmi = get([
    'Munic[ií]pio\\s+(?:de\\s+)?Emiss[aã]o[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|\\r|\\s{2,}|$)',
    'Local\\s+(?:de\\s+)?Emiss[aã]o[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|\\r|\\s{2,}|$)',
    'xLocEmi[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|<)',
  ]);

  const xLocPrestacao = get([
    'Local\\s+(?:da\\s+)?Prest[aã]o[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|\\r|\\s{2,}|$)',
    'Munic[ií]pio\\s+(?:da\\s+)?Prest[aã]o[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|\\r|\\s{2,}|$)',
    'xLocPrestacao[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|<)',
  ]);

  // ── Emitente (Prestador) ──────────────────────────────────────
  // CNPJ pattern: 14 contiguous digits or formatted XX.XXX.XXX/XXXX-XX
  const cnpjPat = '([\\d]{2}[.\\s]?[\\d]{3}[.\\s]?[\\d]{3}[/\\s]?[\\d]{4}[-\\s]?[\\d]{2})';

  const emitCNPJ = normalizeCNPJ(get([
    `CNPJ\\s+(?:do\\s+)?Prestador[:\\s]+${cnpjPat}`,
    `Prestador[\\s\\S]{0,60}?CNPJ[:\\s]+${cnpjPat}`,
    `Emitente[\\s\\S]{0,60}?CNPJ[:\\s]+${cnpjPat}`,
    // first CNPJ in the document often belongs to the emitente
    `(?:^|\\n)\\s*${cnpjPat}`,
  ]));

  const emitNome = get([
    'Nome\\s+(?:Empresarial|do\\s+Prestador)[:\\s]+([A-Za-zÀ-ú0-9 ,.&]+?)(?:\\n|CNPJ|CPF)',
    'Raz[aã]o\\s+Social\\s+(?:do\\s+)?Prestador[:\\s]+([A-Za-zÀ-ú0-9 ,.&]+?)(?:\\n|CNPJ)',
    'Prestador[:\\s]+([A-Za-zÀ-ú0-9 ,.&]{5,80})(?:\\n|CNPJ)',
  ]);

  const emitLgr   = get(['Logradouro[:\\s]+([A-Za-zÀ-ú0-9 ,.]+?)(?:\\n|N[uú]mero|Bairro)', 'Endere[cç]o[:\\s]+([A-Za-zÀ-ú0-9 ,.]+?)(?:,|\\n|N[oº°])']);
  const emitNro   = get(['N[uú]mero[:\\s]+([\\d]{1,6})(?:[\\s,]|Bairro)', 'endere[cç]o.{0,40}?(\\d{1,6})(?:[,\\s]|Bairro)']);
  const emitBairro= get(['Bairro[:\\s]+([A-Za-zÀ-ú0-9 ]+?)(?:\\n|CEP|Munic)']);
  const emitCEP   = get(['CEP[:\\s]+([\\d]{5}-?[\\d]{3})(?:\\n|\\s)']);
  const emitMun   = get(['Munic[ií]pio\\s+(?:do\\s+)?Prestador[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|UF|\\s{2})', 'Cidade[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|UF|\\s{2})']);
  const emitUF    = get(['UF[:\\s]+([A-Z]{2})(?:\\n|\\s)', '\\b([A-Z]{2})\\b(?=\\s*CEP)']);
  const emitFone  = get(['Telefone[:\\s]+([\\d() \\-]{8,15})(?:\\n|Email)', 'Fone[:\\s]+([\\d() \\-]{8,15})']);
  const emitEmail = get(['E-?mail[:\\s]+([\\w._%+\\-]+@[\\w.\\-]+\\.[a-z]{2,})'], 'i');

  const emitCMun  = get(['cMun[:\\s]+([\\d]{7})', 'C[oó]digo\\s+Munic[ií]pio[:\\s]+([\\d]{7})']);

  // ── Tomador ──────────────────────────────────────────────────
  const tomaCNPJ  = normalizeCNPJ(get([
    `CNPJ\\s+(?:do\\s+)?Tomador[:\\s]+${cnpjPat}`,
    `Tomador[\\s\\S]{0,60}?CNPJ[:\\s]+${cnpjPat}`,
  ]));

  const tomaNome  = get([
    'Nome\\s+(?:Empresarial|do\\s+)?Tomador[:\\s]+([A-Za-zÀ-ú0-9 ,.&]+?)(?:\\n|CNPJ|CPF)',
    'Raz[aã]o\\s+Social\\s+(?:do\\s+)?Tomador[:\\s]+([A-Za-zÀ-ú0-9 ,.&]+?)(?:\\n|CNPJ)',
    'Tomador[:\\s]+([A-Za-zÀ-ú0-9 ,.&]{5,80})(?:\\n|CNPJ)',
  ]);

  const tomaLgr    = get(['Tomador[\\s\\S]{0,200}?Logradouro[:\\s]+([A-Za-zÀ-ú0-9 ,.]+?)(?:\\n|N[uú]mero|Bairro)']);
  const tomaNro    = get(['Tomador[\\s\\S]{0,300}?N[uú]mero[:\\s]+([\\d]{1,6})(?:[\\s,]|Bairro)']);
  const tomaBairro = get(['Tomador[\\s\\S]{0,300}?Bairro[:\\s]+([A-Za-zÀ-ú0-9 ]+?)(?:\\n|CEP|Munic)']);
  const tomaCEP    = get(['Tomador[\\s\\S]{0,300}?CEP[:\\s]+([\\d]{5}-?[\\d]{3})(?:\\n|\\s)']);
  const tomaMun    = get(['Munic[ií]pio\\s+(?:do\\s+)?Tomador[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|UF|\\s{2})']);
  const tomaUF     = get(['Tomador[\\s\\S]{0,400}?UF[:\\s]+([A-Z]{2})(?:\\n|\\s)']);
  const tomaFone   = get(['Tomador[\\s\\S]{0,400}?(?:Telefone|Fone)[:\\s]+([\\d() \\-]{8,15})(?:\\n|Email)']);
  const tomaEmail  = get(['Tomador[\\s\\S]{0,400}?E-?mail[:\\s]+([\\w._%+\\-]+@[\\w.\\-]+\\.[a-z]{2,})'], 'i');
  const tomaCMun   = get(['Tomador[\\s\\S]{0,400}?cMun[:\\s]+([\\d]{7})']);

  // ── Serviço ──────────────────────────────────────────────────
  const xDescServ  = get([
    'Descri[cç][aã]o\\s+(?:do\\s+)?Servi[cç]o[:\\s]+([A-Za-zÀ-ú0-9 ,.()\\-]+?)(?:\\n{2}|C[oó]digo)',
    'Objeto[:\\s]+([A-Za-zÀ-ú0-9 ,.()\\-]+?)(?:\\n{2}|C[oó]digo)',
    'xDescServ[:\\s]+([A-Za-zÀ-ú0-9 ,.()\\-]+?)(?:\\n|<)',
  ]);

  const cTribNac   = get([
    'C[oó]digo\\s+(?:de\\s+)?Tributa[cç][aã]o[:\\s]+([\\d]{6})',
    'cTribNac[:\\s]+([\\d]{6})',
    'Item\\s+(?:da\\s+)?Lista[:\\s]+([\\d.]{2,8})',
  ]);

  const cNBS       = get(['cNBS[:\\s]+([\\d]{9})', 'NBS[:\\s]+([\\d]{9})']);
  const xTribNac   = get(['xTribNac[:\\s]+([A-Za-zÀ-ú ().,]+?)(?:\\n|<)', 'Descri[cç][aã]o\\s+Tributa[cç][aã]o[:\\s]+([A-Za-zÀ-ú ().,]+?)(?:\\n|$)']);
  const cLocPrestacao = get(['cLocPrestacao[:\\s]+([\\d]{7})', 'C[oó]digo\\s+Munic[ií]pio\\s+Prest[aã]o[:\\s]+([\\d]{7})']);

  const xInfComp   = get(['Informa[cç][oõ]es\\s+Complementares[:\\s]+([\\s\\S]{1,500}?)(?:\\n{3}|Assinatura|Valores)', 'xInfComp[:\\s]+([\\s\\S]{1,400}?)(?:\\n|<)']);
  const docRef     = get(['docRef[:\\s]+([\\d]+)', 'Documento\\s+Refer[eê]ncia[:\\s]+([\\d]+)']);

  // ── Valores ──────────────────────────────────────────────────
  const vServ      = normalizeMoney(get([
    'Valor\\s+(?:do\\s+)?Servi[cç]o[:\\s]+R?\\$?\\s*([\\d.,]+)',
    'vServ[:\\s]+([\\d.,]+)',
    'Valor\\s+Total[:\\s]+R?\\$?\\s*([\\d.,]+)',
  ]));

  const vDescIncond = normalizeMoney(get([
    'Desconto\\s+Incondicional[:\\s]+R?\\$?\\s*([\\d.,]+)',
    'Desconto[:\\s]+R?\\$?\\s*([\\d.,]+)',
    'vDescIncond[:\\s]+([\\d.,]+)',
  ]));

  const vBC        = normalizeMoney(get([
    'Base\\s+(?:de\\s+)?C[aá]lculo[:\\s]+R?\\$?\\s*([\\d.,]+)',
    'vBC[:\\s]+([\\d.,]+)',
  ]));

  const pAliq      = normalizeMoney(get([
    'Al[ií]quota[:\\s]+([\\d.,]+)\\s*%',
    'pAliqAplic[:\\s]+([\\d.,]+)',
  ]));

  const vISSQN     = normalizeMoney(get([
    'Valor\\s+(?:do\\s+)?ISS(?:QN)?[:\\s]+R?\\$?\\s*([\\d.,]+)',
    'vISSQN[:\\s]+([\\d.,]+)',
  ]));

  const vLiq       = normalizeMoney(get([
    'Valor\\s+L[ií]quido[:\\s]+R?\\$?\\s*([\\d.,]+)',
    'vLiq[:\\s]+([\\d.,]+)',
  ]));

  // IBS/CBS block
  const vBCIBS      = normalizeMoney(get(['IBSCBS[\\s\\S]{0,200}?vBC[:\\s]+([\\d.,]+)', 'Base\\s+IBS[:\\s]+R?\\$?\\s*([\\d.,]+)']));
  const pIBSUF      = normalizeMoney(get(['pIBSUF[:\\s]+([\\d.,]+)', 'Al[ií]quota\\s+IBS\\s+UF[:\\s]+([\\d.,]+)']));
  const pIBSMun     = normalizeMoney(get(['pIBSMun[:\\s]+([\\d.,]+)']));
  const pCBS        = normalizeMoney(get(['pCBS[:\\s]+([\\d.,]+)', 'Al[ií]quota\\s+CBS[:\\s]+([\\d.,]+)']));
  const vIBSTot     = normalizeMoney(get(['vIBSTot[:\\s]+([\\d.,]+)', 'Total\\s+IBS[:\\s]+R?\\$?\\s*([\\d.,]+)']));
  const vIBSUF      = normalizeMoney(get(['vIBSUF[:\\s]+([\\d.,]+)']));
  const vIBSMun     = normalizeMoney(get(['vIBSMun[:\\s]+([\\d.,]+)']));
  const vCBS        = normalizeMoney(get(['vCBS[:\\s]+([\\d.,]+)', 'Total\\s+CBS[:\\s]+R?\\$?\\s*([\\d.,]+)']));
  const vTotNF      = normalizeMoney(get(['vTotNF[:\\s]+([\\d.,]+)', 'Valor\\s+Total\\s+NF[:\\s]+R?\\$?\\s*([\\d.,]+)']));
  const cLocalidadeIncid = get(['cLocalidadeIncid[:\\s]+([\\d]{7})', 'C[oó]digo\\s+Localidade[:\\s]+([\\d]{7})']);
  const xLocalidadeIncid = get(['xLocalidadeIncid[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|<)', 'Localidade\\s+Incid[eê]ncia[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|$)']);

  // PIS/COFINS
  const vBCPis   = normalizeMoney(get(['vBCPisCofins[:\\s]+([\\d.,]+)', 'Base\\s+PIS[/\\s]*COFINS[:\\s]+R?\\$?\\s*([\\d.,]+)']));
  const pAliqPis = normalizeMoney(get(['pAliqPis[:\\s]+([\\d.,]+)', 'Al[ií]quota\\s+PIS[:\\s]+([\\d.,]+)']));
  const pAliqCof = normalizeMoney(get(['pAliqCofins[:\\s]+([\\d.,]+)', 'Al[ií]quota\\s+COFINS[:\\s]+([\\d.,]+)']));
  const vPis     = normalizeMoney(get(['vPis[:\\s]+([\\d.,]+)', 'Valor\\s+PIS[:\\s]+R?\\$?\\s*([\\d.,]+)']));
  const vCofins  = normalizeMoney(get(['vCofins[:\\s]+([\\d.,]+)', 'Valor\\s+COFINS[:\\s]+R?\\$?\\s*([\\d.,]+)']));

  // Misc metadata
  const verAplic  = get(['verAplic[:\\s]+([\\w. ]+?)(?:\\n|<)', 'Vers[aã]o\\s+Aplicativo[:\\s]+([\\w. ]+?)(?:\\n|$)']);
  const serie     = get(['[Ss][eé]rie[:\\s]+([\\d]{3})(?:\\n|\\s)', 'serie[:\\s]+([\\d]{3})']);
  const nDPS      = get(['nDPS[:\\s]+([\\d]+)', 'N[uú]mero\\s+DPS[:\\s]+([\\d]+)']);
  const cStat     = get(['cStat[:\\s]+([\\d]{3})', 'Situa[cç][aã]o[:\\s]+([\\d]{3})']);
  const dhProc    = get(['dhProc[:\\s]+([\\d]{4}-[\\d]{2}-[\\d]{2}T[\\d:+\\-]+)', 'Data\\s+Processamento[:\\s]+([\\d]{4}-[\\d]{2}-[\\d]{2}T[\\d:+\\-]+)']);
  const nDFSeParsed = nDFSe;
  const ambGer    = get(['ambGer[:\\s]+([12])', 'Ambiente[:\\s]+([12])']);
  const xNBS      = get(['xNBS[:\\s]+([A-Za-zÀ-ú ()]+?)(?:\\n|<)', 'Descri[cç][aã]o\\s+NBS[:\\s]+([A-Za-zÀ-ú ()]+?)(?:\\n|$)']);
  const cLocIncid = get(['cLocIncid[:\\s]+([\\d]{7})']);
  const xLocIncid = get(['xLocIncid[:\\s]+([A-Za-zÀ-ú ]+?)(?:\\n|<)']);
  const cIntContrib = get(['cIntContrib[:\\s]+([\\d]{10})', 'C[oó]digo\\s+Interno[:\\s]+([\\d]{10})']);
  const cIndOp    = get(['cIndOp[:\\s]+([\\d]+)']);
  const cClassTrib = get(['cClassTrib[:\\s]+([\\d]+)']);
  const CST_IBS   = get(['gIBSCBS[\\s\\S]{0,50}?CST[:\\s]+([\\d]{3})']);
  const CST_PIS   = get(['piscofins[\\s\\S]{0,50}?CST[:\\s]+([\\d]{2})']);

  // Regime tributário
  const opSimpNac  = get(['opSimpNac[:\\s]+([01])']);
  const regEspTrib = get(['regEspTrib[:\\s]+([0-9])']);

  // tpRetISSQN
  const tpRetISSQN = get(['tpRetISSQN[:\\s]+([0-9])', 'Reten[cç][aã]o\\s+ISS[:\\s]+([01])']);
  const tpRetPisCofins = get(['tpRetPisCofins[:\\s]+([0-9])']);

  return {
    // Identification
    nNFSe, nDFSe: nDFSeParsed, nDPS, chaveAcesso, dhEmi, dCompet,
    xLocEmi, xLocPrestacao, cLocIncid, xLocIncid,
    // Status / meta
    verAplic, ambGer: ambGer || '2', cStat: cStat || '100', dhProc,
    tpEmis: '1', procEmi: '1', serie: serie || '001', tpEmit: '1',
    // Emitente
    emitCNPJ, emitNome, emitLgr, emitNro, emitBairro,
    emitCEP: normalizeCEP(emitCEP), emitMun, emitUF, emitFone,
    emitEmail, emitCMun,
    // Tomador
    tomaCNPJ, tomaNome, tomaLgr, tomaNro, tomaBairro,
    tomaCEP: normalizeCEP(tomaCEP), tomaMun, tomaUF, tomaFone,
    tomaEmail, tomaCMun,
    // Serviço
    xDescServ, cTribNac, cNBS, xTribNac, xNBS, cIntContrib,
    cLocPrestacao, xInfComp, docRef: docRef || '0000000000',
    // Valores ISS
    vServ, vDescIncond, vBC, pAliq, vISSQN, vLiq,
    // IBS/CBS
    vBCIBS, pIBSUF, pIBSMun, pCBS,
    vIBSTot, vIBSUF, vIBSMun, vCBS, vTotNF,
    cLocalidadeIncid, xLocalidadeIncid,
    // PIS/COFINS
    vBCPis, pAliqPis, pAliqCof, vPis, vCofins,
    CST_PIS: CST_PIS || '01', tpRetPisCofins: tpRetPisCofins || '2',
    // Regime
    opSimpNac: opSimpNac || '1', regEspTrib: regEspTrib || '0',
    tpRetISSQN: tpRetISSQN || '1',
    // IBS class
    cIndOp: cIndOp || '100301', cClassTrib: cClassTrib || '000001', CST_IBS: CST_IBS || '000',
  };
}

// ─── XML builder ─────────────────────────────────────────────────
/*
  Follows the NFSe v1.01 schema from sped.fazenda.gov.br/nfse.
  Only fields present in the reference XML are generated.
  Missing optional fields are omitted gracefully.
*/
function buildXML(d) {
  const e = xmlEscape;

  // Build the chave / Id attributes
  const idNFS = d.chaveAcesso
    ? `NFS${d.chaveAcesso}`
    : `NFS${d.emitCNPJ}${d.nNFSe || '0'}`;

  const dpsLocation = d.emitCMun || d.cLocIncid || (d.chaveAcesso || '').substring(0, 7);
  const dpsInscriptionType = d.emitCNPJ ? '2' : '1';
  const dpsSerie = String(d.serie || '1').replace(/\D/g, '').padStart(5, '0');
  const dpsNumber = String(d.nDPS || d.nNFSe || '0').replace(/\D/g, '').padStart(15, '0');
  const idDPS = dpsLocation && d.emitCNPJ
    ? `DPS${dpsLocation}${dpsInscriptionType}${d.emitCNPJ}${dpsSerie}${dpsNumber}`
    : `DPS${d.emitCNPJ}${dpsNumber}`;

  // Convert date dd/mm/yyyy → yyyy-mm-dd if needed
  const dhEmi  = toISODate(d.dhEmi);
  const dhProc = d.dhProc || dhEmi;
  const dComp  = toCompetDate(d.dCompet || d.dhEmi);

  // Construct node helpers
  const opt = (tag, val) => val ? `<${tag}>${e(val)}</${tag}>` : '';

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="${e(idNFS)}">
    ${opt('xLocEmi', d.xLocEmi)}
    ${opt('xLocPrestacao', d.xLocPrestacao)}
    ${opt('nNFSe', d.nNFSe)}
    ${opt('cLocIncid', d.cLocIncid)}
    ${opt('xLocIncid', d.xLocIncid)}
    ${opt('xTribNac', d.xTribNac)}
    ${opt('xNBS', d.xNBS)}
    ${opt('verAplic', d.verAplic)}
    <ambGer>${d.ambGer}</ambGer>
    <tpEmis>${d.tpEmis}</tpEmis>
    <procEmi>${d.procEmi}</procEmi>
    <cStat>${d.cStat}</cStat>
    ${opt('dhProc', dhProc)}
    ${opt('nDFSe', d.nDFSe)}
    <emit>
      ${opt('CNPJ', d.emitCNPJ)}
      ${opt('xNome', d.emitNome)}
      <enderNac>
        ${opt('xLgr', d.emitLgr)}
        ${opt('nro', d.emitNro)}
        ${opt('xBairro', d.emitBairro)}
        ${opt('cMun', d.emitCMun)}
        ${opt('UF', d.emitUF)}
        ${opt('CEP', d.emitCEP)}
      </enderNac>
      ${opt('fone', d.emitFone)}
      ${opt('email', d.emitEmail)}
    </emit>
    <valores>
      ${opt('vBC', d.vBC)}
      ${opt('pAliqAplic', d.pAliq)}
      ${opt('vISSQN', d.vISSQN)}
      ${opt('vLiq', d.vLiq)}
    </valores>
    ${buildIBSCBS(d, opt)}
    <DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
      <infDPS Id="${e(idDPS)}">
        <tpAmb>1</tpAmb>
        ${opt('dhEmi', dhEmi)}
        ${opt('verAplic', d.verAplic)}
        ${opt('serie', d.serie)}
        ${opt('nDPS', d.nDPS || d.nNFSe)}
        ${opt('dCompet', dComp)}
        <tpEmit>${d.tpEmit}</tpEmit>
        ${opt('cLocEmi', d.emitCMun)}
        <prest>
          ${opt('CNPJ', d.emitCNPJ)}
          ${opt('fone', d.emitFone)}
          ${opt('email', d.emitEmail)}
          <regTrib>
            <opSimpNac>${d.opSimpNac}</opSimpNac>
            <regEspTrib>${d.regEspTrib}</regEspTrib>
          </regTrib>
        </prest>
        <toma>
          ${opt('CNPJ', d.tomaCNPJ)}
          ${opt('xNome', d.tomaNome)}
          <end>
            <endNac>
              ${opt('cMun', d.tomaCMun)}
              ${opt('CEP', d.tomaCEP)}
            </endNac>
            ${opt('xLgr', d.tomaLgr)}
            ${opt('nro', d.tomaNro)}
            ${opt('xBairro', d.tomaBairro)}
          </end>
          ${opt('fone', d.tomaFone)}
          ${opt('email', d.tomaEmail)}
        </toma>
        <serv>
          <locPrest>
            ${opt('cLocPrestacao', d.cLocPrestacao)}
          </locPrest>
          <cServ>
            ${opt('cTribNac', d.cTribNac)}
            ${opt('xDescServ', d.xDescServ)}
            ${opt('cNBS', d.cNBS)}
            ${opt('cIntContrib', d.cIntContrib)}
          </cServ>
          ${d.xInfComp || d.docRef ? `
          <infoCompl>
            ${opt('docRef', d.docRef)}
            ${opt('xInfComp', d.xInfComp)}
          </infoCompl>` : ''}
        </serv>
        <valores>
          <vServPrest>
            ${opt('vServ', d.vServ)}
          </vServPrest>
          ${d.vDescIncond ? `<vDescCondIncond><vDescIncond>${e(d.vDescIncond)}</vDescIncond></vDescCondIncond>` : ''}
          <trib>
            <tribMun>
              <tribISSQN>1</tribISSQN>
              <tpRetISSQN>${d.tpRetISSQN}</tpRetISSQN>
            </tribMun>
            ${buildPisCofins(d, opt)}
            <totTrib>
              <vTotTrib>
                <vTotTribFed>0.00</vTotTribFed>
                <vTotTribEst>0.00</vTotTribEst>
                <vTotTribMun>0.00</vTotTribMun>
              </vTotTrib>
            </totTrib>
          </trib>
        </valores>
        <IBSCBS>
          <finNFSe>0</finNFSe>
          ${opt('cIndOp', d.cIndOp)}
          <indDest>0</indDest>
          <valores>
            <trib>
              <gIBSCBS>
                <CST>${e(d.CST_IBS)}</CST>
                ${opt('cClassTrib', d.cClassTrib)}
              </gIBSCBS>
            </trib>
          </valores>
        </IBSCBS>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;

  // Clean up blank lines from missing optional fields
  return xml.replace(/^\s*\n/gm, '').replace(/  \n/g, '');
}

function buildIBSCBS(d, opt) {
  if (!d.vBCIBS && !d.vIBSTot && !d.vCBS) return '';
  return `<IBSCBS>
      ${opt('cLocalidadeIncid', d.cLocalidadeIncid)}
      ${opt('xLocalidadeIncid', d.xLocalidadeIncid)}
      <valores>
        ${opt('vBC', d.vBCIBS)}
        <vCalcReeRepRes>0.00</vCalcReeRepRes>
        <uf>
          ${opt('pIBSUF', d.pIBSUF)}
          ${opt('pAliqEfetUF', d.pIBSUF)}
        </uf>
        <mun>
          ${opt('pIBSMun', d.pIBSMun)}
          ${opt('pAliqEfetMun', d.pIBSMun)}
        </mun>
        <fed>
          ${opt('pCBS', d.pCBS)}
          ${opt('pAliqEfetCBS', d.pCBS)}
        </fed>
      </valores>
      <totCIBS>
        ${opt('vTotNF', d.vTotNF)}
        <gIBS>
          ${opt('vIBSTot', d.vIBSTot)}
          <gIBSUFTot>${opt('vIBSUF', d.vIBSUF)}</gIBSUFTot>
          <gIBSMunTot>${opt('vIBSMun', d.vIBSMun || '0.00')}</gIBSMunTot>
        </gIBS>
        <gCBS>${opt('vCBS', d.vCBS)}</gCBS>
      </totCIBS>
    </IBSCBS>`;
}

function buildPisCofins(d, opt) {
  if (!d.vBCPis && !d.pAliqPis) return '';
  return `<tribFed>
              <piscofins>
                <CST>${xmlEscape(d.CST_PIS)}</CST>
                ${opt('vBCPisCofins', d.vBCPis)}
                ${opt('pAliqPis', d.pAliqPis)}
                ${opt('pAliqCofins', d.pAliqCof)}
                ${opt('vPis', d.vPis)}
                ${opt('vCofins', d.vCofins)}
                <tpRetPisCofins>${d.tpRetPisCofins}</tpRetPisCofins>
              </piscofins>
            </tribFed>`;
}

// ─── Preview renderer ─────────────────────────────────────────────
function renderPreview(d) {
  const sections = [
    { title: 'Identificação', fields: [
      ['Número NFS-e', d.nNFSe], ['Número DPS', d.nDPS], ['Número DFSe', d.nDFSe],
      ['Data de Emissão', d.dhEmi], ['Competência', d.dCompet],
      ['Loc. Emissão', d.xLocEmi], ['Loc. Prestação', d.xLocPrestacao],
    ]},
    { title: 'Prestador (Emitente)', fields: [
      ['CNPJ', fmtCNPJ(d.emitCNPJ)], ['Nome', d.emitNome],
      ['Logradouro', d.emitLgr], ['Número', d.emitNro],
      ['Bairro', d.emitBairro], ['CEP', d.emitCEP],
      ['Município', d.emitMun], ['UF', d.emitUF],
      ['Telefone', d.emitFone], ['E-mail', d.emitEmail],
    ]},
    { title: 'Tomador', fields: [
      ['CNPJ', fmtCNPJ(d.tomaCNPJ)], ['Nome', d.tomaNome],
      ['Logradouro', d.tomaLgr], ['Número', d.tomaNro],
      ['Bairro', d.tomaBairro], ['CEP', d.tomaCEP],
      ['Município', d.tomaMun], ['UF', d.tomaUF],
      ['Telefone', d.tomaFone], ['E-mail', d.tomaEmail],
    ]},
    { title: 'Serviço', fields: [
      ['Descrição', d.xDescServ], ['Cód. Tributação', d.cTribNac],
      ['NBS', d.cNBS], ['Tipo Trib.', d.xTribNac],
    ]},
    { title: 'Valores', fields: [
      ['Valor Serviço', fmtMoney(d.vServ)], ['Desconto', fmtMoney(d.vDescIncond)],
      ['Base de Cálculo', fmtMoney(d.vBC)], ['Alíquota ISS', d.pAliq ? d.pAliq + '%' : ''],
      ['ISSQN', fmtMoney(d.vISSQN)], ['Valor Líquido', fmtMoney(d.vLiq)],
    ]},
  ];

  dataPreview.innerHTML = sections.map(sec => `
    <div class="data-section-title">${sec.title}</div>
    ${sec.fields.map(([label, value]) => `
      <div class="data-item">
        <span class="label">${label}</span>
        <span class="value ${value ? '' : 'missing'}">${value || 'Não encontrado'}</span>
      </div>`).join('')}
  `).join('');
}

// ─── Download ─────────────────────────────────────────────────────
function downloadXML() {
  const xml      = downloadBtn.dataset.xml;
  const filename = downloadBtn.dataset.filename || 'nfse.xml';
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function deriveFilename(d) {
  const cnpj = (d.emitCNPJ || '').replace(/\D/g, '');
  const num  = d.nNFSe || d.nDPS || 'nfse';
  return `nfse_${cnpj}_${num}.xml`;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Keep phone values XML-safe: only digits are accepted by most NFS-e layouts. */
function formatPhone(s) {
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  return d;
}

/** Remove formatting from CNPJ and return 14 digits */
function normalizeCNPJ(s) {
  if (!s) return '';
  return s.replace(/\D/g, '').substring(0, 14);
}

/** Remove formatting from CEP and return 8 digits */
function normalizeCEP(s) {
  if (!s) return '';
  return s.replace(/\D/g, '').substring(0, 8);
}

/**
 * Convert Brazilian money string to dot-decimal string.
 * "18.340,72" → "18340.72"   "18340.72" → "18340.72"
 */
function normalizeMoney(s) {
  if (!s) return '';
  s = s.replace(/[^\d,.-]/g, '').trim();
  if (!s || s === '-') return '';
  // If there's a comma it's the decimal separator (BR format)
  if (s.includes(',')) {
    return s.replace(/\./g, '').replace(',', '.');
  }
  return s;
}

function fmtMoney(s) {
  if (!s) return '';
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCNPJ(s) {
  if (!s || s.length < 14) return s || '';
  return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function xmlEscape(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert "dd/mm/yyyy hh:mm" or "dd/mm/yyyy" to ISO-8601.
 * If already ISO, return as-is.
 */
function toISODate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s; // already ISO
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/);
  if (!m) return s;
  const [, dd, mm, yyyy, time] = m;
  return `${yyyy}-${mm}-${dd}T${time || '00:00:00'}-03:00`;
}

/**
 * Derive dCompet (yyyy-mm-dd) from a competência "mm/yyyy" or date string.
 */
function toCompetDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const mmYYYY = s.match(/^(\d{2})\/(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}-01`;
  const ddMM   = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (ddMM)   return `${ddMM[3]}-${ddMM[2]}-${ddMM[1]}`;
  return s;
}

// ─── UI state ─────────────────────────────────────────────────────
function showProgress(pct, msg) {
  progress.classList.remove('hidden');
  progressFill.style.width = pct + '%';
  progressText.textContent = msg;
}

function showError(msg) {
  progress.classList.add('hidden');
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function reset() {
  errorBox.classList.add('hidden');
  results.classList.add('hidden');
  progress.classList.add('hidden');
  progressFill.style.width = '0%';
  dataPreview.innerHTML = '';
  xmlOutput.textContent = '';
}
