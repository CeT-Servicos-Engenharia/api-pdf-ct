// api/generate-pdf.js (CommonJS)
// Minimal stub that returns a simple Boiler PDF without Firebase.
// Replace later with real boiler generator.

const { PDFDocument, StandardFonts } = require('pdf-lib');

module.exports = async function generateBoilerPdf(projectId) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const title = 'Relatório de Caldeira (Boiler)';
  const subtitle = `projectId: ${projectId || '—'}`;

  page.drawText(title, { x: 60, y: 760, size: 18, font });
  page.drawText('PDF gerado com sucesso ✅', { x: 60, y: 730, size: 12, font });
  page.drawText(subtitle, { x: 60, y: 710, size: 11, font });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
};