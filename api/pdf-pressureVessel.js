
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const template = require("./template");

module.exports = async function generatePressureVesselPDF(data) {
  const { pages, metadata, filename } = await template("pressure-vessel", data);

  // Ajuste da numeração de páginas e criação do sumário
  const totalPages = pages.length;
  const startPage = 1;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Criar página de sumário
  const tocPage = pdfDoc.addPage();
  const { width, height } = tocPage.getSize();
  tocPage.drawText("SUMÁRIO", { x: 50, y: height - 50, size: 18, font });

  let tocY = height - 80;
  for (let i = 0; i < pages.length; i++) {
    const label = pages[i].label || `Página ${i + 1}`;
    tocPage.drawText(`${label} ......................................... ${i + startPage + 1}`, {
      x: 50,
      y: tocY,
      size: 12,
      font,
    });
    tocY -= 20;
  }

  // Adicionar páginas reais ao documento
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pdfPage = pdfDoc.addPage();
    const { width, height } = pdfPage.getSize();

    if (page.content) {
      pdfPage.drawText(page.content, {
        x: 50,
        y: height - 50,
        size: 14,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // Adicionar número da página no rodapé
    pdfPage.drawText(`${i + startPage + 1}`, {
      x: width - 50,
      y: 20,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, "output", `${filename}.pdf`);
  fs.writeFileSync(outputPath, pdfBytes);
  return outputPath;
};
