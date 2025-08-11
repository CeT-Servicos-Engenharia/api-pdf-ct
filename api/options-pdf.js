
// api/options-pdf.js (CommonJS, lazy requires)
// Evita quebrar no import de módulos (ex.: firebase) antes do ?test=true

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Método não permitido' });
    }

    const { projectId, type, update, opening, medicalRecord, test } = req.query;

    // --- MODO TESTE: gerar um PDF simples sem importar NADA além de pdf-lib ---
    if (String(test) === 'true') {
      const { PDFDocument, StandardFonts } = require('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]); // A4
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText('Endpoint OK ✅', { x: 200, y: 600, size: 18, font });
      page.drawText('Este PDF foi gerado no modo teste.', { x: 150, y: 560, size: 12, font });
      const bytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="teste.pdf"');
      return res.status(200).send(Buffer.from(bytes));
    }

    // A partir daqui, importar os geradores reais (lazy require)
    const generateBoilerPdf = require('./generate-pdf');
    const generateOppeningPDF = require('./pdf-oppening');
    const generatePressureVesselPdf = require('./pdf-pressureVessel');
    const generateUpdatePDF = require('./pdf-update');
    const generateMedicalRecordPdf = require('./pdf-medical-record');

    const openingFlag = String(opening) === 'true';
    const updateFlag = String(update) === 'true';
    const medicalRecordFlag = String(medicalRecord) === 'true';

    if (!projectId && !openingFlag && !updateFlag && !medicalRecordFlag) {
      return res.status(400).json({ error: "Parâmetro 'projectId' é obrigatório." });
    }

    let pdfBuffer;

    if (openingFlag) {
      pdfBuffer = await generateOppeningPDF(projectId);
    } else if (updateFlag) {
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (medicalRecordFlag) {
      pdfBuffer = await generateMedicalRecordPdf(projectId);
    } else {
      switch (type) {
        case 'boiler':
          pdfBuffer = await generateBoilerPdf(projectId);
          break;
        case 'pressure-vessel':
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        default:
          pdfBuffer = await generateBoilerPdf(projectId);
          break;
      }
    }

    if (!(pdfBuffer instanceof Buffer)) {
      pdfBuffer = Buffer.from(pdfBuffer);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${type || 'relatorio'}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    return res.status(500).json({ error: 'Erro interno ao gerar o PDF.' });
  }
};
