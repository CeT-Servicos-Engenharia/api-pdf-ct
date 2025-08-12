const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js"); // ✅ Usa o inicializador central
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp"); // ✅ CORRIGIDO: Importado apenas UMA VEZ no topo

// --- Funções Auxiliares ---

async function downloadImageFromFirebase(url) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    if (!response || !response.data) {
      throw new Error("Imagem não encontrada ou vazia.");
    }
    return response.data;
  } catch (error) {
    console.error("Erro ao baixar a imagem do Firebase:", error.message);
    throw new Error("Falha ao baixar a imagem.");
  }
}

async function addFirebaseImageToPDF(pdfDoc, page, imageUrl, options = {}) {
  try {
    if (!imageUrl || typeof imageUrl !== "string") {
      console.warn("URL inválida ou nula. Ignorando...");
      return;
    }
    const imageBytes = await downloadImageFromFirebase(imageUrl);
    if (!imageBytes) {
      throw new Error("Bytes da imagem estão vazios.");
    }
    const imageBytesArray = new Uint8Array(imageBytes);
    const isPng = imageBytesArray[0] === 0x89 && imageBytesArray[1] === 0x50 && imageBytesArray[2] === 0x4e && imageBytesArray[3] === 0x47;
    const isJpeg = imageBytesArray[0] === 0xff && imageBytesArray[1] === 0xd8 && imageBytesArray[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("Formato de imagem não suportado. Apenas PNG e JPEG são aceitos.");
    }
    const optimizedImageBuffer = await sharp(imageBytes).resize(400).jpeg({ quality: 30 }).png({ quality: 30 }).toBuffer();
    const optimizedImageBytesArray = new Uint8Array(optimizedImageBuffer);
    const optimizedIsPng = optimizedImageBytesArray[0] === 0x89 && optimizedImageBytesArray[1] === 0x50 && optimizedImageBytesArray[2] === 0x4e && optimizedImageBytesArray[3] === 0x47;
    const embeddedImage = optimizedIsPng ? await pdfDoc.embedPng(optimizedImageBuffer) : await pdfDoc.embedJpg(optimizedImageBuffer);
    const { x = 50, y = 750, width = 100, height = 100 } = options;
    page.drawImage(embeddedImage, { x, y, width, height });
  } catch (error) {
    console.error("Erro ao adicionar a imagem do Firebase ao PDF:", error.message);
  }
}

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
    if (engenieerDoc.exists) {
      return engenieerDoc.data();
    } else {
      throw new Error("Engenheiro não encontrado");
    }
  } catch (error) {
    console.error("Erro ao buscar engenheiro:", error.message);
    throw error;
  }
}

const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");

async function addHeader(pdfDoc, page, clientData, assets) {
    // ... (seu código de addHeader aqui)
}

async function addFooter(pdfDoc, page, data, pageNumber) {
    // ... (seu código de addFooter aqui)
}

// --- Função Principal e Handler ---
async function generatePDF(projectData, clientData, engenieerData) {
  // ... (seu código para gerar o PDF de abertura aqui)
}

async function generateOppeningPDF(projectId) {
  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData);
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF de Abertura:", error.message);
    throw new Error("Erro ao gerar o PDF de Abertura");
  }
}

module.exports = generateOppeningPDF;
