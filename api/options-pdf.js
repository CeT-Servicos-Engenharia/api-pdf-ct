const generateBoilerPdf = require("./generate-pdf.js");
const generateOppeningPDF = require("./pdf-oppening.js");
const generatePressureVesselPdf = require("./pdf-pressureVessel.js");
const generateUpdatePDF = require("./pdf-update.js");
const generateMedicalRecordPdf = require("./pdf-medical-record.js");

module.exports = async function handler(req, res) {
  console.log("Handler 'options-pdf' iniciado com sintaxe CommonJS.");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { projectId, type, update, opening, medicalRecord } = req.query;
  const updateFlag = update === "true";
  const openingFlag = opening === "true";
  const medicalRecordFlag = medicalRecord === "true";

  if (!projectId) {
    return res.status(400).json({ error: "O ID do projeto é obrigatório." });
  }

  try {
    let pdfBuffer;
    console.log(`Iniciando geração para tipo: ${type || (updateFlag && 'update') || (openingFlag && 'opening') || 'medicalRecord'}`);

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

    console.log("Buffer do PDF gerado. Enviando resposta...");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="relatorio.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error(`Erro fatal no handler 'options-pdf':`, error);
    res.status(500).json({ 
      error: "Erro interno ao gerar o PDF.",
      details: error.message 
    });
  }
};
