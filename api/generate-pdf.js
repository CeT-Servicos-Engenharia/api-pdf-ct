const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js"); // ✅ Usa o inicializador central
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// --- Funções Auxiliares (Padrão) ---

async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) throw new Error("Projeto não encontrado");
  return doc.data();
}

async function getClientData(clientId) {
  if (!clientId) return null;
  const clientDocRef = admin.firestore().doc(`clients/${clientId}`);
  const clientDoc = await clientDocRef.get();
  if (clientDoc.exists) return clientDoc.data();
  return null;
}

async function getEngenieerData(engenieerId) {
  try {
    const engenieerDocRef = admin.firestore().doc(`engenieer/${engenieerId}`);
    const engenieerDoc = await engenieerDocRef.get();
    if (engenieerDoc.exists) return engenieerDoc.data();
    else throw new Error("Engenheiro não encontrado");
  } catch (error) {
    console.error("Erro ao buscar engenheiro:", error.message);
    throw error;
  }
}

async function getAnalystData(analystId) {
  try {
    const analystDocRef = admin.firestore().doc(`analyst/${analystId}`);
    const analystDoc = await analystDocRef.get();
    if (analystDoc.exists) return analystDoc.data();
    else throw new Error("Analista não encontrado");
  } catch (error) {
    console.error("Erro ao buscar analista:", error.message);
    throw error;
  }
}

// --- Função Principal de Geração do PDF da Caldeira ---

async function generatePDF(data, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Carrega o logo da empresa localmente
  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  // Carrega o logo do cliente via URL (se existir)
  let logoClienteImage = null;
  if (clientData && clientData.logo) {
    try {
      const response = await axios.get(clientData.logo, { responseType: "arraybuffer" });
      const optimized = await sharp(response.data).resize(150).jpeg({ quality: 60 }).toBuffer();
      logoClienteImage = await pdfDoc.embedJpg(optimized);
    } catch (error) {
      console.error("Erro ao baixar logo do cliente:", error.message);
    }
  }

  const headerAssets = { logoEmpresaImage, logoClienteImage, helveticaFont, helveticaBoldFont };

  // --- Página 1: Capa ---
  const page1 = pdfDoc.addPage([595.28, 841.89]);
  // (Cabeçalho e Rodapé serão adicionados no final)

  page1.drawText(`Relatório de Inspeção: Caldeira`, {
    x: 160, // Ajustado para centralizar
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // Imagem principal da caldeira
  if (data.images && Array.isArray(data.images) && data.images.length > 0) {
    try {
        const imageUrl = data.images[0];
        const imageBytes = await axios.get(imageUrl, { responseType: 'arraybuffer' }).then(res => res.data);
        const embeddedImage = await pdfDoc.embedJpg(imageBytes); // Assumindo JPG, pode precisar de lógica para PNG
        page1.drawImage(embeddedImage, {
            x: 172,
            y: 420,
            width: 250,
            height: 250,
        });
    } catch (e) {
        console.error("Erro ao carregar imagem principal da caldeira", e.message);
    }
  }

  page1.drawText(`Detalhes do Equipamento:`, { x: 50, y: 380, size: 16, font: helveticaBoldFont });
  page1.drawText(`Nome do equipamento:`, { x: 50, y: 350, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data.nomeEquipamento || "Caldeira Flamotubular"}`, { x: 220, y: 350, size: 14, font: helveticaFont });
  page1.drawText(`Número de série:`, { x: 50, y: 320, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data.numeroSerie || "N/C"}`, { x: 175, y: 320, size: 14, font: helveticaFont });
  page1.drawText(`Patrimônio/TAG:`, { x: 50, y: 290, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data.numeroPatrimonio || data.tag || " "}`, { x: 180, y: 290, size: 14, font: helveticaFont });
  page1.drawText(`Fabricante:`, { x: 50, y: 260, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data.fabricante || " "}`, { x: 140, y: 260, size: 14, font: helveticaFont });

  // Informações do Cliente na Capa
  page1.drawText(`${clientData.person || " "}`, { x: 50, y: 200, size: 12, font: helveticaBoldFont });
  page1.drawText(`${clientData.address || " "} CEP: ${clientData.cep || " "}`, { x: 50, y: 185, size: 12, font: helveticaFont });
  page1.drawText(`CNPJ: ${clientData.cnpj || " "}`, { x: 50, y: 170, size: 12, font: helveticaFont });
  page1.drawText(`FONE: ${clientData.phone || " "}`, { x: 50, y: 155, size: 12, font: helveticaFont });

  // --- Adicionar mais páginas conforme a lógica do seu PDF de exemplo ---
  // ... (Aqui entrariam as outras páginas: Sumário, Informações Gerais, Dados do Equipamento, etc.)
  // ... (Esta parte precisa ser construída com base nas suas funções de desenho de tabela e texto)

  // Exemplo de como adicionar uma segunda página
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  page2.drawText("Página 2 - Sumário (Conteúdo a ser adicionado)", { x: 50, y: 750, size: 12 });


  // Adiciona cabeçalhos e rodapés em todas as páginas no final
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // Adiciona cabeçalho (exceto no sumário, se desejar)
    await addHeader(pdfDoc, page, clientData, headerAssets);
    // Adiciona rodapé com número da página correto
    await addFooter(pdfDoc, page, data, i + 1);
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- Handler de Exportação ---
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
    throw new Error("Erro ao gerar o PDF da Caldeira");
  }
}

module.exports = generateBoilerPdf;
