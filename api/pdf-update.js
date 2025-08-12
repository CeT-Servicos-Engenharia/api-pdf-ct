const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js"); // ✅ CORRIGIDO: Usa o inicializador central
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp"); // ✅ CORRIGIDO: Importado apenas UMA VEZ no topo

// ✅ REMOVIDO: Bloco de inicialização local do Firebase que causava o erro.

// --- Funções Auxiliares ---

async function downloadImageFromFirebase(url) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    if (!response || !response.data) {
      throw new Error("Imagem não encontrada ou vazia.");
    }
    return response.data;
  } catch (error) {
    console.error("Erro ao baixar a imagem do Firebase:", error.message);
    throw new Error("Falha ao baixar a imagem.");
  }
}

// ✅ REMOVIDA: A linha 'const sharp = require("sharp");' que estava duplicada aqui.

async function addFirebaseImageToPDF(pdfDoc, page, imageUrl, options = {}) {
  try {
    if (!imageUrl || typeof imageUrl !== "string") {
      console.warn("URL inválida ou nula. Ignorando...");
      return;
    }
    console.log("Baixando imagem do Firebase:", imageUrl);
    const imageBytes = await downloadImageFromFirebase(imageUrl);
    if (!imageBytes) {
      throw new Error("Bytes da imagem estão vazios.");
    }
    const imageBytesArray = new Uint8Array(imageBytes);
    const isPng = imageBytesArray[0] === 0x89 && imageBytesArray[1] === 0x50 && imageBytesArray[2] === 0x4e && imageBytesArray[3] === 0x47;
    const isJpeg = imageBytesArray[0] === 0xff && imageBytesArray[1] === 0xd8 && imageBytesArray[2] === 0xff;
    if (!isPng && !isJpeg) {
      throw new Error("Formato de imagem não suportado. Apenas PNG e JPEG são aceitos.");
    }
    console.log("Otimizando a imagem com sharp...");
    const optimizedImageBuffer = await sharp(imageBytes).resize(400).jpeg({ quality: 30 }).png({ quality: 30 }).toBuffer();
    const optimizedImageBytesArray = new Uint8Array(optimizedImageBuffer);
    const optimizedIsPng = optimizedImageBytesArray[0] === 0x89 && optimizedImageBytesArray[1] === 0x50 && optimizedImageBytesArray[2] === 0x4e && optimizedImageBytesArray[3] === 0x47;
    const embeddedImage = optimizedIsPng ? await pdfDoc.embedPng(optimizedImageBuffer) : await pdfDoc.embedJpg(optimizedImageBuffer);
    const { x = 50, y = 750, width = 100, height = 100 } = options;
    page.drawImage(embeddedImage, { x, y, width, height });
    console.log("Imagem otimizada e adicionada com sucesso!");
  } catch (error) {
    console.error("Erro ao adicionar a imagem do Firebase ao PDF:", error.message);
  }
}

async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) throw new Error("Projeto não encontrado");
  return doc.data();
}

async function getClientData(clientId) {
  if (!clientId) return null;
  const clientDocRef = admin.firestore().doc(`clients/${clientId}`);
  const clientDoc = await clientDocRef.get();
  if (clientDoc.exists) return clientDoc.data();
  return null;
}

async function getEngenieerData(engenieerId) {
  try {
    const engenieerDocRef = admin.firestore().doc(`engenieer/${engenieerId}`);
    const engenieerDoc = await engenieerDocRef.get();
    if (engenieerDoc.exists) {
      return engenieerDoc.data();
    } else {
      throw new Error("Engenheiro não encontrado");
    }
  } catch (error) {
    console.error("Erro ao buscar engenheiro:", error.message);
    throw error;
  }
}

const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");

