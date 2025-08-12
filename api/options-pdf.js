const generateOppeningPDF = require("./pdf-oppening");
const generatePressureVesselPdf = require("./pdf-pressureVessel");
const generateUpdatePDF = require("./pdf-update");
const generateMedicalRecordPDF = require("./pdf-medical-record");

const USE_VERBOSE_ERRORS = true;

module.exports = async (req, res) => {
  const log = (...a) => console.log("[options-pdf]", ...a);
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
      pdfBuffer = await generateOppeningPDF(projectId);
    } else if (update === "true") {
      route = "update=true";
      log("route:", route);
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (medicalRecord === "true") {
      route = "medicalRecord=true";
      log("route:", route);
      pdfBuffer = await generateMedicalRecordPDF(projectId);
    } else {
      switch (type) {
        case "boiler":
          route = "type=boiler -> opening";
          log("route:", route);
          pdfBuffer = await generateOppeningPDF(projectId);
          break;
        case "opening":
          route = "type=opening";
          log("route:", route);
          pdfBuffer = await generateOppeningPDF(projectId);
          break;
        case "pressure-vessel":
          route = "type=pressure-vessel";
          log("route:", route);
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        default:
          return res.status(400).json({
            error: "type inválido. Use: boiler | opening | pressure-vessel",
            received: type
          });
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${type || "document"}.pdf"`);
    res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error("[options-pdf] ERROR:", error);
    if (USE_VERBOSE_ERRORS) {
      res.status(500).json({
        error: error?.message || "Erro ao gerar PDF",
        stack: error?.stack,
        name: error?.name
      });
    } else {
      res.status(500).json({ error: "Erro ao gerar PDF" });
    }
  }
};
