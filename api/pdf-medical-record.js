import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import admin from "./lib/firebase-admin.js"; // ✅ USA O INICIALIZADOR CENTRAL
import axios from "axios";
import sharp from "sharp";

// --- Funções Auxiliares (padronizadas) ---
const LOGO_URL = "https://firebasestorage.googleapis.com/v0/b/nr13-c33f2/o/logo%2FCET%20LOGO%20-%20TRANSPARENCIA(1 ).png?alt=media&token=5a57863c-39a0-44f0-addd-39f131252709"; // ✅ URL PÚBLICA DO LOGO

// ... (COLE AQUI SUAS FUNÇÕES AUXILIARES: getProjectData, getClientData, getEngenieerData, etc.)


// --- Função Principal de Geração ---
async function generateMedicalRecordPDF(projectData, clientData, engenieerData) {
  const pdfDoc = await PDFDocument.create();
  // ... (COLE AQUI TODA A LÓGICA DE MONTAGEM DO PDF DE PRONTUÁRIO) ...
  // Lembre-se de carregar o logo via URL, não via 'fs'.
  
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


// --- Handler de Exportação ---
async function generateMedicalRecordPdfWrapper(projectId) {
  try {
    console.log(`[Prontuário] Buscando dados para o projeto: ${projectId}`);
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);

    console.log("[Prontuário] Dados obtidos. Iniciando a montagem do PDF.");
    const pdfBytes = await generateMedicalRecordPDF(projectData, clientData, engenieerData);
    
    console.log("[Prontuário] PDF montado com sucesso.");
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Prontuário] Erro fatal na geração do PDF:`, error);
    throw new Error(`Falha na geração do PDF de Prontuário: ${error.message}`);
  }
}

// ✅ EXPORTAÇÃO PADRONIZADA
export default generateMedicalRecordPdfWrapper;
