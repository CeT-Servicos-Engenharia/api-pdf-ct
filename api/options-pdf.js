// Importa o inicializador primeiro para garantir que o Firebase esteja pronto.
import './lib/firebase-admin.js';

// Importa todos os geradores de PDF.
// BLOCO CORRIGIDO
import './lib/firebase-admin.js'; // Boa prática adicionar .js aqui também

import generateBoilerPdf from "./generate-pdf.js";
import generateOppeningPDF from "./pdf-oppening.js";
import generatePressureVesselPdf from "./pdf-pressureVessel.js";
import generateUpdatePDF from "./pdf-update.js";
import generateMedicalRecordPdf from "./pdf-medical-record.js";


export default async function handler(req, res) {
  console.log("Handler da API 'options-pdf' iniciado.");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { projectId, type, update, opening, medicalRecord } = req.query;
  const updateFlag = update === "true";
  const openingFlag = opening === "true";
  const medicalRecordFlag = medicalRecord === "true";

  console.log("Parâmetros recebidos:", req.query);

  if (!projectId) {
    return res.status(400).json({ error: "O ID do projeto é obrigatório." });
  }

  try {
    let pdfBuffer;

    if (updateFlag) {
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (openingFlag) {
      pdfBuffer = await generateOppeningPDF(projectId, type);
    } else if (medicalRecordFlag) {
      pdfBuffer = await generateMedicalRecordPdf(projectId);
    } else {
      switch (type) {
        case "boiler":
          pdfBuffer = await generateBoilerPdf(projectId);
          break;
        case "pressure-vessel":
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        default:
          return res.status(400).json({ error: `Tipo de PDF inválido: ${type}` });
      }
    }

    console.log("Buffer do PDF gerado com sucesso. Enviando resposta.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=${type || "default"}.pdf`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error(`Erro fatal ao gerar PDF para o projeto ${projectId} (tipo: ${type}):`, error);
    res.status(500).json({ 
      error: "Erro interno ao gerar o PDF.",
      details: error.message
    });
  }
}
