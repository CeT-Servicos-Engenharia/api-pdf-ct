// api/options-pdf.js  (CommonJS)

const path = require('path')

// --- Carrega módulos de geração ---
function resolveExport(mod, candidates = []) {
  // Retorna a primeira função válida encontrada
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

module.exports = async function handler(req, res) {
  console.log("Handler 'options-pdf' iniciado (GET).")

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

  try {
    let pdfBuffer
    const resolvedType = type || (updateFlag && 'update') || (openingFlag && 'opening') || (medicalRecordFlag && 'medicalRecord')
    console.log(`Iniciando geração para tipo: ${resolvedType || 'boiler/pressure-vessel'}`)

    if (updateFlag) {
      pdfBuffer = await generateUpdatePDF(projectId)
    } else if (openingFlag) {
      pdfBuffer = await generateOppeningPDF(projectId, type)
    } else if (medicalRecordFlag) {
      pdfBuffer = await generateMedicalRecordPdf(projectId)
    } else {
      switch (type) {
        case 'boiler': {
          // OBS: se seu novo módulo precisa de templatePath, ajuste aqui:
          // pdfBuffer = await generateBoiler(projectId, { templatePath: 'templates/relatorio.pdf' })
          pdfBuffer = await generateBoiler(projectId)
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

    console.log('PDF gerado. Enviando...')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="relatorio.pdf"')
    return res.status(200).send(pdfBuffer)
  } catch (error) {
    console.error(`Erro fatal no handler 'options-pdf':`, error)
    return res.status(500).json({
      error: 'Erro interno ao gerar o PDF.',
      details: error.message
    })
  }
}
