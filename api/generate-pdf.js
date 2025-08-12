const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("firebase-admin");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Bloco de segurança para inicializar o Firebase, igual aos outros arquivos
if (!admin.apps.length) {
  try {
    // O caminho para o seu arquivo de credenciais. Verifique se está correto.
    const serviceAccount = require("../nr13-c33f2-firebase-adminsdk-y8x46-0d71dfb66e.json");
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("[Caldeira] Firebase inicializado com sucesso.");
  } catch (error) {
    console.error("[Caldeira] Erro ao inicializar o Firebase:", error.message);
  }
}

// --- Funções Auxiliares de Busca de Dados ---

async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) throw new Error(`[Caldeira] Projeto com ID ${projectId} não encontrado.`);
  return doc.data();
}

async function getClientData(clientId) {
  if (!clientId) return null;
  const db = admin.firestore();
  const doc = await db.collection("clients").doc(clientId).get();
  return doc.exists ? doc.data() : null;
}

async function getEngenieerData(engenieerId) {
  if (!engenieerId) return null;
  const db = admin.firestore();
  const doc = await db.collection("engenieer").doc(engenieerId).get();
  return doc.exists ? doc.data() : null;
}

async function getAnalystData(analystId) {
  if (!analystId) return null;
  const db = admin.firestore();
  const doc = await db.collection("analyst").doc(analystId).get();
  return doc.exists ? doc.data() : null;
}

// --- Função Principal de Geração do PDF ---

async function generatePDF(projectData, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();

  // Carrega o logo do sistema de arquivos (igual ao pdf-pressureVessel.js)
  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // --- LÓGICA DE MONTAGEM DO DOCUMENTO DA CALDEIRA ---
  // TODO: Cole aqui a sua lógica específica para desenhar o relatório da caldeira.
  // O código abaixo é apenas um exemplo para garantir que o arquivo seja gerado.
  
  const page1 = pdfDoc.addPage();
  page1.drawImage(logoEmpresaImage, { x: 50, y: 750, width: 80, height: 80 });
  page1.drawText("Relatório de Inspeção de CALDEIRA", {
    x: 150,
    y: 780,
    font: helveticaBoldFont,
    size: 18,
    color: rgb(0.1, 0.1, 0.1),
  });

  if (clientData?.name) {
    page1.drawText(`Cliente: ${clientData.name}`, {
      x: 150,
      y: 760,
      font: helveticaFont,
      size: 12,
    });
  }
  
  page1.drawText("Este é o relatório gerado para a caldeira.", { x: 50, y: 700 });

  console.log("[Caldeira] Documento montado, salvando bytes...");
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- Handler de Exportação ---

async function generateBoilerPdf(projectId) {
  try {
    console.log(`[Caldeira] Iniciando geração para o projeto: ${projectId}`);
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);

    console.log("[Caldeira] Dados do projeto obtidos. Montando o PDF.");
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    
    console.log("[Caldeira] PDF montado com sucesso.");
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Caldeira] Erro fatal na geração do PDF:`, error);
    throw new Error(`Falha na geração do PDF da Caldeira: ${error.message}`);
  }
}

// Exporta a função principal usando a sintaxe CommonJS
module.exports = generateBoilerPdf;
