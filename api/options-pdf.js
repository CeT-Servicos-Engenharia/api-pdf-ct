// api/options-pdf.js (CommonJS) — usa template fixo e logo na pasta /assets
const path = require('path')
const fs = require('fs')

function resolveExport(mod, candidates = []) {
  for (const name of candidates) {
    const fn = name ? mod?.[name] : mod
    if (typeof fn === 'function') return fn
  }
  return null
}

const genBoilerMod = require('./generate-pdf.js')
const generateBoiler =
  resolveExport(genBoilerMod, ['generateBoilerPdf', 'generatePdf', 'default', '']) ||
  (() => { throw new Error('Nenhuma função de geração encontrada em generate-pdf.js (esperado: generateBoilerPdf ou generatePdf).') })

const generateOppeningPDF = require('./pdf-oppening.js')
const generatePressureVesselPdf = require('./pdf-pressureVessel.js')
const generateUpdatePDF = require('./pdf-update.js')
const generateMedicalRecordPdf = require('./pdf-medical-record.js')

// tenta achar um arquivo de logo dentro de /assets
function findLogoPath() {
  const candidates = [
    'assets/logo.png',
    'assets/logo.jpg',
    'assets/logo.jpeg',
    'assets/CET LOGO - TRANSPARENCIA.png',
    'assets/CET_LOGO_TRANSPARENCIA.png'
  ]
  for (const rel of candidates) {
    const abs = path.resolve(process.cwd(), rel)
    if (fs.existsSync(abs)) return abs
  }
  // se não encontrar, retorna caminho padrão (pode não existir; o gerador ignora se faltar)
  return path.resolve(process.cwd(), 'assets', 'logo.png')
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const { projectId, type, update, opening, medicalRecord } = req.query
  const updateFlag = update === 'true'
  const openingFlag = opening === 'true'
  const medicalRecordFlag = medicalRecord === 'true'

  if (!projectId) {
    return res.status(400).json({ error: 'O ID do projeto é obrigatório.' })
  }

  // caminhos fixos (ajuste se seu template ficar em outro lugar)
  const templatePath = path.resolve(process.cwd(), 'templates', 'relatorio.pdf')
  const companyLogoPath = findLogoPath()

  try {
    let pdfBuffer
    if (updateFlag) {
      pdfBuffer = await generateUpdatePDF(projectId)
    } else if (openingFlag) {
      pdfBuffer = await generateOppeningPDF(projectId, type)
    } else if (medicalRecordFlag) {
      pdfBuffer = await generateMedicalRecordPdf(projectId)
    } else {
      switch (type) {
        case 'boiler': {
          pdfBuffer = await generateBoiler(projectId, {
            templatePath,
            companyLogoPath,
            addPageNumbers: true
          })
          break
        }
        case 'pressure-vessel': {
          pdfBuffer = await generatePressureVesselPdf(projectId)
          break
        }
        default:
          return res.status(400).json({ error: `Tipo de PDF inválido: ${type}` })
      }
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="relatorio.pdf"')
    return res.status(200).send(pdfBuffer)
  } catch (error) {
    console.error(`Erro fatal no handler 'options-pdf':`, error)
    return res.status(500).json({
      error: 'Erro interno ao gerar o PDF.',
      details: error.message,
      hint: 'Verifique se templates/relatorio.pdf existe no projeto e se a função generateBoilerPdf está exportada.'
    })
  }
}
