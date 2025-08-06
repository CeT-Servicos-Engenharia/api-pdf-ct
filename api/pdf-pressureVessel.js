
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function generatePressureVesselPdf(data, clientData, headerAssets) {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  let countPages = 1;
  const pages = [];

  function createPage() {
    const page = pdfDoc.addPage([595.28, 841.89]);
    pages.push(page);
    return page;
  }

  async function addHeaderFooter(page, pageNum) {
    page.drawText("C&T Serviços Engenharia", { x: 50, y: 800, size: 10, font: helveticaBoldFont });
    page.drawText(`Página ${pageNum}`, { x: 500, y: 20, size: 10, font: helveticaFont });
  }

  // Capa
  const page1 = createPage();
  page1.drawText("Relatório de Inspeção de Vaso de Pressão", {
    x: 150, y: 700, size: 18, font: helveticaBoldFont
  });
  await addHeaderFooter(page1, countPages++);

  // Sumário
  const sumarioPage = createPage();
  sumarioPage.drawText("SUMÁRIO", { x: 50, y: 780, size: 14, font: helveticaBoldFont });
  const secoes = [
    "1. INFORMAÇÕES GERAIS",
    "1.1 DADOS CADASTRAIS",
    "1.2 RESPONSÁVEIS TÉCNICOS",
    "1.3 CONTROLE DE REVISÃO",
    "1.4 INSPEÇÕES CONTRATADAS",
    "1.5 DADOS DO EQUIPAMENTO",
    "1.6 CATEGORIZAÇÃO",
    "1.7 PESSOAS QUE ACOMPANHARAM",
    "1.8 DOCUMENTAÇÃO EXISTENTE",
    "2 DEFINIÇÃO",
    "3 OBJETIVO",
    "4 NORMAS",
    "5 CARACTERIZAÇÃO",
    "5.1 DISPOSITIVOS",
    "5.2 MAPA DE MEDIÇÃO",
    "5.3 RECOMENDAÇÕES",
    "5.4 REGISTROS FOTOGRÁFICOS",
    "6 RECOMENDAÇÕES ADICIONAIS",
    "7 LIMITAÇÕES DO RELATÓRIO",
    "8 CONCLUSÃO"
  ];
  let y = 750;
  secoes.forEach((titulo, i) => {
    sumarioPage.drawText(`${titulo}${'.'.repeat(80 - titulo.length - 2)}${i + 3}`, {
      x: 50, y, size: 10, font: helveticaFont
    });
    y -= 16;
  });
  await addHeaderFooter(sumarioPage, countPages++);

  // Exemplo de seção
  const pageSecao = createPage();
  pageSecao.drawText("1.1 DADOS CADASTRAIS", { x: 50, y: 780, size: 12, font: helveticaBoldFont });
  pageSecao.drawText("Cliente: " + clientData.nome, { x: 50, y: 760, size: 10, font: helveticaFont });
  await addHeaderFooter(pageSecao, countPages++);

  // Outras seções viriam a seguir com createPage() e addHeaderFooter()

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

module.exports = { generatePressureVesselPdf };
