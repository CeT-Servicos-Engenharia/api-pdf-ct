// options-pdf.js - versão SAFE com requires preguiçosos (evita erro ao carregar módulos)
module.exports = async (req, res) => {
  try {
    const { projectId, type, opening, update, medicalRecord } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: "projectId é obrigatório" });
    }

    let pdfBuffer;

    // Flags diretas (mantidas como antes), mas com import dinâmico
    if (opening === "true") {
      const generateOppeningPDF = require("./pdf-oppening");
      pdfBuffer = await generateOppeningPDF(projectId);
    } else if (update === "true") {
      const generateUpdatePDF = require("./pdf-update");
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (medicalRecord === "true") {
      const generateMedicalRecordPDF = require("./pdf-medical-record");
      pdfBuffer = await generateMedicalRecordPDF(projectId);
    } else {
      switch (type) {
        case "pressure-vessel": {
          const generatePressureVesselPdf = require("./pdf-pressureVessel");
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        }
        case "opening": {
          const generateOppeningPDF = require("./pdf-oppening");
          pdfBuffer = await generateOppeningPDF(projectId);
          break;
        }
        case "boiler": {
          // manter comportamento antigo (apontava para generate-pdf.js)
          // se esse arquivo não gera nada, vai dar 500 só pra caldeira — que é o estado "antigo"
          const generatePDF = require("./generate-pdf");
          pdfBuffer = await generatePDF(projectId);
          break;
        }
        default:
          return res.status(400).json({ error: "type inválido. Use: boiler | opening | pressure-vessel" });
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${type || "document"}.pdf"`);
    res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error("[options-pdf SAFE] ERROR:", error);
    res.status(500).json({ error: "Erro interno ao gerar o PDF." });
  }
};
