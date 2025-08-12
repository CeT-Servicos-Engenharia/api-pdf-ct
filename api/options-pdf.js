// api/options-pdf.js

// PASSO 1: Importe a instância centralizada do Firebase.
// Isso garante que o Firebase seja inicializado apenas uma vez.
import './lib/firebase-admin'; // O caminho para o seu arquivo de inicialização do Firebase

// PASSO 2: Importe todos os seus geradores de PDF.
// A importação `import generateBoilerPdf from "./generate-pdf";` agora funcionará
// porque o arquivo `generate-pdf.js` usará `export default`.
import generateBoilerPdf from "./generate-pdf";
import generateOppeningPDF from "./pdf-oppening";
import generatePressureVesselPdf from "./pdf-pressureVessel";
import generateUpdatePDF from "./pdf-update";
import generateMedicalRecordPdf from "./pdf-medical-record";

// Função handler da API, agora mais limpa e focada.
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

    // A lógica de seleção do gerador de PDF permanece a mesma.
    if (updateFlag) {
      console.log(`Gerando PDF de atualização para o projeto: ${projectId}`);
      pdfBuffer = await generateUpdatePDF(projectId);
    } else if (openingFlag) {
      console.log(`Gerando termo de abertura para o projeto: ${projectId}`);
      pdfBuffer = await generateOppeningPDF(projectId, type);
    } else if (medicalRecordFlag) {
      console.log(`Gerando prontuário para o projeto: ${projectId}`);
      pdfBuffer = await generateMedicalRecordPdf(projectId);
    } else {
      switch (type) {
        case "boiler":
          console.log(`Gerando PDF de caldeira para o projeto: ${projectId}`);
          pdfBuffer = await generateBoilerPdf(projectId);
          break;
        case "pressure-vessel":
          console.log(`Gerando PDF de vaso de pressão para o projeto: ${projectId}`);
          pdfBuffer = await generatePressureVesselPdf(projectId);
          break;
        default:
          // É uma boa prática ter um caso padrão ou lançar um erro se o tipo for desconhecido.
          console.error(`Tipo de PDF desconhecido: ${type}`);
          return res.status(400).json({ error: `Tipo de PDF inválido: ${type}` });
      }
    }

    console.log("Buffer do PDF gerado com sucesso. Enviando resposta.");

    // Envia o PDF como resposta.
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=${type || "default"}.pdf`);
    res.send(pdfBuffer);

  } catch (error) {
    // Log detalhado do erro no servidor (visível nos logs da Vercel).
    console.error(`Erro fatal ao gerar PDF para o projeto ${projectId} (tipo: ${type}):`, error);
    
    // Envia uma resposta de erro genérica para o cliente.
    res.status(500).json({ 
      error: "Erro interno ao gerar o PDF.",
      details: error.message // Opcional: envie a mensagem de erro para depuração.
    });
  }
}
