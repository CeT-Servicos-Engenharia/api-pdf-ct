const generateBoilerPDF = require("./pdf-boiler");
const generateOppeningPDF = require("./pdf-oppening");
const generatePressureVesselPdf = require("./pdf-pressureVessel");
const generateUpdatePDF = require("./pdf-update");
const generateMedicalRecordPDF = require("./pdf-medical-record");

module.exports = async (req, res) => {
  try {
    const { projectId, type, opening, update, medicalRecord } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: "projectId é obrigatório" });
    }

    let pdfBuffer;

    // Casos específicos de geração direta
    if (opening === "true") {
      pdfBuffer = await generateOppeningPDF(projectId);
    } else if (update === "true") {
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (medicalRecord === "true") {
      pdfBuffer = await generateMedicalRecordPDF(projectId);
    } else {
      // Switch de tipos
      switch (type) {
        case "boiler":
          // Agora usamos um gerador dedicado (que por ora reusa o opening)
          pdfBuffer = await generateBoilerPDF(projectId);
          break;

        case "opening":
          pdfBuffer = await generateOppeningPDF(projectId);
          break;

        case "pressure-vessel":
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;

        default:
          return res
            .status(400)
            .json({ error: "type inválido. Use: boiler | opening | pressure-vessel" });
      }
    }

    // Resposta
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${type || "document"}.pdf"`);
    res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro interno ao gerar o PDF." });
  }
};
