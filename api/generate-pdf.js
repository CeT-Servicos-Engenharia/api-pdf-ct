import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import admin from "./lib/firebase-admin.js";
import axios from "axios";
import sharp from "sharp";

// URL pública do seu logo (substitua se necessário)
const LOGO_URL = "https://firebasestorage.googleapis.com/v0/b/seu-bucket/o/seu-logo.png?alt=media";

// --- Funções Auxiliares (sem inicialização do Firebase aqui ) ---
async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) throw new Error(`Projeto com ID ${projectId} não encontrado.`);
  return doc.data();
}

async function getClientData(clientId) {
  if (!clientId) return null;
  const db = admin.firestore();
  const doc = await db.collection("clients").doc(clientId).get();
  return doc.exists ? doc.data() : null;
}

// ... (COLE AQUI SUAS OUTRAS FUNÇÕES AUXILIARES: getEngenieerData, addHeader, addFooter, etc.)
// ... (Apenas garanta que elas não tenham 'admin.initializeApp' ou 'fs.readFileSync')

// --- Função Principal de Geração ---
async function generatePDF(projectData, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();
  
  // Carrega o logo da URL
  const logoBytes = await axios.get(LOGO_URL, { responseType: 'arraybuffer' }).then(res => res.data);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const headerAssets = { logoEmpresaImage, helveticaFont, helveticaBoldFont };

  // --- LÓGICA DE MONTAGEM DO DOCUMENTO ---
  // (Esta é a parte que estava faltando no seu arquivo da caldeira)
  // Exemplo baseado no seu 'pressure-vessel':
  
  console.log("[Caldeira] Adicionando primeira página...");
  const page1 = pdfDoc.addPage();
  await addHeader(pdfDoc, page1, clientData, headerAssets);
  // ... desenhe o conteúdo da página 1 ...
  await addFooter(pdfDoc, page1, projectData, 1);
  
  console.log("[Caldeira] Adicionando segunda página...");
  const page2 = pdfDoc.addPage();
  await addHeader(pdfDoc, page2, clientData, headerAssets);
  // ... desenhe o conteúdo da página 2 ...
  await addFooter(pdfDoc, page2, projectData, 2);

  // ... continue para todas as páginas ...

  console.log("[Caldeira] Salvando o documento...");
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// --- Handler de Exportação ---
async function generateBoilerPdf(projectId) {
  try {
    console.log(`[Caldeira] Buscando dados para o projeto: ${projectId}`);
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);

    console.log("[Caldeira] Dados obtidos. Iniciando a montagem do PDF.");
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    
    console.log("[Caldeira] PDF montado com sucesso.");
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Caldeira] Erro fatal na geração do PDF:`, error);
    throw new Error(`Falha na geração do PDF da Caldeira: ${error.message}`);
  }
}

export default generateBoilerPdf;

