
const generateBoilerPdf = require("./generate-pdf");
const generateOppeningPDF = require("./pdf-oppening");
const generatePressureVesselPdf = require("./pdf-pressureVessel");
const generateUpdatePDF = require("./pdf-update");
const generateMedicalRecordPdf = require("./pdf-medical-record");

/**
 * Vercel Serverless Function (CommonJS)
 * Route: /api/options-pdf
 *
 * Example:
 *  /api/options-pdf?projectId=XXX&type=boiler&opening=false&update=false&medicalRecord=false
 */
module.exports = async function handler(req, res) {
  console.log("Entrou no options-pdf!");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { projectId, type, update, opening, medicalRecord } = req.query;

    const updateFlag = String(update) === "true";
    const openingFlag = String(opening) === "true";
    const medicalRecordFlag = String(medicalRecord) === "true";

    console.log("Parâmetros recebidos:", req.query);
    console.log(`update: ${updateFlag}, opening: ${openingFlag}, medicalRecord: ${medicalRecordFlag}, type: ${type}`);

    if (!projectId) {
      return res.status(400).json({ error: "Parâmetro 'projectId' é obrigatório." });
    }

    let pdfBuffer;

    // Prioridades (flags exclusivas)
    if (openingFlag) {
      pdfBuffer = await generateOppeningPDF(projectId);
    } else if (updateFlag) {
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (medicalRecordFlag) {
      pdfBuffer = await generateMedicalRecordPdf(projectId);
    } else {
      // Tipos padrão
      switch (type) {
        case "boiler":
          pdfBuffer = await generateBoilerPdf(projectId);
          break;
        case "pressure-vessel":
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        default:
          // fallback: gerar relatório padrão (boiler)
          pdfBuffer = await generateBoilerPdf(projectId);
          break;
      }
    }

    // Se a função retornou bytes de pdf-lib, garanta Buffer
    if (!(pdfBuffer instanceof Buffer)) {
      pdfBuffer = Buffer.from(pdfBuffer);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=${type || "relatorio"}.pdf`);
    res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    res.status(500).json({ error: "Erro interno ao gerar o PDF." });
  }
};
