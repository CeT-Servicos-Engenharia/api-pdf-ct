// generate-pdf.js (CommonJS) — Mantendo o nome antigo: generateBoilerPdf
// Agora com busca robusta do template (templates/, assets/, public/, ENV TEMPLATE_PATH) e mensagens claras.
// deps: pdf-lib, sharp, axios, firebase-admin

const fs = require('fs').promises
const fssync = require('fs')
const path = require('path')
const axios = require('axios')
const sharp = require('sharp')
const admin = require('./lib/firebase-admin.js')
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')

/**
 * generateBoilerPdf(projectId, opts)
 * @param {string} projectId
 * @param {Object} opts
 * @param {string} [opts.templatePath] caminho do PDF base
 * @param {Uint8Array|Buffer} [opts.templateBytes]
 * @param {string} [opts.companyLogoPath] caminho da logo local (PNG/JPG)
 * @param {boolean} [opts.addPageNumbers=false] se true, desenha rodapé "X / Y"
 * @returns {Promise<Buffer>}
 */
async function generateBoilerPdf(projectId, opts = {}) {
  const {
    templatePath,
    templateBytes,
    companyLogoPath = 'assets/logo.png',
    addPageNumbers = false // por padrão desliga (muitos templates já trazem numeração)
  } = opts

  // 1) Carrega template (bytes > caminho explícito > ENV > locais padrão)
  const baseBytes =
    templateBytes ||
    await readFirstExisting([
      templatePath,
      process.env.TEMPLATE_PATH,
      path.resolve(process.cwd(), 'templates', 'relatorio.pdf'),
      path.resolve(process.cwd(), 'assets', 'relatorio.pdf'),
      path.resolve(process.cwd(), 'public', 'relatorio.pdf')
    ])

  const baseDoc = await PDFDocument.load(baseBytes)

  // 2) Doc de saída: clona páginas do template
  const outDoc = await PDFDocument.create()
  const pages = await outDoc.copyPages(baseDoc, baseDoc.getPageIndices())
  pages.forEach(p => outDoc.addPage(p))

  // 3) Fontes
  const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold)

  // 4) Utils
  const utils = makeUtils({ pdfDoc: outDoc, fontRegular, fontBold })

  // 5) Dados do projeto (mínimo). TROQUE pela sua leitura real.
  const data = await getProjectData(projectId)

  // ===== Página 1: Cabeçalho + dados principais =====
  if (outDoc.getPageCount() >= 1) {
    const p1 = outDoc.getPage(0)

    // Logo da empresa (local)
    try {
      const companyLogoAbs = path.resolve(process.cwd(), companyLogoPath)
      const companyLogoBytes = await fs.readFile(companyLogoAbs)
      const img = await utils.tryEmbed(outDoc, companyLogoBytes)
      p1.drawImage(img, { x: 50, y: 760, width: 80, height: 80 })
    } catch {}

    // Logo do cliente (gs:// ou http)
    const client = data.client || {}
    if (client.logo) {
      const clientLogoBytes = await downloadBytes(client.logo)
      if (clientLogoBytes) {
        const img = await utils.tryEmbed(outDoc, clientLogoBytes)
        p1.drawImage(img, { x: 595 - 50 - 80, y: 760, width: 80, height: 80 })
      }
    }

    // Cabeçalho simples (ajuste conforme template)
    utils.drawText(p1, 'Cleonis Batista Santos', 230, 820, { size: 10, font: fontBold })
    utils.drawText(p1, 'Avenida Sábia Q:30 L:27, 27, CEP 75904-370', 170, 808, { size: 10 })
    utils.drawText(p1, '(64) 99244-2480, engenheiro@gmail.com', 190, 796, { size: 10 })

    // Campos principais
    utils.drawValue(p1, safe(data.tipoEquipamento), { x: 115, y: 700, style: { size: 18, font: fontBold } })
    utils.drawValue(p1, safe(data.nomeEquipamento), { x: 115, y: 675, style: { size: 12 } })
    utils.drawValue(p1, safe(data.numeroSerie),     { x: 115, y: 660, style: { size: 12 } })
    utils.drawValue(p1, safe(data.fabricante),      { x: 115, y: 645, style: { size: 12 } })

    // Bloco do cliente
    utils.drawValue(p1, safe(client.person),                                     { x: 50, y: 610, style: { size: 11, font: fontBold } })
    utils.drawValue(p1, `${safe(client.address)} CEP: ${safe(client.cep)}`,      { x: 50, y: 596, style: { size: 10 } })
    utils.drawValue(p1, `CNPJ: ${safe(client.cnpj)}`,                            { x: 50, y: 582, style: { size: 10 } })
    utils.drawValue(p1, `FONE: ${safe(client.phone)}`,                           { x: 50, y: 568, style: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p1, 1, outDoc.getPageCount())
  }

  // ===== Página 2: Cadastrais / Responsáveis / Revisão / Inspeções =====
  if (outDoc.getPageCount() >= 2) {
    const p2 = outDoc.getPage(1)
    const cliente = data.client || {}
    const engenheiro = data.engenheiro || {}
    const analista = data.analista || {}

    utils.drawMultiline(p2, uniqueParagraphs(formatBlock([
      safe(cliente.person),
      joinAddr(cliente),
      `CEP: ${safe(cliente.cep)}`,
      `CNPJ: ${safe(cliente.cnpj)}`,
      `TEL.: ${safe(cliente.phone)}`,
      `E-mail: ${safe(cliente.email)}`
    ])), { x: 50, y: 700, maxWidth: 240, style: { size: 10 } })

    utils.drawMultiline(p2, uniqueParagraphs(formatBlock([
      safe(engenheiro.name),
      joinAddr(engenheiro),
      `CEP: ${safe(engenheiro.cep)}`,
      `CNPJ: ${safe(engenheiro.cnpj)}`,
      `CREA: ${safeCREA(engenheiro.crea)}`,
      `TEL.: ${safe(engenheiro.phone)}`,
      `E-mail: ${safe(engenheiro.email)}`
    ])), { x: 320, y: 700, maxWidth: 240, style: { size: 10 } })

    utils.drawMultiline(p2, uniqueParagraphs(formatBlock([
      safe(analista.name),
      `E-mail: ${safe(analista.email)}`
    ])), { x: 50, y: 590, maxWidth: 240, style: { size: 10 } })

    utils.drawMultiline(p2, uniqueParagraphs(formatBlock([
      safe(engenheiro.name),
      `CREA: ${safeCREA(engenheiro.crea)}`
    ])), { x: 320, y: 590, maxWidth: 240, style: { size: 10 } })

    utils.drawRow(p2, [
      safe(data.numeroProjeto),
      safe(data.descricaoRevisao),
      safe(analista.name),
      formatDate(data.inspection?.endDate)
    ], { x: 50, y: 520, colW: 120, style: { size: 10 } })

    const tipos = [
      data.inspection?.selectedTypesInspection?.extraordinaria && 'Extraordinária',
      data.inspection?.selectedTypesInspection?.inicial && 'Inicial',
      data.inspection?.selectedTypesInspection?.periodica && 'Periódica'
    ].filter(Boolean).join(', ')
    const caract = [
      data.inspection?.selectedPeriodicInspection?.externa && 'Externa',
      data.inspection?.selectedPeriodicInspection?.interna && 'Interna',
      data.inspection?.selectedPeriodicInspection?.hidrostatico && 'Hidrostático'
    ].filter(Boolean).join(', ')

    utils.drawRow(p2, [
      tipos,
      caract,
      formatDate(data.inspection?.startDate),
      formatDate(data.inspection?.endDate)
    ], { x: 50, y: 490, colW: 120, style: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p2, 2, outDoc.getPageCount())
  }

  // ===== Página 3: Grid de imagens + tabela de gerais =====
  if (outDoc.getPageCount() >= 3) {
    const p3 = outDoc.getPage(2)

    const imgs = await baixarEComprimirTodasImagens(data.images)
    await utils.drawImageGrid(
      p3,
      imgs.map(i => i.buffer),
      { x: 50, y: 720, cols: 3, cellW: 161.5, cellH: 150, gap: 5 }
    )

    utils.drawKeyValueTable(p3, [
      ['TIPO', safe(data.tipoEquipamento)],
      ['TIPO DA CALDEIRA', safe(data.tipoCaldeira)],
      ['NÚMERO DE SÉRIE', safe(data.numeroSerie)],
      ['ANO DE FABRICAÇÃO', safe(data.anoFabicacao || data.anoFabricacao || '')],
      ['PMTA', unit(data.pressaoMaxima, data.unidadePressaoMaxima || 'kgf/cm²')],
      ['PTHF', unit(data.pressaoTeste, data.unidadePressaoMaxima || 'kgf/cm²')],
      ['CAPACIDADE DE PRODUÇÃO DE VAPOR (CPV)', safe(data.capacidadeProducaoVapor)],
      ['ÁREA DA SUPERFÍCIE DE AQUECIMENTO (ASA)', safe(data.areaSuperficieAquecimento)],
      ['CÓDIGO DO PROJETO / ANO DE EDIÇÃO', `${safe(data.codProjeto)} / ${safe(data.anoEdicao)}`],
      ['LOCAL DE INSTALAÇÃO', safe(data.localInstalacao)]
    ], { x: 50, y: 300, keyW: 260, valW: 260, rowH: 20, styleKey: { size: 10 }, styleVal: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p3, 3, outDoc.getPageCount())
  }

  // ===== Página 4: Categorização / Operação =====
  if (outDoc.getPageCount() >= 4) {
    const p4 = outDoc.getPage(3)

    utils.drawKeyValueTable(p4, [
      ['TEMPERATURA DE PROJETO', unit(data.temperaturaProjeto, '°C')],
      ['TEMPERATURA DE TRABALHO', unit(data.temperaturaTrabalho, '°C')],
      ['VOLUME', safe(data.volume)],
      ['CATEGORIA', safe(data.categoriaCaldeira)]
    ], { x: 50, y: 670, keyW: 260, valW: 260, rowH: 20, styleKey: { size: 10 }, styleVal: { size: 10 } })

    utils.drawKeyValueTable(p4, [
      ['COMBUSTÍVEL PRINCIPAL', safe(data.combustivelPrincipal)],
      ['COMBUSTÍVEL AUXILIAR', safe(data.combustivelAuxiliar)],
      ['REGIME DE TRABALHO', fixAccents(safe(data.regimeTrabalho))],
      ['TIPO DE OPERAÇÃO', fixAccents(safe(data.tipoOperacao))]
    ], { x: 50, y: 560, keyW: 260, valW: 260, rowH: 20, styleKey: { size: 10 }, styleVal: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p4, 4, outDoc.getPageCount())
  }

  const bytes = await outDoc.save()
  return Buffer.from(bytes)
}

/* ====================== Implementação mínima – TROQUE POR SUA REAL ====================== */
async function getProjectData(projectId) {
  // TODO: substituir por leitura real do seu banco usando projectId
  return {
    tipoEquipamento: 'CALDEIRA',
    nomeEquipamento: 'Modelo X',
    numeroSerie: 'S/N-123',
    fabricante: 'Fabricante ABC',
    client: {
      person: 'Cliente Exemplo',
      address: 'Rua A, 123 - Setor Centro',
      cep: '75000-000',
      cnpj: '00.000.000/0001-00',
      phone: '(62) 99999-9999',
      // logo: 'gs://SEU_BUCKET/pasta/logo-cliente.png'
    },
    inspection: {
      selectedTypesInspection: { inicial: true, periodica: false, extraordinaria: false },
      selectedPeriodicInspection: { externa: true, interna: false, hidrostatico: false },
      startDate: new Date(),
      endDate: new Date()
    },
    images: [],
    tipoCaldeira: '',
    anoFabricacao: '',
    pressaoMaxima: '',
    unidadePressaoMaxima: 'kgf/cm²',
    pressaoTeste: '',
    capacidadeProducaoVapor: '',
    areaSuperficieAquecimento: '',
    codProjeto: '',
    anoEdicao: '',
    localInstalacao: '',
    temperaturaProjeto: '',
    temperaturaTrabalho: '',
    volume: '',
    categoriaCaldeira: '',
    combustivelPrincipal: '',
    combustivelAuxiliar: '',
    regimeTrabalho: 'Contínuo',
    tipoOperacao: 'Automática',
    numeroProjeto: '',
    descricaoRevisao: '',
    engenheiro: { name: '', crea: '', address: '', neighborhood: '', number: '', cep: '', cnpj: '', phone: '', email: '' },
    analista: { name: '', email: '' }
  }
}

/* ====================== Helpers de arquivo ====================== */
async function readFirstExisting(paths) {
  const tried = []
  for (const p of paths) {
    if (!p) continue
    try {
      const abs = path.resolve(process.cwd(), p)
      if (fssync.existsSync(abs)) {
        return await fs.readFile(abs)
      }
      tried.push(abs)
    } catch (e) {
      tried.push(String(p))
    }
  }
  const msg = [
    'Template PDF não encontrado. Tente colocar seu modelo em um destes caminhos:',
    ...tried.map(x => ` - ${x}`),
    'Ou defina TEMPLATE_PATH no ambiente, ou passe templateBytes.'
  ].join('\n')
  throw new Error(msg)
}

/* ====================== Utils de desenho ====================== */
function makeUtils ({ pdfDoc, fontRegular, fontBold }) {
  function drawText (page, text, x, y, opts = {}) {
    const { font = fontRegular, size = 10, color = rgb(0, 0, 0) } = opts
    if (text == null) return
    page.drawText(String(text), { x, y, size, font, color })
  }
  function drawWrapped (page, text, x, y, maxWidth, opts = {}) {
    const { font = fontRegular, size = 10, color = rgb(0, 0, 0), lineHeight = 1.2 } = opts
    if (text == null) return { lastY: y }
    const words = String(text).split(/\s+/)
    const lines = []
    let line = ''
    while (words.length) {
      const test = line ? line + ' ' + words[0] : words[0]
      const w = font.widthOfTextAtSize(test, size)
      if (w > maxWidth && line) { lines.push(line); line = '' } else { line = test; words.shift() }
    }
    if (line) lines.push(line)
    let cy = y
    for (const ln of lines) { page.drawText(ln, { x, y: cy, size, font, color }); cy -= size * lineHeight }
    return { lastY: cy }
  }
  async function tryEmbed (doc, bytes) { try { return await doc.embedPng(bytes) } catch { return await doc.embedJpg(bytes) } }
  async function drawImage (page, bytes, { x, y, width, height, w, h }) {
    if (!bytes) return
    const img = await tryEmbed(pdfDoc, bytes)
    page.drawImage(img, { x, y, width: width ?? w, height: height ?? h })
  }
  async function drawImageGrid (page, buffers, cfg) {
    if (!cfg) return
    const { x, y, cols = 3, cellW, cellH, gap = 5 } = cfg
    let cx = x, cy = y
    const total = Math.min(buffers.length, cols * 2)
    for (let i = 0; i < total; i++) {
      const b = buffers[i]
      if (b) await drawImage(page, b, { x: cx, y: cy - cellH, w: cellW, h: cellH })
      cx += cellW + gap
      if ((i + 1) % cols === 0) { cx = x; cy -= (cellH + gap) }
    }
  }
  function drawValue (page, value, cfg) {
    if (!cfg) return
    const txt = fixAccents(value)
    if (cfg.maxWidth) return drawWrapped(page, txt, cfg.x, cfg.y, cfg.maxWidth, cfg.style)
    return drawText(page, txt, cfg.x, cfg.y, cfg.style)
  }
  function drawRow (page, values, cfg) {
    const { x, y, colW, style } = cfg
    let cx = x
    values.forEach(v => { drawWrapped(page, fixAccents(v), cx, y, colW, style); cx += colW })
  }
  function drawKeyValueTable (page, rows, cfg) {
    const { x, y, keyW, valW, rowH, styleKey, styleVal } = cfg
    let cy = y
    rows.forEach(([k, v]) => {
      const key = fixAccents(String(k || ''))
      const val = fixAccents(String(v || ''))
      drawWrapped(page, key, x + 4, cy - 4, keyW - 8, { ...styleKey })
      drawWrapped(page, val, x + keyW + 4, cy - 4, valW - 8, { ...styleVal })
      page.drawRectangle({ x, y: cy - rowH, width: keyW, height: rowH, borderWidth: 1, borderColor: rgb(0.1,0.2,0.4) })
      page.drawRectangle({ x: x + keyW, y: cy - rowH, width: valW, height: rowH, borderWidth: 1, borderColor: rgb(0.1,0.2,0.4) })
      cy -= rowH
    })
  }
  function pageNumber (page, idx, total) {
    const label = `${idx} / ${total}`
    const size = 9
    const width = fontRegular.widthOfTextAtSize(label, size)
    page.drawText(label, { x: page.getWidth() - 20 - width, y: 18, size, font: fontRegular, color: rgb(0.2,0.2,0.2) })
  }
  return { drawText, drawWrapped, tryEmbed, drawImage, drawImageGrid, drawValue, drawRow, drawKeyValueTable, pageNumber }
}

/* ====================== Utils gerais ====================== */
function safe (x) { return x == null ? '' : String(x) }
function n (x) { return (x ?? '') === '' ? '' : String(x).replace('.', ',') }
function unit (val, u) {
  if (val == null || val === '') return ''
  const unitStr = u ? String(u).replace(/kgf\/cm2|Kgf\/cm2|kgfcm2/gi, 'kgf/cm²') : ''
  return unitStr ? `${n(val)} ${unitStr}` : n(val)
}
function formatBlock (lines = []) { return lines.filter(Boolean).join('\n') }
function uniqueParagraphs(text) {
  const lines = String(text || '').split(/\n+/)
  const seen = new Set()
  return lines.filter(l => {
    const k = l.trim()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  }).join('\n')
}
function joinAddr (o = {}) {
  const parts = [o.address, o.neighborhood, o.number].filter(Boolean)
  return parts.join(', ')
}
function safeCREA(crea) {
  const c = safe(crea).toUpperCase().replace(/\s+/g, '')
  return c.startsWith('CREA') ? c : c
}
function formatDate (s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(+d)) return String(s)
  const dd = String(d.getDate()).padStart(2,'0')
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
function fixAccents(s='') {
  return String(s)
    .replace(/\bCONTINUO\b/gi, 'CONTÍNUO')
    .replace(/\bCONTINUA\b/gi, 'CONTÍNUA')
    .replace(/OPRACAO/gi, 'OPERAÇÃO')
    .replace(/INSPECOES\s+CONTARTADAS/gi, 'INSPEÇÕES CONTRATADAS')
}

/* ====================== Baixar imagens (URL/Firebase) ====================== */
async function downloadBytes (urlOrGs) {
  try {
    if (!urlOrGs) return null
    if (/^https?:\/\//i.test(urlOrGs)) {
      const r = await axios.get(urlOrGs, { responseType: 'arraybuffer' })
      return Buffer.from(r.data)
    }
    const storage = admin.storage()
    let bucket = storage.bucket()
    let filePath = urlOrGs
    const m = typeof urlOrGs === 'string' ? urlOrGs.match(/^gs:\/\/([^/]+)\/(.+)$/i) : null
    if (m) { const [, bucketName, p] = m; bucket = storage.bucket(bucketName); filePath = p }
    else if (filePath.startsWith('/')) { filePath = filePath.slice(1) }
    const [buffer] = await bucket.file(filePath).download()
    return buffer
  } catch { return null }
}
async function baixarEComprimirTodasImagens (urls) {
  try {
    if (!Array.isArray(urls)) return []
    const list = urls.map(u => (typeof u === 'string' ? u : (u && (u.url || u.path || u.src)) || null)).filter(Boolean)
    const out = []
    for (const u of list) {
      try {
        const b = await downloadBytes(u)
        if (!b) continue
        const jpg = await sharp(b).rotate().resize({ width: 1000, withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer()
        out.push({ buffer: jpg, url: u })
      } catch {}
    }
    return out
  } catch { return [] }
}

module.exports = { generateBoilerPdf }
