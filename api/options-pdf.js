// options-pdf.js - DEBUG SAFE (lazy requires + erro detalhado no response)
// Agora: case "boiler" usa ./pdf-boiler (um wrapper que aponta para pdf-oppening)
module.exports = async (req, res) => {
  const log = (...a) => console.log("[options-pdf DEBUG]", ...a);
  try {
    const { projectId, type, opening, update, medicalRecord } = req.query;

    log("query:", { projectId, type, opening, update, medicalRecord });

    if (!projectId) {
      return res.status(400).json({ error: "projectId é obrigatório" });
    }

    let pdfBuffer;
    let route = "unknown";

    if (opening === "true") {
      route = "opening=true";
      log("route:", route);
      const generateOppeningPDF = require("./pdf-oppening");
      pdfBuffer = await generateOppeningPDF(projectId);
    } else if (update === "true") {
      route = "update=true";
      log("route:", route);
      const generateUpdatePDF = require("./pdf-update");
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (medicalRecord === "true") {
      route = "medicalRecord=true";
      log("route:", route);
      const generateMedicalRecordPDF = require("./pdf-medical-record");
      pdfBuffer = await generateMedicalRecordPDF(projectId);
    } else {
      switch (type) {
        case "pressure-vessel": {
          route = "type=pressure-vessel";
          log("route:", route);
          const generatePressureVesselPdf = require("./pdf-pressureVessel");
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        }
        case "opening": {
          route = "type=opening";
          log("route:", route);
          const generateOppeningPDF = require("./pdf-oppening");
          pdfBuffer = await generateOppeningPDF(projectId);
          break;
        }
        case "boiler": {
          route = "type=boiler -> pdf-boiler";
          log("route:", route);
          const generateBoilerPDF = require("./pdf-boiler");
          pdfBuffer = await generateBoilerPDF(projectId);
          break;
        }
        default:
          return res.status(400).json({ error: "type inválido. Use: boiler | opening | pressure-vessel", received: type });
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${type || "document"}.pdf"`);
    res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error("[options-pdf DEBUG] ERROR:", error);
    res.status(500).json({
      error: error?.message || "Erro ao gerar PDF",
      name: error?.name,
      stack: error?.stack
    });
  }
};
