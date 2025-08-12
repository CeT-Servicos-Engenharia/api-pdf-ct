const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js"); // ✅ Usa o inicializador central
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

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
  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // TODO: Cole aqui a sua lógica específica para desenhar o relatório da caldeira.
  const page1 = pdfDoc.addPage();
  page1.drawImage(logoEmpresaImage, { x: 50, y: 750, width: 80, height: 80 });
  page1.drawText("Relatório de Inspeção de CALDEIRA", {
    x: 150, y: 780, font: helveticaBoldFont, size: 18, color: rgb(0.1, 0.1, 0.1),
  });
  if (clientData?.name) {
    page1.drawText(`Cliente: ${clientData.name}`, { x: 150, y: 760, font: helveticaFont, size: 12 });
  }
  page1.drawText("Este é o relatório gerado para a caldeira.", { x: 50, y: 700 });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- Handler de Exportação ---
async function generateBoilerPdf(projectId) {
  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Caldeira] Erro fatal na geração do PDF:`, error);
    throw new Error(`Falha na geração do PDF da Caldeira: ${error.message}`);
  }
}

module.exports = generateBoilerPdf;


