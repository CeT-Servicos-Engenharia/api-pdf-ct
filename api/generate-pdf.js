import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import admin from "./lib/firebase-admin.js"; // Adicionado .js por boa prática
import axios from "axios";
import sharp from "sharp";

// --- Constantes ---
// Coloque a URL pública do seu logo aqui
const LOGO_URL = "https://firebasestorage.googleapis.com/v0/b/nr13-c33f2/o/logo%2FCET%20LOGO%20-%20TRANSPARENCIA(1  ).png?alt=media&token=5a57863c-39a0-44f0-addd-39f131252709";

// --- Funções Auxiliares de Busca de Dados (Firestore) ---

async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) {
    throw new Error(`Projeto com ID ${projectId} não encontrado.`);
  }
  return doc.data();
}

async function getClientData(clientId) {
  if (!clientId) return null;
  const db = admin.firestore();
  const doc = await db.collection("clients").doc(clientId).get();
  return doc.exists ? doc.data() : null;
}

// ✅ FUNÇÃO CORRIGIDA (Adicionada)
async function getEngenieerData(engenieerId) {
  if (!engenieerId) return null;
  const db = admin.firestore();
  const doc = await db.collection("engenieer").doc(engenieerId).get();
  if (!doc.exists) {
    console.warn(`Engenheiro com ID ${engenieerId} não encontrado.`);
    return null; // Retorna null para evitar quebrar a execução
  }
  return doc.data();
}

// ✅ FUNÇÃO CORRIGIDA (Adicionada)
async function getAnalystData(analystId) {
  if (!analystId) return null;
  const db = admin.firestore();
  const doc = await db.collection("analyst").doc(analystId).get();
  if (!doc.exists) {
    console.warn(`Analista com ID ${analystId} não encontrado.`);
    return null; // Retorna null para evitar quebrar a execução
  }
  return doc.data();
}

// --- Funções de Desenho do PDF (Exemplos) ---
// (Adapte ou cole suas funções de desenho aqui, como addHeader, addFooter, etc.)

async function addHeader(pdfDoc, page, clientData, assets) {
  // Exemplo de implementação de header
  page.drawImage(assets.logoEmpresaImage, { x: 50, y: 750, width: 80, height: 80 });
  page.drawText("Relatório de Inspeção de Caldeira", {
    x: 150,
    y: 780,
    font: assets.helveticaBoldFont,
    size: 18,
  });
  if (clientData?.name) {
    page.drawText(`Cliente: ${clientData.name}`, {
      x: 150,
      y: 760,
      font: assets.helveticaFont,
      size: 12,
    });
  }
}

async function addFooter(pdfDoc, page, projectData, pageNumber) {
  // Exemplo de implementação de footer
  page.drawText(`Página ${pageNumber} | Projeto ID: ${projectData.projectId || 'N/A'}`, {
    x: 50,
    y: 50,
    size: 8,
  });
}


// --- Função Principal de Geração do PDF ---

async function generatePDF(projectData, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();
  
  // Carrega o logo da URL e as fontes
  const logoBytes = await axios.get(LOGO_URL, { responseType: 'arraybuffer' }).then(res => res.data);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const headerAssets = { logoEmpresaImage, helveticaFont, helveticaBoldFont };

  // --- LÓGICA DE MONTAGEM DO DOCUMENTO ---
  // Substitua este bloco pelo seu código real de montagem de páginas
  
  console.log("[Caldeira] Adicionando primeira página...");
  const page1 = pdfDoc.addPage();
  await addHeader(pdfDoc, page1, clientData, headerAssets);
  // ... aqui vai todo o seu código para desenhar o conteúdo da página 1 ...
  page1.drawText("Conteúdo da primeira página do relatório da caldeira.", { x: 50, y: 700 });
  await addFooter(pdfDoc, page1, projectData, 1);
  
  console.log("[Caldeira] Adicionando segunda página...");
  const page2 = pdfDoc.addPage();
  await addHeader(pdfDoc, page2, clientData, headerAssets);
  // ... aqui vai todo o seu código para desenhar o conteúdo da página 2 ...
  page2.drawText("Conteúdo da segunda página do relatório da caldeira.", { x: 50, y: 700 });
  await addFooter(pdfDoc, page2, projectData, 2);

  // ... continue para todas as páginas necessárias ...

  console.log("[Caldeira] Salvando o documento...");
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


// --- Handler de Exportação (Função que será importada por options-pdf.js) ---

async function generateBoilerPdf(projectId) {
  try {
    console.log(`[Caldeira] Buscando dados para o projeto: ${projectId}`);
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    // ✅ CHAMADAS CORRIGIDAS - Agora as funções existem neste arquivo
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);

    console.log("[Caldeira] Dados obtidos. Iniciando a montagem do PDF.");
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    
    console.log("[Caldeira] PDF montado com sucesso.");
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Caldeira] Erro fatal na geração do PDF:`, error);
    // Lança um novo erro para ser capturado pelo handler principal em options-pdf.js
    throw new Error(`Falha na geração do PDF da Caldeira: ${error.message}`);
  }
}

export default generateBoilerPdf;

  