async function addHeader(pdfDoc, page, clientData, assets) {
  try {
    const { logoEmpresaImage, helveticaFont, helveticaBoldFont } = assets;
    if (logoEmpresaImage) {
      page.drawImage(logoEmpresaImage, { x: 60, y: 740, width: 80, height: 80 });
    }
    const pageWidth = page.getWidth();
    const empresaText = "C&T Serviço Engenharia";
    const empresaTextWidth = helveticaBoldFont.widthOfTextAtSize(empresaText, 10);
    page.drawText(empresaText, { x: (pageWidth - empresaTextWidth) / 2, y: 790, size: 10, font: helveticaBoldFont });
    const enderecoText = "Avenida Sábia Q:30 L:27, CEP 75904-370";
    const enderecoTextWidth = helveticaFont.widthOfTextAtSize(enderecoText, 10);
    page.drawText(enderecoText, { x: (pageWidth - enderecoTextWidth) / 2, y: 780, size: 10, font: helveticaFont });
    const contatoText = "(64) 99244-2480, cleonis@engenhariact.com.br";
    const contatoTextWidth = helveticaFont.widthOfTextAtSize(contatoText, 10);
    page.drawText(contatoText, { x: (pageWidth - contatoTextWidth) / 2, y: 770, size: 10, font: helveticaFont });
  } catch (error) {
    console.error("Erro ao carregar o cabeçalho:", error.message);
  }
}

async function addFooter(pdfDoc, page, data, pageNumber) {
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const footerTextStart = `ART:${data.artProjeto}`;
  const footerTextEnd = `C&T.0.1 | ${data.numeroProjeto || " "} | ${data.inspection.endDate}`;
  const drawMultilineText = (text, x, y, lineHeight) => {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      page.drawText(line, { x: x, y: y - index * lineHeight, size: 10, font: helveticaFont, color: rgb(0.5, 0.5, 0.5) });
    });
  };
  const textWidthEnd = helveticaFont.widthOfTextAtSize("C&T.0.1 | " + data.inspection.endDate, 10);
  const xStart = 50;
  const xEnd = 598.28 - textWidthEnd - 50;
  const baseY = 50;
  const lineHeight = 12;
  drawMultilineText(footerTextStart, xStart, baseY, lineHeight);
  drawMultilineText(footerTextEnd, xEnd, baseY, lineHeight);
}

