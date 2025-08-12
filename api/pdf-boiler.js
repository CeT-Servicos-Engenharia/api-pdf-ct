/**
 * Gerador de PDF - Caldeira (boiler)
 * Wrapper temporário apontando para o gerador do termo de abertura.
 * Quando o layout da caldeira estiver pronto, substitua a chamada abaixo.
 */
const generateOppeningPDF = require("./pdf-oppening");

module.exports = async function generateBoilerPDF(projectId) {
  if (!projectId) throw new Error("projectId é obrigatório para gerar o PDF da caldeira");
  return await generateOppeningPDF(projectId);
};
