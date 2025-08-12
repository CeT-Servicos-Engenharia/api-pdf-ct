// api/generate-pdf.js

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import admin from "./lib/firebase-admin"; 
import axios from "axios";
import sharp from "sharp";

// ... (Suas outras funções como getProjectData, etc. devem estar aqui) ...
async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) throw new Error(`Projeto com ID ${projectId} não encontrado.`);
  return doc.data();
}

// ...

// Função principal com a lógica de erro corrigida
async function generateBoilerPdf(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro 'projectId' é obrigatório.");
  }

  // O bloco try agora envolve TODA a lógica de geração e retorno.
  try {
    console.log(`[Caldeira] Iniciando geração para o projeto: ${projectId}`);
    
    const projectData = await getProjectData(projectId);
    // ... buscar outros dados (cliente, engenheiro, etc.) ...

    const pdfDoc = await PDFDocument.create();
    
    // ... (COLE AQUI TODA A SUA LÓGICA PARA DESENHAR O PDF DA CALDEIRA) ...
    // Adicione console.log para depurar qual parte pode estar falhando.
    // Exemplo:
    // console.log("[Caldeira] Adicionando cabeçalho...");
    // await addHeader(pdfDoc, page, ...);
    // console.log("[Caldeira] Adicionando tabelas...");
    // await addTables(pdfDoc, page, ...);
    // console.log("[Caldeira] Adicionando imagens...");
    // await addImages(pdfDoc, page, ...);


    // Salva o documento em um buffer.
    const pdfBytes = await pdfDoc.save();
    
    console.log(`[Caldeira] PDF para o projeto ${projectId} gerado com sucesso. Retornando buffer.`);
    
    // ✅ CORREÇÃO: O retorno e a criação do Buffer acontecem DENTRO do try.
    // Se qualquer linha acima falhar, este código nunca será executado.
    return Buffer.from(pdfBytes);

  } catch (error) {
    // Se um erro ocorrer em qualquer lugar acima, ele será capturado aqui.
    console.error(`[Caldeira] ERRO FATAL ao gerar o PDF para o projeto ${projectId}:`, error);
    
    // Relança o erro para que o handler principal (options-pdf.js) possa capturá-lo
    // e enviar uma resposta 500 para o cliente.
    throw new Error(`Falha na geração do PDF da caldeira: ${error.message}`);
  }
}

// Exporte a função como padrão.
export default generateBoilerPdf;
