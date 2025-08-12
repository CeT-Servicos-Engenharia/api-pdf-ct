import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import admin from "./lib/firebase-admin.js"; // ✅ USA O INICIALIZADOR CENTRAL
import axios from "axios";
import sharp from "sharp";

// --- Funções Auxiliares (sem inicialização do Firebase aqui) ---
// (Estas funções agora são compartilhadas e padronizadas)

const LOGO_URL = "https://firebasestorage.googleapis.com/v0/b/nr13-c33f2/o/logo%2FCET%20LOGO%20-%20TRANSPARENCIA(1 ).png?alt=media&token=5a57863c-39a0-44f0-addd-39f131252709"; // ✅ URL PÚBLICA DO LOGO

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

async function getEngenieerData(engenieerId) {
  const db = admin.firestore();
  const doc = await db.collection("engenieer").doc(engenieerId).get();
  if (!doc.exists) throw new Error(`Engenheiro com ID ${engenieerId} não encontrado.`);
  return doc.data();
}

// ... (COLE AQUI O RESTANTE DAS SUAS FUNÇÕES DE DESENHO: addHeader, addFooter, drawTableRevisionControl, etc.)
// ... (Apenas garanta que elas não tenham 'admin.initializeApp' ou 'fs.readFileSync')
// ... (Lembre-se de usar 'await' ao chamá-las)


// --- Função Principal de Geração ---
async function generatePDF(projectData, clientData, engenieerData) {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Carrega o logo da URL
  const logoBytes = await axios.get(LOGO_URL, { responseType: 'arraybuffer' }).then(res => res.data);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  const headerAssets = { logoEmpresaImage, helveticaFont, helveticaBoldFont };

  // --- LÓGICA DE MONTAGEM DO DOCUMENTO ---
  const page = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, page, clientData, headerAssets);
  
  // ... (COLE AQUI TODA A LÓGICA DE DESENHO ESPECÍFICA DESTE PDF) ...
  
  await addFooter(pdfDoc, page, projectData, 1);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


// --- Handler de Exportação ---
async function generateOppeningPDF(projectId) {
  try {
    console.log(`[Abertura] Buscando dados para o projeto: ${projectId}`);
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);

    console.log("[Abertura] Dados obtidos. Iniciando a montagem do PDF.");
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData);
    
    console.log("[Abertura] PDF montado com sucesso.");
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Abertura] Erro fatal na geração do PDF:`, error);
    throw new Error(`Falha na geração do PDF de Abertura: ${error.message}`);
  }
}

// ✅ EXPORTAÇÃO PADRONIZADA
export default generateOppeningPDF;

