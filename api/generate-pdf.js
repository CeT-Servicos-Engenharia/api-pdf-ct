
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// ------------------------------------------------------
// Utilitários
// ------------------------------------------------------
async function baixarEComprimirTodasImagens(imageUrls) {
  if (!imageUrls || !Array.isArray(imageUrls)) return [];
  const compressedImages = [];
  for (const url of imageUrls) {
    if (!url) continue;
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      const imageBytes = Buffer.from(response.data, "binary");
      const optimizedBuffer = await sharp(imageBytes).resize({ width: 400 }).jpeg({ quality: 40 }).toBuffer();
      compressedImages.push({ url, buffer: optimizedBuffer });
    } catch (error) {
      console.error("Erro ao baixar/comprimir imagem:", url, error.message);
    }
  }
  return compressedImages;
}

function formatDate(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// ------------------------------------------------------
// Firestore
// ------------------------------------------------------
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
  return clientDoc.exists ? clientDoc.data() : null;
}

async function getEngenieerData(engenieerId) {
  if (!engenieerId) return null;
  const engenieerDocRef = admin.firestore().doc(`engenieer/${engenieerId}`);
  const engenieerDoc = await engenieerDocRef.get();
  return engenieerDoc.exists ? engenieerDoc.data() : null;
}

async function getAnalystData(analystId) {
  if (!analystId) return null;
  const analystDocRef = admin.firestore().doc(`analyst/${analystId}`);
  const analystDoc = await analystDocRef.get();
  return analystDoc.exists ? analystDoc.data() : null;
}

// ------------------------------------------------------
// Helpers de desenho
// ------------------------------------------------------
async function addHeader(pdfDoc, page, clientData, assets) {
  try {
    const {
      logoEmpresaImage,
      logoClienteImage,
      helveticaFont,
      helveticaBoldFont,
    } = assets;

    // Logo da empresa
    if (logoEmpresaImage) {
      page.drawImage(logoEmpresaImage, {
        x: 60,
        y: 740,
        width: 80,
        height: 80,
      });
    }

    // Logo do cliente (se houver)
    if (logoClienteImage) {
      page.drawImage(logoClienteImage, {
        x: 448,
        y: 740,
        width: 80,
        height: 80,
      });
    }

    const pageWidth = page.getWidth();

    const empresaText = "C&T Serviço Engenharia";
    const empresaTextWidth = helveticaBoldFont.widthOfTextAtSize(empresaText, 10);
    page.drawText(empresaText, {
      x: (pageWidth - empresaTextWidth) / 2,
      y: 790,
      size: 10,
      font: helveticaBoldFont,
    });

    const enderecoText = "Avenida Sábia Q:30 L:27, CEP 75904-370";
    const enderecoTextWidth = helveticaFont.widthOfTextAtSize(enderecoText, 10);
    page.drawText(enderecoText, {
      x: (pageWidth - enderecoTextWidth) / 2,
      y: 780,
      size: 10,
      font: helveticaFont,
    });

    const contatoText = "(64) 99244-2480, cleonis@engenhariact.com.br";
    const contatoTextWidth = helveticaFont.widthOfTextAtSize(contatoText, 10);
    page.drawText(contatoText, {
      x: (pageWidth - contatoTextWidth) / 2,
      y: 770,
      size: 10,
      font: helveticaFont,
    });
  } catch (error) {
    console.error("Erro ao desenhar o cabeçalho:", error.message);
  }
}

