import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import admin from "./lib/firebase-admin"; // ✅ USA O INICIALIZADOR CENTRAL
import axios from "axios";
import sharp from "sharp";

// --- Funções Auxiliares (padronizadas) ---
const LOGO_URL = "https://firebasestorage.googleapis.com/v0/b/nr13-c33f2/o/logo%2FCET%20LOGO%20-%20TRANSPARENCIA(1 ).png?alt=media&token=5a57863c-39a0-44f0-addd-39f131252709"; // ✅ URL PÚBLICA DO LOGO

async function getProjectData(projectId) {
  // ... (código da função igual ao do arquivo anterior)
}
// ... (COLE AQUI SUAS OUTRAS FUNÇÕES AUXILIARES: getClientData, getEngenieerData, getAnalystData, etc.)


// --- Função Principal de Geração ---
async function generatePDF(data, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();
  // ... (COLE AQUI TODA A LÓGICA DE MONTAGEM DO PDF DE VASO DE PRESSÃO) ...
  // Lembre-se de carregar o logo via URL, não via 'fs'.
  // Exemplo:
  // const logoBytes = await axios.get(LOGO_URL, { responseType: 'arraybuffer' }).then(res => res.data);
  // const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
  
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


// --- Handler de Exportação ---
async function generatePressureVesselPdf(projectId) {
  try {
    console.log(`[Vaso de Pressão] Buscando dados para o projeto: ${projectId}`);
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);

    console.log("[Vaso de Pressão] Dados obtidos. Iniciando a montagem do PDF.");
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    
    console.log("[Vaso de Pressão] PDF montado com sucesso.");
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error(`[Vaso de Pressão] Erro fatal na geração do PDF:`, error);
    throw new Error(`Falha na geração do PDF de Vaso de Pressão: ${error.message}`);
  }
}

// ✅ EXPORTAÇÃO PADRONIZADA
export default generatePressureVesselPdf;
