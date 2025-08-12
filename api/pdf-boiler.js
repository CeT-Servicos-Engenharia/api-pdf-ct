/**
 * Gerador de PDF - Caldeira (boiler)
 * Obs.: Por ora reutiliza o mesmo gerador do termo de abertura (pdf-oppening)
 * para manter compatibilidade e destravar a geração. Quando houver layout
 * específico da caldeira, basta substituir a chamada abaixo pelo novo gerador.
 */

const generateOppeningPDF = require("./pdf-oppening");

/**
 * Gera o PDF da caldeira a partir do projectId (documento em inspections/{projectId})
 * @param {string} projectId
 * @returns {Promise<Buffer>}
 */
module.exports = async function generateBoilerPDF(projectId) {
  if (!projectId) {
    throw new Error("projectId é obrigatório para gerar o PDF da caldeira");
  }
  try {
    // Reaproveita o gerador existente até termos um layout próprio
    const buffer = await generateOppeningPDF(projectId);
    return buffer;
  } catch (err) {
    // Adiciona contexto ao erro para facilitar logs
    err.message = `[pdf-boiler] ${err.message}`;
    throw err;
  }
};
