import generateBoilerPdf from "./generate-pdf";
import generateOppeningPDF from "./pdf-oppening";
import generatePressureVesselPdf from "./pdf-pressureVessel";
import generateUpdatePDF from "./pdf-update";
import generateMedicalRecordPdf from "./pdf-medical-record";

export default async function handler(req, res) {
  console.log("Entrou no options-pdf!");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { projectId, type, update, opening, medicalRecord } = req.query;
  const updateFlag = update === "true";
  const openingFlag = opening === "true";
  const medicalRecordFlag = medicalRecord === "true";

  console.log("Parâmetros recebidos:", req.query);
  console.log(`update: ${updateFlag}, opening: ${openingFlag}`);
  console.log(`medicalRecord: ${medicalRecordFlag}`);
  if (!projectId) {
    return res.status(400).json({ error: "O ID do projeto é obrigatório." });
  }

  try {
    let pdfBuffer;

    if (updateFlag) {
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (openingFlag) {
      console.log("Gerando termo de abertura");
      pdfBuffer = await generateOppeningPDF(projectId, type);
    } else if (medicalRecordFlag) {
      console.log("Gerando prontuário reconstituído");
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
          pdfBuffer = await generateDefaultPDF(projectId);
          break;
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=${type || "default"}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Erro ao gerar PDF:", error);
    res.status(500).json({ error: "Erro interno ao gerar o PDF." });
  }
}
