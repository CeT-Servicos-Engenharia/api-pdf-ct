// generation.js  (substitui o antigo)
// Gera PDF a partir de um PDF-base (template) e sobrepõe dados.
// Cabeçalho com logo própria + logo do cliente (Firebase / URL), dados do cliente,
// e campos principais do relatório.
//
// Requisitos:
//  - "type": "module" no package.json (ESM)
//  - deps: pdf-lib, sharp, axios, firebase-admin
//  - arquivo do template PDF acessível no filesystem (ex.: templates/relatorio.pdf)
//  - vercel.json deve incluir o template em "includeFiles"

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import sharp from 'sharp'
import admin from './lib/firebase-admin.js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Gera o PDF.
 * @param {Object} data           // payload com variáveis reais
 * @param {Object} [opts]
 * @param {string} [opts.templatePath]    // caminho do PDF template (ex.: templates/relatorio.pdf)
 * @param {Uint8Array|Buffer} [opts.templateBytes] // bytes do template, se já estiver carregado
 * @param {string} [opts.companyLogoPath] // caminho local da logo da empresa (PNG/JPG)
 * @param {boolean} [opts.addPageNumbers=true]
 * @returns {Promise<Uint8Array>}
 */
export async function generatePdf (data = {}, opts = {}) {
  const {
    templatePath,
    templateBytes,
    companyLogoPath = 'assets/CET LOGO - TRANSPARENCIA.png',
    addPageNumbers = true
  } = opts

  // 1) Carrega o PDF template
  const baseBytes = templateBytes || await fs.readFile(assertTemplatePath(templatePath))
  const baseDoc = await PDFDocument.load(baseBytes)

  // 2) Cria doc de saída clonando as páginas do template (mantém 100% do layout)
  const outDoc = await PDFDocument.create()
  const pages = await outDoc.copyPages(baseDoc, baseDoc.getPageIndices())
  pages.forEach(p => outDoc.addPage(p))

  // 3) Fontes
  const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold)

  // 4) Utils
  const utils = makeUtils({ pdfDoc: outDoc, fontRegular, fontBold })
  const layout = buildLayoutConfig() // coordenadas centralizadas aqui (fácil ajuste)

  // 5) Cabeçalho (Página 1) — baseado no seu template.js (logo empresa + logo cliente + textos)
  if (outDoc.getPageCount() >= 1) {
    const p1 = outDoc.getPage(0)

    // Logo da empresa (local no repo)
    const companyLogoAbs = path.resolve(process.cwd(), companyLogoPath)
    try {
      const companyLogoBytes = await fs.readFile(companyLogoAbs)
      const img = await tryEmbed(outDoc, companyLogoBytes)
      // Coordenadas em A4 (595 x 842 pt) — canto sup. esq.
      p1.drawImage(img, { x: 50, y: 760, width: 80, height: 80 })
    } catch (e) {
      console.warn('Logo da empresa não encontrada:', companyLogoAbs, e.message)
    }

    // Logo do cliente (se houver), via Firebase Storage (gs://) ou URL http(s)
    const client = data.client || {}
    if (client.logo) {
      const clientLogoBytes = await downloadBytes(client.logo)
      if (clientLogoBytes) {
        const img = await tryEmbed(outDoc, clientLogoBytes)
        // canto sup. dir.
        p1.drawImage(img, { x: 595 - 50 - 80, y: 760, width: 80, height: 80 })
      }
    }

    // Textos do cabeçalho (nome/contato da empresa) — do seu template.js
    utils.drawText(p1, 'Cleonis Batista Santos', 230, 820, { size: 10, font: fontBold })
    utils.drawText(p1, 'Avenida Sábia Q:30 L:27, 27, CEP 75904-370', 170, 808, { size: 10 })
    utils.drawText(p1, '(64) 99244-2480, engenheiro@gmail.com', 190, 796, { size: 10 })

    // 6) Campos principais (exemplos — ajuste conforme seu layout real)
    utils.drawValue(p1, data.tipoEquipamento, { x: 115, y: 700, style: { size: 18, font: fontBold } })
    utils.drawValue(p1, data.nomeEquipamento, { x: 115, y: 675, style: { size: 12 } })
    utils.drawValue(p1, data.numeroSerie,     { x: 115, y: 660, style: { size: 12 } })
    utils.drawValue(p1, data.fabricante,      { x: 115, y: 645, style: { size: 12 } })

    // Dados do cliente (bloco)
    utils.drawValue(p1, client.person,                     { x: 50, y: 610, style: { size: 11, font: fontBold } })
    utils.drawValue(p1, `${client.address || ''} CEP: ${client.cep || ''}`, { x: 50, y: 596, style: { size: 10 } })
    utils.drawValue(p1, `CNPJ: ${client.cnpj || ''}`,      { x: 50, y: 582, style: { size: 10 } })
    utils.drawValue(p1, `FONE: ${client.phone || ''}`,     { x: 50, y: 568, style: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p1, 1, outDoc.getPageCount())
  }

  // 7) Página 2 — Informações gerais (cadastrais, responsáveis, revisão, inspeções)
  if (outDoc.getPageCount() >= 2) {
    const p2 = outDoc.getPage(1)
    const cliente = data.client || {}
    const engenheiro = data.engenheiro || {}
    const analista = data.analista || {}

    // CADASTRAIS (2 colunas)
    utils.drawMultiline(p2, formatBlock([
      cliente.person,
      joinAddr(cliente),
      `CEP: ${cliente.cep || ''}`,
      `CNPJ: ${cliente.cnpj || ''}`,
      `TEL.: ${cliente.phone || ''}`,
      `E-mail: ${cliente.email || ''}`
    ]), { x: 50, y: 700, maxWidth: 240, style: { size: 10 } })

    utils.drawMultiline(p2, formatBlock([
      engenheiro.name,
      joinAddr(engenheiro),
      `CEP: ${engenheiro.cep || ''}`,
      `CNPJ: ${engenheiro.cnpj || ''}`,
      `CREA: ${engenheiro.crea || ''}`,
      `TEL.: ${engenheiro.phone || ''}`,
      `E-mail: ${engenheiro.email || ''}`
    ]), { x: 320, y: 700, maxWidth: 240, style: { size: 10 } })

    // RESPONSÁVEIS
    utils.drawMultiline(p2, formatBlock([
      analista.name,
      `E-mail: ${analista.email || ''}`
    ]), { x: 50, y: 590, maxWidth: 240, style: { size: 10 } })

    utils.drawMultiline(p2, formatBlock([
      engenheiro.name,
      `CREA: ${engenheiro.crea || ''}`
    ]), { x: 320, y: 590, maxWidth: 240, style: { size: 10 } })

    // REVISÃO
    utils.drawRow(p2, [
      data.numeroProjeto || '',
      data.descricaoRevisao || '',
      analista.name || '',
      formatDate(data.inspection?.endDate)
    ], { x: 50, y: 520, colW: 120, style: { size: 10 } })

    // INSPEÇÕES
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

  // 8) Página 3 — Imagens + dados gerais do equipamento
  if (outDoc.getPageCount() >= 3) {
    const p3 = outDoc.getPage(2)

    // Grid de imagens (até 6): reaproveita fluxo Firebase/URL + compress com sharp
    const imgs = await baixarEComprimirTodasImagens(data.images)
    await utils.drawImageGrid(
      p3,
      imgs.map(i => i.buffer),
      { x: 50, y: 720, cols: 3, cellW: 161.5, cellH: 150, gap: 5 }
    )

    // Tabela de gerais
    utils.drawKeyValueTable(p3, [
      ['TIPO', data.tipoEquipamento],
      ['TIPO DA CALDEIRA', data.tipoCaldeira],
      ['Nº DE SÉRIE', data.numeroSerie],
      ['ANO DE FABRICAÇÃO', data.anoFabricacao],
      ['PMTA', joinUnits(data.pressaoMaxima, data.unidadePressaoMaxima)],
      ['PTHF', joinUnits(data.pressaoTeste, data.unidadePressaoMaxima)],
      ['CPV', data.capacidadeProducaoVapor],
      ['ASA', data.areaSuperficieAquecimento],
      ['CÓDIGO/ANO EDIÇÃO', `${data.codProjeto || ''} / ${data.anoEdicao || ''}`],
      ['LOCAL DE INSTALAÇÃO', data.localInstalacao]
    ], { x: 50, y: 300, keyW: 350, valW: 145.28, rowH: 20, styleKey: { size: 10 }, styleVal: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p3, 3, outDoc.getPageCount())
  }

  // 9) Página 4 — Categorização/Operação (exemplo)
  if (outDoc.getPageCount() >= 4) {
    const p4 = outDoc.getPage(3)

    utils.drawKeyValueTable(p4, [
      ['TEMPERATURA DE PROJETO', joinUnits(data.temperaturaProjeto, '°C')],
      ['TEMPERATURA DE TRABALHO', joinUnits(data.temperaturaTrabalho, '°C')],
      ['VOLUME', data.volume],
      ['CATEGORIA', data.categoriaCaldeira]
    ], { x: 50, y: 670, keyW: 350, valW: 145.28, rowH: 20, styleKey: { size: 10 }, styleVal: { size: 10 } })

    utils.drawKeyValueTable(p4, [
      ['COMBUSTÍVEL PRINCIPAL', data.combustivelPrincipal],
      ['COMBUSTÍVEL AUXILIAR', data.combustivelAuxiliar],
      ['REGIME DE TRABALHO', data.regimeTrabalho],
      ['TIPO DE OPERAÇÃO', data.tipoOperacao]
    ], { x: 50, y: 560, keyW: 350, valW: 145.28, rowH: 20, styleKey: { size: 10 }, styleVal: { size: 10 } })

    if (addPageNumbers) utils.pageNumber(p4, 4, outDoc.getPageCount())
  }

  // 10) Salva bytes
  return await outDoc.save()
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
  async function tryEmbed (doc, bytes) {
    try { return await doc.embedPng(bytes) } catch { return await doc.embedJpg(bytes) }
  }
  async function drawImage (page, bytes, { x, y, width, height, w, h }) {
    if (!bytes) return
    const img = await tryEmbed(pdfDoc, bytes)
    page.drawImage(img, { x, y, width: width ?? w, height: height ?? h })
  }
  async function drawImageGrid (page, buffers, cfg) {
    if (!cfg) return
    const { x, y, cols = 3, cellW, cellH, gap = 5 } = cfg
    let cx = x, cy = y
    const total = Math.min(buffers.length, cols * 2) // até 6 imagens
    for (let i = 0; i < total; i++) {
      const b = buffers[i]
      if (b) await drawImage(page, b, { x: cx, y: cy - cellH, w: cellW, h: cellH })
      cx += cellW + gap
      if ((i + 1) % cols === 0) { cx = x; cy -= (cellH + gap) }
    }
  }
  function drawValue (page, value, cfg) {
    if (!cfg) return
    if (cfg.maxWidth) return drawWrapped(page, value, cfg.x, cfg.y, cfg.maxWidth, cfg.style)
    return drawText(page, value, cfg.x, cfg.y, cfg.style)
  }
  function drawRow (page, values, cfg) {
    const { x, y, colW, style } = cfg
    let cx = x
    values.forEach(v => { drawWrapped(page, v, cx, y, colW, style); cx += colW })
  }
  function drawKeyValueTable (page, rows, cfg) {
    const { x, y, keyW, valW, rowH, styleKey, styleVal } = cfg
    let cy = y
    rows.forEach(([k, v]) => {
      drawWrapped(page, k, x + 4, cy - 4, keyW - 8, { ...styleKey })
      drawWrapped(page, v, x + keyW + 4, cy - 4, valW - 8, { ...styleVal })
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
  return { drawText, drawWrapped, drawImage, drawImageGrid, drawValue, drawRow, drawKeyValueTable, pageNumber }
}

/* ====================== Utils gerais ====================== */
function assertTemplatePath (templatePath) {
  if (templatePath) return templatePath
  // caminho padrão
  return path.resolve(process.cwd(), 'templates', 'relatorio.pdf')
}
function joinUnits (v, u) {
  if (v == null || v === '') return ''
  return u ? `${v} ${u}` : String(v)
}
function formatBlock (lines = []) { return lines.filter(Boolean).join('\n') }
function joinAddr (o = {}) {
  const parts = [o.address, o.neighborhood, o.number].filter(Boolean)
  return parts.join(', ')
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

/* ====================== Baixar imagens (URL/Firebase) ====================== */
async function downloadBytes (urlOrGs) {
  try {
    if (!urlOrGs) return null
    if (/^https?:\/\//i.test(urlOrGs)) {
      const r = await axios.get(urlOrGs, { responseType: 'arraybuffer' })
      return Buffer.from(r.data)
    }
    // gs://BUCKET/path/to/file
    const storage = admin.storage()
    let bucket = storage.bucket()
    let filePath = urlOrGs
    const m = typeof urlOrGs === 'string' ? urlOrGs.match(/^gs:\/\/([^/]+)\/(.+)$/i) : null
    if (m) { const [, bucketName, p] = m; bucket = storage.bucket(bucketName); filePath = p }
    else if (filePath.startsWith('/')) { filePath = filePath.slice(1) }
    const [buffer] = await bucket.file(filePath).download()
    return buffer
  } catch (e) {
    console.error('downloadBytes failed:', e.message)
    return null
  }
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
      } catch (e) { console.warn('Falha ao otimizar imagem:', u, e.message) }
    }
    return out
  } catch (e) {
    console.error('baixarEComprimirTodasImagens falhou:', e.message)
    return []
  }
}