async function addFooter(pdfDoc, page, data, pageNumber = null) {
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pageWidth = page.getWidth();
  const formattedDate = data.inspection?.endDate ? formatDate(data.inspection.endDate) : "N/A";

  // Se pageNumber não for fornecido, calcula baseado no índice da página
  if (pageNumber === null) {
    const pages = [];
    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
      pages.push(pdfDoc.getPage(i));
    }
    const currentPageIndex = pages.indexOf(page);
    pageNumber = currentPageIndex + 1;
  }

  const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto || ""}`;
  const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
  const footerTextEnd = `C&T.0.1 | ${formattedDate}\nPágina ${pageNumber}`;

  const drawMultilineText = (text, x, y, lineHeight) => {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      page.drawText(line, {
        x,
        y: y - index * lineHeight,
        size: 10,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5),
      });
    });
  };

  const textWidthMiddle = helveticaFont.widthOfTextAtSize("Cleonis Batista Santos", 10);
  const textWidthEnd = helveticaFont.widthOfTextAtSize("C&T.0.1 | " + formattedDate, 10);

  const xStart = 50;
  const xMiddle = (pageWidth - textWidthMiddle) / 3;
  const xEnd = pageWidth - textWidthEnd - 50;
  const baseY = 50;
  const lineHeight = 12;

  drawMultilineText(footerTextStart, xStart, baseY, lineHeight);
  drawMultilineText(footerTextMiddle, xMiddle, baseY, lineHeight);
  drawMultilineText(footerTextEnd, xEnd, baseY, lineHeight);
}

function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(" ");
  let lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function drawPaginatedTable({
  pdfDoc,
  page,
  startX,
  startY,
  columnWidths,
  rowHeight,
  headers,
  tableData,
  helveticaFont,
  helveticaBoldFont,
  clientData,
  data,
  headerAssets,
}) {
  let currentPage = page;
  let currentY = startY;
  const pageHeight = currentPage.getHeight();
  const margin = 50;
  const headerRowHeight = 20;
  const textPadding = 10;
  const lineHeight = 12;

  const drawHeader = () => {
    // Cabeçalho azul
    let x = startX;
    for (let i = 0; i < headers.length; i++) {
      currentPage.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidths[i],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396),
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      currentPage.drawText(headers[i], {
        x: x + 10,
        y: currentY - headerRowHeight / 2 - 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1),
      });
      x += columnWidths[i];
    }
    currentY -= headerRowHeight;
  };

  const drawRow = async (row) => {
    // Altura dinâmica baseada no conteúdo mais alto
    let maxLinesInRow = 1;
    const colLines = [];
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] ?? "");
      const maxWidth = columnWidths[i] - 2 * textPadding;
      const allLines = cell.split("\n").flatMap(line => wrapText(line.trim(), maxWidth, helveticaFont, 10));
      colLines.push(allLines);
      maxLinesInRow = Math.max(maxLinesInRow, allLines.length);
    }
    const dynamicRowHeight = Math.max(rowHeight, maxLinesInRow * lineHeight + 2 * textPadding);

    let x = startX;
    for (let i = 0; i < row.length; i++) {
      currentPage.drawRectangle({
        x,
        y: currentY - dynamicRowHeight,
        width: columnWidths[i],
        height: dynamicRowHeight,
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      let textY = currentY - textPadding;
      for (const line of colLines[i]) {
        currentPage.drawText(line, {
          x: x + textPadding,
          y: textY - lineHeight,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight;
      }

      x += columnWidths[i];
    }
    currentY -= dynamicRowHeight;
  };

  // Inicia
  drawHeader();

  for (const row of tableData) {
    if (currentY - rowHeight < margin) {
      await addFooter(pdfDoc, currentPage, data);
      currentPage = pdfDoc.addPage([595.28, 841.89]);
      await addHeader(pdfDoc, currentPage, clientData, headerAssets);
      currentY = pageHeight - margin - 60;
      drawHeader();
    }
    await drawRow(row);
  }
  await addFooter(pdfDoc, currentPage, data);
}

// ------------------------------------------------------
// Blocos / Tabelas específicas
// ------------------------------------------------------
async function drawTableRegistrationData(page, pdfDoc, startX, startY, columnWidths, data, helveticaFont, helveticaBoldFont) {
  const headerRowHeight = 20;
  const dataRowHeight = 90;
  const textPadding = 10;
  const lineHeight = 12;

  const headers = ["CLIENTE", "ELABORAÇÃO"];
  // Cabeçalho azul
  headers.forEach((cell, columnIndex) => {
    const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
    page.drawRectangle({
      x,
      y: startY - headerRowHeight,
      width: columnWidths[columnIndex],
      height: headerRowHeight,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });
    page.drawText(cell, {
      x: x + 10,
      y: startY - headerRowHeight / 2 - 5,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });
  });

  const rows = [
    [
      `  ${data.client?.person || ""}\n${data.client?.address || ""}, ${data.client?.neighborhood || ""}, ${data.client?.number || ""}\nCEP: ${data.client?.cep || ""}\nCNPJ: ${data.client?.cnpj || ""}\nTEL.: ${data.client?.phone || ""}\nE-mail: ${data.client?.email || ""}`,
      `  Cleonis Batista Santos\nRua Laudemiro José Bueno, Centro, 192\nCEP: 75901130\nCNPJ: 28992646000111\nCREA: 24625/ D-GO\nTEL.: 64992442480\nE-mail: cleonis@engenhariact.com.br`,
    ],
  ];

  let currentY = startY - headerRowHeight;
  rows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - dataRowHeight,
        width: columnWidths[columnIndex],
        height: dataRowHeight,
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      const maxWidth = columnWidths[columnIndex] - 2 * textPadding;
      const lines = cell.split("\n").flatMap(line => wrapText(line.trim(), maxWidth, helveticaFont, 10));
      let textY = currentY - textPadding;
      lines.forEach((line) => {
        page.drawText(line, {
          x: x + textPadding,
          y: textY - lineHeight,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight;
      });
    });
    currentY -= dataRowHeight;
  });
}

async function drawTableTechnicalManagers(page, pdfDoc, startX, startY, columnWidths, analista, engenheiro, helveticaFont, helveticaBoldFont) {
  const headerRowHeight = 20;
  const dataRowHeight = 90;
  const textPadding = 10;
  const lineHeight = 12;
  const headers = ["ANALISTA", "ENGENHEIRO"];

  headers.forEach((cell, columnIndex) => {
    const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
    page.drawRectangle({
      x,
      y: startY - headerRowHeight,
      width: columnWidths[columnIndex],
      height: headerRowHeight,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });
    page.drawText(cell, {
      x: x + 10,
      y: startY - headerRowHeight / 2 - 5,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });
  });

  const rows = [
    [
      `  ${analista?.name || ""}\nE-mail: ${analista?.email || "N/C"}`,
      `  ${engenheiro?.name || ""}\nCREA: ${engenheiro?.crea || ""}`,
    ],
  ];

  let currentY = startY - headerRowHeight;
  rows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - dataRowHeight,
        width: columnWidths[columnIndex],
        height: dataRowHeight,
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      const maxWidth = columnWidths[columnIndex] - 2 * textPadding;
      const lines = cell.split("\n").flatMap(line => wrapText(line.trim(), maxWidth, helveticaFont, 10));
      let textY = currentY - textPadding;
      lines.forEach((line) => {
        page.drawText(line, {
          x: x + textPadding,
          y: textY - lineHeight + 10,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight / 2;
      });
    });
    currentY -= dataRowHeight;
  });
}

async function drawTableRevisionControl(page, pdfDoc, startX, startY, columnWidths, data, helveticaFont, helveticaBoldFont) {
  const headerRowHeight = 20;
  const dataRowHeight = 90;
  const textPadding = 10;
  const lineHeight = 12;

  const headers = ["REVISÃO", "DESCRIÇÃO", "RESPONSÁVEL", "DATA"];
  headers.forEach((cell, columnIndex) => {
    const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
    page.drawRectangle({
      x,
      y: startY - headerRowHeight,
      width: columnWidths[columnIndex],
      height: headerRowHeight,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });
    page.drawText(cell, {
      x: x + 10,
      y: startY - headerRowHeight / 2 - 5,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });
  });

  const row = [
    `${data.numeroProjeto || ""}`,
    `${data.descricaoRevisao || ""}`,
    `${data.analyst?.name || ""}`,
    `${data.inspection?.endDate || "N/A"}`,
  ];

  let currentY = startY - headerRowHeight;

  row.forEach((cell, columnIndex) => {
    const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
    page.drawRectangle({
      x,
      y: currentY - dataRowHeight/4,
      width: columnWidths[columnIndex],
      height: dataRowHeight/4,
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });

    const maxWidth = columnWidths[columnIndex] - 2 * textPadding;
    const lines = String(cell).split("\n").flatMap(line => wrapText(line.trim(), maxWidth, helveticaFont, 10));
    let textY = currentY - textPadding;
    lines.forEach((line) => {
      page.drawText(line, {
        x: x + textPadding,
        y: textY - lineHeight + 10,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
      textY -= lineHeight / 2;
    });
  });
}

async function drawTableContractedInspections(page, pdfDoc, startX, startY, columnWidths, data, helveticaFont, helveticaBoldFont) {
  const headerRowHeight = 20;
  const dataRowHeight = 90;
  const textPadding = 10;
  const lineHeight = 12;

  const headers = ["TIPO", "CARACTERÍSTICA", "DATA INÍCIO", "DATA TÉRMINO"];
  headers.forEach((cell, columnIndex) => {
    const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
    page.drawRectangle({
      x,
      y: startY - headerRowHeight,
      width: columnWidths[columnIndex],
      height: headerRowHeight,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });
    page.drawText(cell, {
      x: x + 10,
      y: startY - headerRowHeight / 2 - 5,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });
  });

  const tipo = [
    data.inspection?.selectedTypesInspection?.extraordinaria ? "Extraordinária" : null,
    data.inspection?.selectedTypesInspection?.inicial ? "Inicial" : null,
    data.inspection?.selectedTypesInspection?.periodica ? "Periódica" : null,
  ].filter(Boolean).join(", ");

  const caracteristica = [
    data.inspection?.selectedPeriodicInspection?.externa ? "Externa" : null,
    data.inspection?.selectedPeriodicInspection?.interna ? "Interna" : null,
    data.inspection?.selectedPeriodicInspection?.hidrostatico ? "Hidrostático" : null,
  ].filter(Boolean).join(", ");

  const row = [
    tipo || " ",
    caracteristica || " ",
    data.inspection?.startDate || "N/A",
    data.inspection?.endDate || "N/A",
  ];

  let currentY = startY - headerRowHeight;

  row.forEach((cell, columnIndex) => {
    const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
    page.drawRectangle({
      x,
      y: currentY - dataRowHeight/4,
      width: columnWidths[columnIndex],
      height: dataRowHeight/4,
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });

    const maxWidth = columnWidths[columnIndex] - 2 * textPadding;
    const lines = String(cell).split("\n").flatMap(line => wrapText(line.trim(), maxWidth, helveticaFont, 10));
    let textY = currentY - textPadding;
    lines.forEach((line) => {
      page.drawText(line, {
        x: x + textPadding,
        y: textY - lineHeight + 10,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
      textY -= lineHeight / 2;
    });
  });
}

async function drawImageGrid({ page, pdfDoc, startX, startY, columnWidth, images, helveticaFont, helveticaBoldFont }) {
  const headerHeight = 20;
  const padding = 5;

  // Cabeçalho azul
  page.drawRectangle({
    x: startX,
    y: startY - 30,
    width: 495.28,
    height: headerHeight,
    color: rgb(0.102, 0.204, 0.396),
  });

  page.drawText("IDENTIFICAÇÃO", {
    x: startX + 180,
    y: startY - 22,
    size: 12,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  let currentX = startX;
  let currentY = startY - headerHeight - padding;

  const captions = ["Geral", "Traseira", "Direita", "Esquerda", "Frontal", "Placa"];

  for (let i = 0; i < Math.min(images.length, 6); i++) {
    const imageObj = images[i];
    if (!imageObj || !imageObj.buffer) continue;

    const pdfImage = await pdfDoc.embedJpg(imageObj.buffer);
    const imageWidth = columnWidth;
    const aspectRatio = pdfImage.height / pdfImage.width;
    const imageHeight = 150;

    page.drawImage(pdfImage, {
      x: currentX,
      y: currentY - imageHeight,
      width: imageWidth,
      height: imageHeight,
    });

    const caption = captions[i] || "";
    page.drawText(caption, {
      x: currentX + (imageWidth/2 - helveticaFont.widthOfTextAtSize(caption, 10)/2),
      y: currentY - imageHeight - 12,
      size: 10,
      font: helveticaFont,
    });

    currentX += columnWidth + padding;
    if ((i + 1) % 3 === 0) {
      currentX = startX;
      currentY -= (imageHeight + 30);
    }
  }
}

async function drawTableGeralDatas({ page, startX, startY, columnWidths, rows, helveticaFont, helveticaBoldFont }) {
  const headerHeight = 20;
  const rowHeight = 20;

  page.drawRectangle({
    x: startX,
    y: startY,
    width: 495.5,
    height: headerHeight,
    color: rgb(0.102, 0.204, 0.396),
  });
  page.drawText("DADOS GERAIS", {
    x: startX + 180,
    y: startY + 5,
    size: 10,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  let currentY = startY - headerHeight;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let currentX = startX;

    for (let j = 0; j < row.length; j++) {
      const cellText = String(row[j] ?? "");
      const cellWidth = columnWidths[j];

      page.drawRectangle({
        x: currentX,
        y: currentY,
        width: cellWidth,
        height: rowHeight,
        borderWidth: 1,
        borderColor: rgb(0.102, 0.204, 0.396),
      });

      page.drawText(cellText, {
        x: currentX + 5,
        y: currentY + 6,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });

      currentX += cellWidth;
    }
    currentY -= rowHeight;
  }
}

async function drawTableCategorization(page, startX, startY, columnWidths, rows, helveticaFont, helveticaBoldFont) {
  const headerHeight = 20;
  const rowHeight = 20;

  page.drawRectangle({
    x: startX,
    y: startY,
    width: 495.5,
    height: headerHeight,
    color: rgb(0.102, 0.204, 0.396),
  });

  page.drawText("DADOS DE CATEGORIA", {
    x: startX + 180,
    y: startY + 5,
    size: 10,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  let currentY = startY - headerHeight;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let currentX = startX;
    for (let j = 0; j < row.length; j++) {
      const cellText = String(row[j] ?? "");
      const cellWidth = columnWidths[j];

      page.drawRectangle({
        x: currentX,
        y: currentY,
        width: cellWidth,
        height: rowHeight,
        borderWidth: 1,
        borderColor: rgb(0.102, 0.204, 0.396),
      });

      page.drawText(cellText, {
        x: currentX + 5,
        y: currentY + 6,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
      currentX += cellWidth;
    }
    currentY -= rowHeight;
  }
}

async function drawIndentedJustifiedText(page, text, x, y, maxWidth, font, fontSize, lineSpacing, indentSize) {
  const paragraphs = text.split("\n");
  let currentY = y;

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") continue;

    const words = paragraph.split(/\s+/);
    let lines = [];
    let currentLine = [];
    let currentLineWidth = 0;
    let isFirstLine = true;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordWidth = font.widthOfTextAtSize(word, fontSize);
      const spaceWidth = font.widthOfTextAtSize(" ", fontSize);
      const effectiveMaxWidth = isFirstLine ? maxWidth - indentSize : maxWidth;

      if (currentLineWidth + wordWidth + (currentLine.length > 0 ? spaceWidth : 0) <= effectiveMaxWidth) {
        currentLine.push(word);
        currentLineWidth += wordWidth + (currentLine.length > 1 ? spaceWidth : 0);
      } else {
        lines.push({ words: currentLine, isFirst: isFirstLine });
        currentLine = [word];
        currentLineWidth = wordWidth;
        isFirstLine = false;
      }
    }
    if (currentLine.length > 0) {
      lines.push({ words: currentLine, isFirst: isFirstLine });
    }

    for (let i = 0; i < lines.length; i++) {
      const { words, isFirst } = lines[i];
      const lineText = words.join(" ");
      const lineWidth = font.widthOfTextAtSize(lineText, fontSize);
      const extraSpace = (maxWidth - (isFirst ? lineWidth + indentSize : lineWidth)) / (words.length - 1 || 1);
      let cursorX = x + (isFirst ? indentSize : 0);

      for (let j = 0; j < words.length; j++) {
        const word = words[j];
        page.drawText(word, {
          x: cursorX,
          y: currentY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        cursorX += font.widthOfTextAtSize(word, fontSize) + font.widthOfTextAtSize(" ", fontSize) + (j < words.length - 1 ? extraSpace : 0);
      }
      currentY -= fontSize + lineSpacing;
    }
    currentY -= lineSpacing;
  }
}

// ------------------------------------------------------
// Geração principal
// ------------------------------------------------------
async function generatePDF(data, clientData, engenieerData, analystData) {
  let countPages = 0;
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  let logoClienteImage = null;
  if (clientData?.logo) {
    try {
      const response = await axios.get(clientData.logo, { responseType: "arraybuffer" });
      const optimized = await sharp(response.data).resize(150).jpeg({ quality: 60 }).toBuffer();
      logoClienteImage = await pdfDoc.embedJpg(optimized);
    } catch (error) {
      console.error("Erro ao baixar logo do cliente:", error.message);
    }
  }

  const headerAssets = { logoEmpresaImage, logoClienteImage, helveticaFont, helveticaBoldFont };

  // ----------------- Página 1 (Capa) -----------------
  const page1 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  await addHeader(pdfDoc, page1, clientData, headerAssets);

  page1.drawText(`Relatório de Inspeção: Caldeira`, { x: 160, y: 700, size: 24, font: helveticaBoldFont });

  if (data?.images && data.images[0]) {
    try {
      const response = await axios.get(data.images[0], { responseType: "arraybuffer" });
      const embeddedImage = await pdfDoc.embedJpg(response.data);
      page1.drawImage(embeddedImage, { x: 172, y: 420, width: 250, height: 250 });
    } catch (e) {
      console.warn("Não foi possível carregar a imagem da capa:", e.message);
    }
  }

  page1.drawText(`Detalhes do Equipamento:`, { x: 50, y: 380, size: 16, font: helveticaBoldFont });
  page1.drawText(`Nome do equipamento:`, { x: 50, y: 350, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.nomeEquipamento ?? "Caldeira Flamotubular"}`, { x: 220, y: 350, size: 14, font: helveticaFont });
  page1.drawText(`Número de série:`, { x: 50, y: 320, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.numeroSerie ?? "N/C"}`, { x: 175, y: 320, size: 14, font: helveticaFont });
  page1.drawText(`Patrimônio/TAG:`, { x: 50, y: 290, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.numeroPatrimonio ?? data?.tag ?? ""}`, { x: 180, y: 290, size: 14, font: helveticaFont });
  page1.drawText(`Fabricante:`, { x: 50, y: 260, size: 14, font: helveticaBoldFont });
  page1.drawText(`${data?.fabricante ?? ""}`, { x: 140, y: 260, size: 14, font: helveticaFont });

  page1.drawText(`${clientData?.person ?? ""}`, { x: 50, y: 200, size: 12, font: helveticaBoldFont });
  page1.drawText(`${clientData?.address ?? ""} CEP: ${clientData?.cep ?? ""}`, { x: 50, y: 185, size: 12, font: helveticaFont });
  page1.drawText(`CNPJ: ${clientData?.cnpj ?? ""}`, { x: 50, y: 170, size: 12, font: helveticaFont });
  page1.drawText(`FONE: ${clientData?.phone ?? ""}`, { x: 50, y: 155, size: 12, font: helveticaFont });

  await addFooter(pdfDoc, page1, data);

  // ----------------- Página 2 (1. INFORMAÇÕES GERAIS) -----------------
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  await addHeader(pdfDoc, page2, clientData, headerAssets);

  page2.drawText("1. INFORMAÇÕES GERAIS", { x: 50, y: 700, size: 24, font: helveticaBoldFont });
  page2.drawText("1.1 DADOS CADASTRAIS", { x: 50, y: 664, size: 16, font: helveticaBoldFont });

  await drawTableRegistrationData(
    page2,
    pdfDoc,
    50,
    650,
    [247.64, 247.64],
    { client: clientData },
    helveticaFont,
    helveticaBoldFont
  );

  page2.drawText("1.2 RESPONSÁVEIS TÉCNICOS", { x: 50, y: 510, size: 16, font: helveticaBoldFont });
  await drawTableTechnicalManagers(
    page2,
    pdfDoc,
    50,
    495,
    [247.64, 247.64],
    analystData,
    engenieerData,
    helveticaFont,
    helveticaBoldFont
  );

  page2.drawText("1.3 CONTROLE DE REVISÃO", { x: 50, y: 415, size: 16, font: helveticaBoldFont });
  await drawTableRevisionControl(
    page2,
    pdfDoc,
    50,
    400,
    [70, 205.28, 140, 80],
    { ...data, analyst: analystData },
    helveticaFont,
    helveticaBoldFont
  );

  page2.drawText("1.4 INSPEÇÕES CONTRATADAS", { x: 50, y: 330, size: 16, font: helveticaBoldFont });
  await drawTableContractedInspections(
    page2,
    pdfDoc,
    50,
    315,
    [80, 205.28, 110, 110],
    data,
    helveticaFont,
    helveticaBoldFont
  );

  await addFooter(pdfDoc, page2, data);

  // ----------------- Página 3 (1.5 DADOS DO EQUIPAMENTO) -----------------
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  await addHeader(pdfDoc, page3, clientData, headerAssets);

  page3.drawText("1.5 DADOS DO EQUIPAMENTO", { x: 50, y: 720, size: 16, font: helveticaBoldFont });

  const imagensGerais = await baixarEComprimirTodasImagens(data.images || []);
  await drawImageGrid({
    page: page3,
    pdfDoc,
    startX: 50,
    startY: 718,
    columnWidth: 161.5,
    images: imagensGerais,
    helveticaFont,
    helveticaBoldFont,
  });

  const geralRows = [
    ["TIPO", `${data.tipoEquipamento || "Caldeira"}`],
    ["TIPO DA CALDEIRA", `${data.tipoCaldeira || data.tipoCategoria || ""}`],
    ["NÚMERO DE SÉRIE", `${data.numeroSerie || ""}`],
    ["ANO DE FABRICAÇÃO", `${data.anoFabricacao || ""}`],
    ["PRESSÃO MÁXIMA DE TRABALHO ADMISSÍVEL (PMTA)", `${data.pressaoMaxima || ""} ${data.unidadePressaoMaxima || ""}`],
    ["PRESSÃO DE TESTE HIDROSTÁTICO DE FABRICAÇÃO (PTHF)", `${data.pressaoTeste || ""} ${data.unidadePressaoMaxima || ""}`],
    ["CAPACIDADE DE PRODUÇÃO DE VAPOR (CPV)", `${data.capacidadeProducaoVapor || data.cpv || ""}`],
    ["ÁREA DA SUPERFÍCIE DE AQUECIMENTO (ASA)", `${data.areaSuperficieAquecimento || ""}`],
    ["CÓDIGO DO PROJETO / ANO DE EDIÇÃO", `${data.codProjeto || ""} / ${data.anoEdicao || ""}`],
    ["LOCAL DE INSTALAÇÃO", `${data.localInstalacao || ""}`],
  ];
  await drawTableGeralDatas({
    page: page3,
    startX: 50,
    startY: 300,
    columnWidths: [350, 145.28],
    rows: geralRows,
    helveticaFont,
    helveticaBoldFont,
  });

  await addFooter(pdfDoc, page3, data);

  // ----------------- Página 4 (1.6/1.7/1.8) -----------------
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  await addHeader(pdfDoc, page4, clientData, headerAssets);

  page4.drawText("1.6 CATEGORIZAÇÃO", { x: 50, y: 710, size: 16, font: helveticaBoldFont });
  const categRows = [
    ["TEMPERATURA DE PROJETO", `${data.temperaturaProjeto || ""} °C`],
    ["TEMPERATURA DE TRABALHO", `${data.temperaturaTrabalho || ""} °C`],
    ["VOLUME", `${data.volume || ""}`],
    ["CATEGORIA", `${data.categoriaCaldeira || data.categoriaVasoPressao || ""}`],
  ];
  await drawTableCategorization(page4, 50, 690, [350, 145.28], categRows, helveticaFont, helveticaBoldFont);

  // Dados de Operação
  page4.drawText("1.7 DADOS DE OPERAÇÃO", { x: 50, y: 590, size: 16, font: helveticaBoldFont });
  const opRows = [
    ["COMBUSTÍVEL PRINCIPAL", `${data.combustivelPrincipal || ""}`],
    ["COMBUSTÍVEL AUXILIAR", `${data.combustivelAuxiliar || ""}`],
    ["REGIME DE TRABALHO", `${data.regimeTrabalho || ""}`],
    ["TIPO DE OPERAÇÃO", `${data.tipoOperacao || ""}`],
  ];
  await drawTableCategorization(page4, 50, 570, [350, 145.28], opRows, helveticaFont, helveticaBoldFont);

  // Pessoas que acompanharam
  page4.drawText("1.8 PESSOAS QUE ACOMPANHARAM", { x: 50, y: 470, size: 16, font: helveticaBoldFont });
  const pessoa = (data?.pessoasAcompanhamento && data.pessoasAcompanhamento[0]) || data?.pessoaAcompanhou || "";
  await drawTableCategorization(page4, 50, 450, [350, 145.28], [["", pessoa]], helveticaFont, helveticaBoldFont);

  // Documentação existente (título para começar na próxima página)
  page4.drawText("1.9 DOCUMENTAÇÃO EXISTENTE", { x: 50, y: 410, size: 16, font: helveticaBoldFont });
  await addFooter(pdfDoc, page4, data);

  // ----------------- Página 5+ (1.9 DOCUMENTAÇÃO EXISTENTE paginada) -----------------
  const page5 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  await addHeader(pdfDoc, page5, clientData, headerAssets);

  const headers = ["ITEM", "DESCRIÇÃO", "SITUAÇÃO"];
  const docs = (data?.documentacaoExistente || data?.documentation || []);
  // Se não vier do banco, usa tabela padrão (como no exemplo)
  const tableData = docs.length ? docs.map((d, idx) => [String(d.item ?? idx+1), d.descricao ?? "", d.situacao ?? ""]) : [
    ["1", "Memória de Cálculo do Teste Hidrostático", "Completa"],
    ["2", "Funcionamento das Válvulas de Drenagem", "Completa"],
    ["3", "Mapa de Medição de Espessura por Ultra-som", "Completa"],
    ["4", "Planejamento e Execução de Ações Corretivas", "Completa"],
    ["5", "Inspeção de Alteração e Reparo", "N/A"],
    ["6", "Recomendações de Inspeções Anteriores Não Realizadas", "Completa"],
    ["7", "Inspeção de Alteração Operacional", "N/A"],
    ["8", "Condição dos Ventiladores e Sistema de Exaustão", "Completa"],
    ["9", "Inspeção de Vazamentos nas Tubulações", "Completa"],
    ["10", "Funcionamento das Válvulas de Alimentação", "Completa"],
    ["11", "Elaboração do Relatório de Inspeção Detalhado", "Completa"],
    ["12", "Funcionamento dos Dispositivos de Controle e Segurança", "Completa"],
    ["13", "Programação de Inspeções com Datas Limites", "Completa"],
    ["14", "Verificação de Corrosão ou Desgaste Interno", "Completa"],
    ["15", "Inspeção de Início de Operação", "Completa"],
    ["16", "Inspeção das Bombas e Filtros de Alimentação", "Completa"],
    ["17", "Projeto de Instalação Geral e do Equipamento", "Completa"],
    ["18", "Inspeção de Problema Operacional", "N/A"],
    ["19", "Plaqueta de Identificação do Fabricante do Equipamento", "Completa"],
    ["20", "Integridade dos Suportes e Estruturas", "Completa"],
    ["21", "Registro de Treinamento dos Operadores", "Completa"],
    ["22", "Testes de Alarmes de Pressão e Temperatura: Conformidade e Eficiência", "Completa"],
    ["23", "Operador Qualificado para Operações (Categoria I e II)", "Completa"],
    ["24", "Plano de Solda (Fabricação)", "Completa"],
    ["25", "Registro de Segurança", "Completa"],
    ["26", "Certificado de Calibração das Válvulas de Segurança", "Completa"],
    ["27", "Relatório de Inspeção Anterior", "Completa"],
    ["28", "Inspeção Periódica (Interna, Externa, TH)", "Completa"],
    ["29", "Plaqueta de Identificação NR-13 do Equipamento", "Completa"],
    ["30", "Condição das Juntas e Vedantes", "Completa"],
    ["31", "Funcionamento dos Equipamentos de Proteção (extintores, alarmes)", "Completa"],
    ["32", "Memória de Cálculo das PMTA das Partes e do Equipamento", "Completa"],
    ["33", "Inspeção e Teste da Válvula de Segurança", "Completa"],
    ["34", "Ajustes e Calibração dos Sistemas", "Completa"],
    ["35", "Eficiência dos Trocas de Calor e Condição dos Tubos", "Completa"],
    ["36", "Inspeção de Reconstituição de Prontuário", "N/A"],
    ["37", "Funcionamento do Queimador e Sistema de Combustão", "Completa"],
    ["38", "Calibração dos Manômetros e Outros Instrumentos de Medição", "Completa"],
    ["39", "Desenho da Plaqueta de Identificação", "Completa"],
    ["40", "Inspeção de Parada ou Retorno de Operação", "N/A"],
    ["41", "Desenho do Conjunto Geral e de Detalhes", "Completa"],
    ["42", "Laudo de Teste Hidrostático", "Completa"],
  ];

  await drawPaginatedTable({
    pdfDoc,
    page: page5,
    startX: 50,
    startY: 700,
    columnWidths: [50, 345, 100],
    rowHeight: 20,
    headers,
    tableData,
    helveticaFont,
    helveticaBoldFont,
    clientData,
    data,
    headerAssets,
  });

  // ----------------- Próximo bloco: 2 / 3 / 4 -----------------
  const pageDef = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  await addHeader(pdfDoc, pageDef, clientData, headerAssets);

  pageDef.drawText("2. DEFINIÇÃO", { x: 50, y: 700, size: 24, font: helveticaBoldFont });
  await drawIndentedJustifiedText(
    pageDef,
    "Esta Norma Regulamentadora (NR-13) estabelece requisitos mínimos para gestão da integridade estrutural de caldeiras a vapor, vasos de pressão, suas tubulações de interligação e tanques metálicos de armazenamento nos aspectos relacionados à instalação, inspeção, operação e manutenção, visando à segurança e à saúde dos trabalhadores.",
    50, 664, 495.28, helveticaFont, 12, 3, 20
  );

  pageDef.drawText("3. OBJETIVO", { x: 50, y: 577, size: 24, font: helveticaBoldFont });
  await drawIndentedJustifiedText(
    pageDef,
    "Este relatório tem como objetivo registrar os resultados de uma inspeção em Caldeira sob a óticada NR-13 aprovada pela portaria n° 3.214, de 8 de junho de 1978, e Legislação Complementar pela Portaria SEPRT n° 1.846 de 1º de julho de 2022, - NR13 CALDEIRAS, VASOS DE PRESSÃO, TUBULAÇÕES E TANQUES METÁLICOS.",
    50, 544, 480, helveticaFont, 12, 3, 20
  );

  pageDef.drawText("4. NORMAS", { x: 50, y: 460, size: 24, font: helveticaBoldFont });
  pageDef.drawText("REFERÊNCIAS NORMATIVAS", { x: 50, y: 420, size: 24, font: helveticaBoldFont });

  // Tabela de Normas
  const columnWidthsReferencesNorms = [115.28, 380];
  const refs = [
    ["NORMA", "DESCRIÇÃO"],
    ["NR-13", "Caldeiras, vasos de pressão, tubulações e tanques metálicos de armazenamento"],
    ["NBR 15417:2007", "Vasos de pressão - Inspeção de segurança em serviço"],
    ["ASME I:2015", "ASME Boiler and Pressure Vessel Code An International Code - Rules for Construction of Power Boilers"],
    ["ASME II:2015", "ASME Boiler and Pressure Vessel Code An International Code - Part D Properties (Customary)"],
    ["ASME VIII:2015", "ASME Boiler and Pressure Vessel Code An International Code - Division 1"],
    ["NBR ISO 12100:2013", "Segurança de máquinas - Princípios gerais de projeto - Apreciação e redução de riscos"],
    ["EN ISO 12100:2010", "Safety of machinery - General principles for design - Risk assessment and risk reduction"],
    ["ABNT NBR ISO 16528-1:2021", "Caldeiras e vasos de pressão - Parte 1: Requisitos de desempenho"],
  ];

  // desenha mini tabela simples
  let curY = 400;
  const rowH = 20;
  for (let i = 0; i < refs.length; i++) {
    const row = refs[i];
    let curX = 50;
    for (let j = 0; j < row.length; j++) {
      const cell = row[j];
      pageDef.drawRectangle({
        x: curX,
        y: curY,
        width: columnWidthsReferencesNorms[j],
        height: rowH,
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      pageDef.drawText(cell, {
        x: curX + 5,
        y: curY + 6,
        size: 10,
        font: helveticaFont,
      });
      curX += columnWidthsReferencesNorms[j];
    }
    curY -= rowH;
  }

  await addFooter(pdfDoc, pageDef, data);

  // ----------------- Finalização -----------------
  // Garantir numeração em todas as páginas
  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const p = pdfDoc.getPage(i);
    await addFooter(pdfDoc, p, data, i + 1);
  }

  return await pdfDoc.save();
}

// ------------------------------------------------------
// Handler de Exportação (para Vercel / API)
// ------------------------------------------------------
async function generateBoilerPdf(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro 'projectId' é obrigatório.");
  }
  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);
    const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF da Caldeira:", error);
    throw new Error(`Erro ao gerar o PDF da Caldeira: ${error.message}`);
  }
}

module.exports = generateBoilerPdf;