async function generatePDF(projectData, clientData, engenieerData) {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
  const headerAssets = { logoEmpresaImage, helveticaFont, helveticaBoldFont };
  const page = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, page, clientData, headerAssets);
  const xMiddle = (598.28 - helveticaFont.widthOfTextAtSize("TERMO DE ATUALIZAÇÃO", 24)) / 2;
  page.drawText(`TERMO DE ATUALIZAÇÃO`, { x: xMiddle, y: 700, size: 24, font: helveticaBoldFont, color: rgb(0, 0, 0) });

  async function drawIndentedText(page, text, x, y, maxWidth, font, fontSize, lineSpacing, indentSize) {
    const paragraphs = text.split("\n");
    let currentY = y;
    for (const paragraph of paragraphs) {
      const words = paragraph.split(" ");
      let currentLine = "";
      let isFirstLine = true;
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (textWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          page.drawText(currentLine, { x: isFirstLine ? x + indentSize : x, y: currentY, size: fontSize, font });
          isFirstLine = false;
          currentY -= fontSize + lineSpacing;
          currentLine = word;
        }
      }
      if (currentLine) {
        page.drawText(currentLine, { x: isFirstLine ? x + indentSize : x, y: currentY, size: fontSize, font });
        currentY -= fontSize + lineSpacing;
      }
    }
  }

  await drawIndentedText(page, `Em Conformidade ao que estabelece a Portaria SEPRT No 915 de 30 de Julho de 2019 do M.T.E. - Norma Regulamentadora No 13 (NR-13), atualização do Livro de Registro do equipamento tipo ${projectData.tipoEquipamento} descrito abaixo.`, 50, 664, 470, helveticaFont, 12, 4, 20);
  
  const rowHeight = 98;
  const headerRowHeight = 20;
  const dataRowHeight = 90;
  const tableDataRevisionControl = [["FABRICANTE", "ANO DE FABRICAÇÃO", "N° ART"], [`${projectData.fabricante || " "}`, `${projectData.anoFabricacao || " "}`, `${projectData.artProjeto || " "}`]];
  let columnWidthsDrawTableRevisionControl = [200, 180, 115.28];
  
  async function drawTableRevisionControl(page, pdfDoc, startX, startY, columnWidths, rowHeight, data, font, boldFont) {
    let currentY = startY;
    const header = data[0];
    header.forEach((cell, columnIndex) => {
      const columnWidth = columnWidths[columnIndex];
      const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      page.drawRectangle({ x, y: currentY - headerRowHeight, width: columnWidth, height: headerRowHeight, color: rgb(0.102, 0.204, 0.396), borderColor: rgb(0.102, 0.204, 0.396), borderWidth: 1 });
      const textWidth = boldFont.widthOfTextAtSize(cell, 12);
      const textX = x + (columnWidth - textWidth) / 2;
      page.drawText(cell, { x: textX, y: currentY - headerRowHeight / 2 - 5, size: 12, font: boldFont, color: rgb(1, 1, 1) });
    });
    currentY -= headerRowHeight;
    const lineHeight = 12;
    data.slice(1).forEach((row) => {
      row.forEach((cell, columnIndex) => {
        const columnWidth = columnWidths[columnIndex];
        const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
        page.drawRectangle({ x, y: currentY, width: columnWidth, height: dataRowHeight / -4, borderColor: rgb(0.102, 0.204, 0.396), borderWidth: 1 });
        const lines = cell.split("\n").map((line) => line.trim());
        let textY = currentY - 10;
        lines.forEach((line) => {
          const textWidth = font.widthOfTextAtSize(line, 10);
          const textX = x + (columnWidth - textWidth) / 2;
          page.drawText(line, { x: textX, y: textY - lineHeight + 10, size: 10, font: font, color: rgb(0, 0, 0) });
          textY -= lineHeight / 2;
        });
      });
      currentY -= dataRowHeight;
    });
  }

  await drawTableRevisionControl(page, pdfDoc, 50, 620, columnWidthsDrawTableRevisionControl, rowHeight, tableDataRevisionControl, helveticaFont, helveticaBoldFont);
  
  const tableDataAnotherExample = [["N° SÉRIE", "N° PATRIMÔNIO", "N° RELATÓRIO", "IDENTIFICADOR EQUIPAMENTO"], [`${projectData.numeroSerie || " "}`, `${projectData.numeroPatrimonio || " "}`, `${projectData.numeroProjeto || " "}`, `${projectData.nomeEquipamento || " "}`]];
  let columnWidthsAnotherExample = [100, 100, 100, 195.28];
  
  await drawTableRevisionControl(page, pdfDoc, 50, 577, columnWidthsAnotherExample, rowHeight, tableDataAnotherExample, helveticaFont, helveticaBoldFont);
  
  let typeInspectionsPeriodic = [];
  if (projectData.inspection.selectedPeriodicInspection.externa) typeInspectionsPeriodic.push("externo");
  if (projectData.inspection.selectedPeriodicInspection.hidrostatico) typeInspectionsPeriodic.push("hidrostático");
  if (projectData.inspection.selectedPeriodicInspection.interna) typeInspectionsPeriodic.push("interno");
  const typeInspectionsPeriodicText = typeInspectionsPeriodic.length > 0 ? typeInspectionsPeriodic.join(" e ") : "nenhuma inspeção";
  
  let resultInspectionText = "";
  if (projectData.inspection.selectedResultInspection.approved) {
    resultInspectionText = "Aprovado, estando desta forma em plenas condições técnicas de ser operado, desde que mantidos os componentes e acessórios apresentados nesta inspeção.";
  } else if (projectData.inspection.selectedResultInspection.failed) {
    resultInspectionText = "Reprovado, não estando em plenas condições técnicas de operação. Recomenda-se a correção das não conformidades identificadas antes de qualquer utilização.";
  } else {
    resultInspectionText = "O resultado da inspeção não foi determinado.";
  }
  
  await drawIndentedText(page, `Na Data ${projectData.inspection.endDate}, foi realizada a inspeção periodica consistindo de exame ${typeInspectionsPeriodicText}.\n\nApós análise e testes executados, o equipamento está ${resultInspectionText}`, 50, 520, 470, helveticaFont, 12, 4, 20);
  
  const tableDataEquipmentClassificationTitle = [["CLASSIFICAÇÃO DO EQUIPAMENTO"]];
  let columnWidthsEquipmentClassificationTitle = [495.28];
  
  await drawTableRevisionControl(page, pdfDoc, 50, 450, columnWidthsEquipmentClassificationTitle, rowHeight, tableDataEquipmentClassificationTitle, helveticaFont, helveticaBoldFont);
  
  const tableDataEquipmentClassification = [["TEMPERATURA DE PROJETO", "VOLUME", "CATEGORIA"], [`${projectData.temperaturaProjeto || ""}`, `${projectData.volume + projectData.tipoVolume || ""}`, `${projectData.categoriaCaldeira || ""}`]];
  let columnWidthsEquipmentClassification = [195.28, 150, 150];
  
  await drawTableRevisionControl(page, pdfDoc, 50, 430, columnWidthsEquipmentClassification, rowHeight, tableDataEquipmentClassification, helveticaFont, helveticaBoldFont);
  
  const tableDataEquipmentValuePression = [["PMTA", "PRESSAO DE TESTE HIDROSTÁTICO"], [`${projectData.pressaoMaxima + " " + projectData.unidadePressaoMaxima || ""}`, `${projectData.pressaoTeste + " " + projectData.unidadePressaoMaxima || ""}`]];
  let columnWidthsEquipmentValuePression = [247.64, 247.64];
  
  await drawTableRevisionControl(page, pdfDoc, 50, 390, columnWidthsEquipmentValuePression, rowHeight, tableDataEquipmentValuePression, helveticaFont, helveticaBoldFont);
  
  const tableDataEquipmentNextInspectionsTitle = [["CRONOGRAMA PRÓXIMAS INSPEÇÕES"]];
  let columnWidthsEquipmentNextInspectionsTitle = [495.28];
  
  await drawTableRevisionControl(page, pdfDoc, 50, 348, columnWidthsEquipmentNextInspectionsTitle, rowHeight, tableDataEquipmentNextInspectionsTitle, helveticaFont, helveticaBoldFont);
  
  const tableDataEquipmentInfosFinals = [["LOCAL DE INSTALAÇÃO", "DATA DE INSPEÇÃO"], [`${projectData.localInstalacao}`, `${projectData.inspection.endDate}`]];
  let columnWidthsEquipmentInfosFinals = [247.64, 247.64];
  
  await drawTableRevisionControl(page, pdfDoc, 50, 327.5, columnWidthsEquipmentInfosFinals, rowHeight, tableDataEquipmentInfosFinals, helveticaFont, helveticaBoldFont);
  
  const imageWidth = 150;
  const imageHeight = 80;
  const imageX = (598.28 - imageWidth) / 2;
  
  await addFirebaseImageToPDF(pdfDoc, page, engenieerData.signature, { x: imageX, y: 150, width: imageWidth, height: imageHeight });
  
  const lineStartX = 598.28 * 0.25;
  const lineEndX = 598.28 * 0.75;
  page.drawLine({ start: { x: lineStartX, y: 149 }, end: { x: lineEndX, y: 148 }, thickness: 1, color: rgb(0, 0, 0), opacity: 1 });
  
  const text1 = "Resp. Téc Cleonis Batista Santos";
  const text1Width = helveticaFont.widthOfTextAtSize(text1, 12);
  const text1X = (598.28 - text1Width) / 2;
  page.drawText(text1, { x: text1X, y: 136, size: 12, color: rgb(0, 0, 0), font: helveticaFont });
  
  const text2 = `CREA ${engenieerData.crea}`;
  const text2Width = helveticaFont.widthOfTextAtSize(text2, 12);
  const text2X = (598.28 - text2Width) / 2;
  page.drawText(text2, { x: text2X, y: 122, size: 12, color: rgb(0, 0, 0), font: helveticaFont });
  
  const text3 = "Engenheiro Mecânico/Segurança";
  const text3Width = helveticaFont.widthOfTextAtSize(text3, 12);
  const text3X = (598.28 - text3Width) / 2;
  page.drawText(text3, { x: text3X, y: 110, size: 12, color: rgb(0, 0, 0), font: helveticaFont });
  
  await addFooter(pdfDoc, page, projectData, 1);
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function generateUpdatePDF(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro 'projectId' é obrigatório.");
  }
  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData);
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF:", error.message);
    throw new Error("Erro ao gerar o PDF");
  }
}

module.exports = generateUpdatePDF;
