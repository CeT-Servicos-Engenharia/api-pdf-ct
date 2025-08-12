// api/options-pdf.js

// ✅ CORREÇÃO: O caminho agora aponta para a pasta 'lib'
import './lib/firebase-admin'; 

// O resto do arquivo permanece o mesmo...
import generateBoilerPdf from "./generate-pdf";
import generateOppeningPDF from "./pdf-oppening";
import generatePressureVesselPdf from "./pdf-pressureVessel";
import generateUpdatePDF from "./pdf-update";
import generateMedicalRecordPdf from "./pdf-medical-record";

export default async function handler(req, res) {
  console.log("Handler da API 'options-pdf' iniciado.");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { projectId, type, update, opening, medicalRecord } = req.query;
  // ... (o resto do seu código continua exatamente igual)
  // ...
  try {
    let pdfBuffer;

    // ... (sua lógica de switch/case) ...
    switch (type) {
      case "boiler":
        console.log(`Gerando PDF de caldeira para o projeto: ${projectId}`);
        pdfBuffer = await generateBoilerPdf(projectId);
        break;
      // ... outros casos ...
    }

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
