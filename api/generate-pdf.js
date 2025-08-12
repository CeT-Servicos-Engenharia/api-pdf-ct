const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js"); // ✅ Usa o inicializador central
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// --- Funções Auxiliares (Padrão, sem alterações) ---

async function baixarEComprimirTodasImagens(imageUrls) {
    // ... (seu código original da função)
}

async function downloadImageFromFirebase(url) {
    // ... (seu código original da função)
}

async function addFirebaseImageToPDF(pdfDoc, page, imageUrl, options = {}) {
    // ... (seu código original da função)
}

function formatDate(dateString) {
    // ... (seu código original da função)
}

async function getProjectData(projectId) {
    // ... (seu código original da função)
}

async function getClientData(clientId) {
    // ... (seu código original da função)
}

async function getEngenieerData(engenieerId) {
    // ... (seu código original da função)
}

async function getAnalystData(analystId) {
    // ... (seu código original da função)
}

// --- Função Principal de Geração do PDF (Adaptada para Caldeira) ---

async function generatePDF(data, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Carrega logos (lógica idêntica ao pressure-vessel)
  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
  
  let logoClienteImage = null;
  if (clientData?.logo) {
    try {
      const response = await axios.get(clientData.logo, { responseType: "arraybuffer" });
      const optimized = await sharp(response.data).resize(150).jpeg({ quality: 60 }).toBuffer();
      logoClienteImage = await pdfDoc.embedJpg(optimized);
    } catch (error) {
      console.error("Erro ao baixar logo do cliente:", error.message);
    }
  }

  const headerAssets = { logoEmpresaImage, logoClienteImage, helveticaFont, helveticaBoldFont };

  // --- Funções de Desenho (internas para manter o escopo) ---
  
  async function addHeader(pdfDoc, page, clientData, assets) {
      // ... (seu código original da função addHeader)
  }

  async function addFooter(pdfDoc, page, data, pageNumber = null) {
      // ... (seu código original da função addFooter)
  }

  // --- Início da Construção das Páginas ---

  // Página 1: Capa (Adaptada)
  const page1 = pdfDoc.addPage([595.28, 841.89]);
  page1.drawText(`Relatório de Inspeção: Caldeira`, { x: 160, y: 700, size: 24, font: helveticaBoldFont });
  
  if (data?.images?.[0]) {
    await addFirebaseImageToPDF(pdfDoc, page1, data.images[0], { x: 172, y: 420, width: 250, height: 250 });
  }

  page1.drawText(`Detalhes do Equipamento:`, { x: 50, y: 380, size: 16, font: helveticaBoldFont });
  page1.drawText(`Nome do equipamento:`, { x: 50, y: 350, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.nomeEquipamento ?? 'Caldeira Flamotubular'}`, { x: 220, y: 350, size: 14, font: helveticaFont });
  page1.drawText(`Número de série:`, { x: 50, y: 320, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.numeroSerie ?? 'N/C'}`, { x: 175, y: 320, size: 14, font: helveticaFont });
  page1.drawText(`Patrimônio/TAG:`, { x: 50, y: 290, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.numeroPatrimonio ?? data?.tag ?? ''}`, { x: 180, y: 290, size: 14, font: helveticaFont });
  page1.drawText(`Fabricante:`, { x: 50, y: 260, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.fabricante ?? ''}`, { x: 140, y: 260, size: 14, font: helveticaFont });
  
  page1.drawText(`${clientData?.person ?? ''}`, { x: 50, y: 200, size: 12, font: helveticaBoldFont });
  page1.drawText(`${clientData?.address ?? ''} CEP: ${clientData?.cep ?? ''}`, { x: 50, y: 185, size: 12, font: helveticaFont });
  page1.drawText(`CNPJ: ${clientData?.cnpj ?? ''}`, { x: 50, y: 170, size: 12, font: helveticaFont });
  page1.drawText(`FONE: ${clientData?.phone ?? ''}`, { x: 50, y: 155, size: 12, font: helveticaFont });

  // --- Aqui você continuaria a adicionar as outras páginas, replicando a lógica do pressure-vessel ---
  // Exemplo:
  // const page2 = pdfDoc.addPage([595.28, 841.89]);
  // await drawTableRegistrationData(page2, ...);
  // ... e assim por diante para todas as 23 páginas.

  // Adiciona cabeçalhos e rodapés em todas as páginas no final
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    await addHeader(pdfDoc, page, clientData, headerAssets);
    await addFooter(pdfDoc, page, data, i + 1);
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- Handler de Exportação (Adaptado) ---
async function generateBoilerPdf(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro 'projectId' é obrigatório.");
  }
  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF da Caldeira:", error.message);
    // ✅ Mantém o erro específico para facilitar a depuração
    throw new Error(`Erro ao gerar o PDF da Caldeira: ${error.message}`);
  }
}

module.exports = generateBoilerPdf;

