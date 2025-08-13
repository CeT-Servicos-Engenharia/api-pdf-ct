const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// ==========================================================================================
// #region Funções de Utilitário (Helpers)
// ==========================================================================================

async function downloadImageFromFirebase(url) {
  try {
    if (!url) return null;

    if (/^https?:\/\//i.test(url)) {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(response.data);
    }

    const storage = admin.storage();
    let bucket = storage.bucket();
    let filePath = url;

    const gsMatch = typeof url === "string" ? url.match(/^gs:\/\/([^\/]+)\/(.+)$/i) : null;
    if (gsMatch) {
      const [, bucketName, path] = gsMatch;
      bucket = storage.bucket(bucketName);
      filePath = path;
    } else {
      if (filePath && filePath.startsWith("/")) filePath = filePath.slice(1);
    }

    const [buffer] = await bucket.file(filePath).download();
    return buffer;
  } catch (err) {
    console.error(`Erro ao baixar imagem de ${url}:`, err.message);
    return null;
  }
}

async function compressImage(imageBuffer, options = { width: 800, quality: 70 }) {
    if (!imageBuffer) return null;
    try {
        return await sharp(imageBuffer)
            .rotate() // Corrige orientação automaticamente
            .resize({ width: options.width, withoutEnlargement: true })
            .jpeg({ quality: options.quality, progressive: true })
            .toBuffer();
    } catch (error) {
        console.error("Falha ao comprimir imagem:", error.message);
        return imageBuffer; // Retorna o buffer original em caso de falha
    }
}


async function embedImage(pdfDoc, imageBuffer) {
    if (!imageBuffer) return null;
    try {
        // Tenta detectar o tipo de imagem pelos "magic numbers"
        const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
        const isJpeg = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8;

        if (isPng) return await pdfDoc.embedPng(imageBuffer);
        if (isJpeg) return await pdfDoc.embedJpg(imageBuffer);
        
        // Se não for PNG ou JPG, tenta comprimir para JPG como fallback
        const jpegBuffer = await compressImage(imageBuffer);
        return await pdfDoc.embedJpg(jpegBuffer);

    } catch (error) {
        console.error("Erro ao embutir imagem no PDF:", error.message);
        return null;
    }
}


function formatDate(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Data inválida";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
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
  return clientDoc.exists ? clientDoc.data() : null;
}

async function getEngineerData(engineerId) {
  if (!engineerId) return null;
  const engineerDocRef = admin.firestore().doc(`engineer/${engineerId}`);
  const engineerDoc = await engineerDocRef.get();
  return engineerDoc.exists ? engineerDoc.data() : null;
}

async function getAnalystData(analystId) {
  if (!analystId) return null;
  const analystDocRef = admin.firestore().doc(`analyst/${analystId}`);
  const analystDoc = await analystDocRef.get();
  return analystDoc.exists ? analystDoc.data() : null;
}

// #endregion

// ==========================================================================================
// #region Classe de Contexto do PDF
// ==========================================================================================

class PDFContext {
    constructor(pdfDoc, initialData, assets) {
        this.pdfDoc = pdfDoc;
        this.data = initialData.projectData;
        this.clientData = initialData.clientData;
        this.engineerData = initialData.engineerData;
        this.analystData = initialData.analystData;
        this.assets = assets;
        
        this.PAGE_WIDTH = 595.28;
        this.PAGE_HEIGHT = 841.89;
        this.MARGIN_TOP = 120;
        this.MARGIN_BOTTOM = 70;
        this.MARGIN_LEFT = 50;
        this.MARGIN_RIGHT = 50;
        
        this.currentPage = null;
        this.pageNumber = 0;
        this.cursorY = 0;
    }

    async addNewPage(options = {}) {
        const { keepY = false } = options;
        const oldY = this.cursorY;

        this.currentPage = this.pdfDoc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
        this.pageNumber++;
        
        await this.addHeader();
        await this.addFooter();
        
        this.cursorY = this.PAGE_HEIGHT - this.MARGIN_TOP;
        
        if (keepY) {
            this.cursorY = oldY;
        }
        return this.cursorY;
    }

    async addHeader() {
        const { logoEmpresaImage, logoClienteImage, helveticaFont, helveticaBoldFont } = this.assets;
        const page = this.currentPage;
        
        if (logoEmpresaImage) page.drawImage(logoEmpresaImage, { x: 60, y: 740, width: 80, height: 80 });
        if (logoClienteImage) page.drawImage(logoClienteImage, { x: 448, y: 740, width: 80, height: 80 });

        const center = this.PAGE_WIDTH / 2;
        page.drawText("C&T Serviço Engenharia", { x: center - helveticaBoldFont.widthOfTextAtSize("C&T Serviço Engenharia", 10) / 2, y: 790, size: 10, font: helveticaBoldFont });
        page.drawText("Avenida Sábia Q:30 L:27, CEP 75904-370", { x: center - helveticaFont.widthOfTextAtSize("Avenida Sábia Q:30 L:27, CEP 75904-370", 10) / 2, y: 780, size: 10, font: helveticaFont });
        page.drawText("(64) 99244-2480, cleonis@engenhariact.com.br", { x: center - helveticaFont.widthOfTextAtSize("(64) 99244-2480, cleonis@engenhariact.com.br", 10) / 2, y: 770, size: 10, font: helveticaFont });
    }

    async addFooter() {
        const { helveticaFont } = this.assets;
        const page = this.currentPage;
        const formattedDate = formatDate(this.data.inspection.endDate);

        const footerTextStart = `${this.data.numeroProjeto || " "}\nART:${this.data.artProjeto || "N/A"}`;
        const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
        const footerTextEnd = `C&T.0.1 | ${formattedDate}\nPágina ${this.pageNumber}`;

        const drawMultilineText = (text, x, y) => {
            text.split("\n").forEach((line, index) => {
                page.drawText(line, { x, y: y - index * 12, size: 10, font: helveticaFont, color: rgb(0.5, 0.5, 0.5) });
            });
        };

        drawMultilineText(footerTextStart, 50, 50);
        drawMultilineText(footerTextMiddle, 200, 50);
        drawMultilineText(footerTextEnd, 450, 50);
    }

    async checkSpace(requiredHeight) {
        if (this.cursorY - requiredHeight < this.MARGIN_BOTTOM) {
            await this.addNewPage();
        }
    }
}

// #endregion

// ==========================================================================================
// #region Funções de Desenho no PDF
// ==========================================================================================

async function drawJustifiedText(ctx, text, options) {
    const {
        x = ctx.MARGIN_LEFT,
        font = ctx.assets.helveticaFont,
        fontSize = 12,
        lineSpacing = 4,
        indentSize = 20,
        color = rgb(0, 0, 0)
    } = options;
    
    const maxWidth = ctx.PAGE_WIDTH - ctx.MARGIN_LEFT - ctx.MARGIN_RIGHT;

    const paragraphs = text.split("\n").filter(p => p.trim() !== "");

    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/);
        let lines = [];
        let currentLine = [];
        let isFirstLineOfParagraph = true;

        for (const word of words) {
            const testLine = [...currentLine, word].join(" ");
            const effectiveMaxWidth = isFirstLineOfParagraph ? maxWidth - indentSize : maxWidth;
            if (font.widthOfTextAtSize(testLine, fontSize) > effectiveMaxWidth && currentLine.length > 0) {
                lines.push({ words: currentLine, isFirst: isFirstLineOfParagraph });
                currentLine = [word];
                isFirstLineOfParagraph = false;
            } else {
                currentLine.push(word);
            }
        }
        lines.push({ words: currentLine, isFirst: isFirstLineOfParagraph });

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const requiredHeight = fontSize + lineSpacing;
            await ctx.checkSpace(requiredHeight);

            const startX = line.isFirst ? x + indentSize : x;
            const isLastLine = i === lines.length - 1;

            if (!isLastLine && line.words.length > 1) { // Justificar
                const wordsWidth = line.words.reduce((sum, w) => sum + font.widthOfTextAtSize(w, fontSize), 0);
                const effectiveWidth = line.isFirst ? maxWidth - indentSize : maxWidth;
                const spaceWidth = (effectiveWidth - wordsWidth) / (line.words.length - 1);
                
                let currentX = startX;
                line.words.forEach((word, index) => {
                    ctx.currentPage.drawText(word, { x: currentX, y: ctx.cursorY, font, fontSize, color });
                    currentX += font.widthOfTextAtSize(word, fontSize) + spaceWidth;
                });
            } else { // Alinhar à esquerda
                ctx.currentPage.drawText(line.words.join(" "), { x: startX, y: ctx.cursorY, font, fontSize, color });
            }
            ctx.cursorY -= requiredHeight;
        }
        ctx.cursorY -= lineSpacing; // Espaço entre parágrafos
    }
}

async function drawSectionTitle(ctx, title, options = {}) {
    const { size = 24, font = ctx.assets.helveticaBoldFont, spacingAfter = 20 } = options;
    await ctx.checkSpace(size + spacingAfter);
    ctx.currentPage.drawText(title, { x: ctx.MARGIN_LEFT, y: ctx.cursorY, font, size });
    ctx.cursorY -= (size + spacingAfter);
}

async function drawSubSectionTitle(ctx, title, options = {}) {
    const { size = 16, font = ctx.assets.helveticaBoldFont, spacingAfter = 15 } = options;
    await ctx.checkSpace(size + spacingAfter);
    ctx.currentPage.drawText(title, { x: ctx.MARGIN_LEFT, y: ctx.cursorY, font, size });
    ctx.cursorY -= (size + spacingAfter);
}

async function drawTable(ctx, startX, columnWidths, data, headerFont, bodyFont, headerColor, borderColor) {
    // Draw header
    const header = data[0];
    const headerHeight = 20;
    await ctx.checkSpace(headerHeight);
    
    header.forEach((cell, columnIndex) => {
        const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
        ctx.currentPage.drawRectangle({
            x,
            y: ctx.cursorY - headerHeight,
            width: columnWidths[columnIndex],
            height: headerHeight,
            color: headerColor,
            borderColor: borderColor,
            borderWidth: 1,
        });
        ctx.currentPage.drawText(cell, {
            x: x + 10,
            y: ctx.cursorY - headerHeight / 2 - headerFont.heightAtSize(10) / 2, // Corrigido aqui
            size: 10,
            font: headerFont,
            color: rgb(1, 1, 1),
        });
    });
    ctx.cursorY -= headerHeight;

    // Draw rows
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowMinHeight = 90; // Ajuste conforme necessário para o conteúdo
        await ctx.checkSpace(rowMinHeight);

        row.forEach((cell, columnIndex) => {
            const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
            ctx.currentPage.drawRectangle({
                x,
                y: ctx.cursorY - rowMinHeight,
                width: columnWidths[columnIndex],
                height: rowMinHeight,
                borderColor: borderColor,
                borderWidth: 1,
            });

            const wrappedText = wrapText(cell, columnWidths[columnIndex] - 20, bodyFont, 10); // 20 para padding
            wrappedText.forEach((line, lineIndex) => {
                ctx.currentPage.drawText(line, {
                    x: x + 10,
                    y: ctx.cursorY - 10 - (lineIndex * 12), // 10 para padding superior, 12 para line height
                    size: 10,
                    font: bodyFont,
                    color: rgb(0, 0, 0),
                });
            });
        });
        ctx.cursorY -= rowMinHeight;
    }
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

// #endregion

// ==========================================================================================
// #region Função Principal de Geração
// ==========================================================================================

async function generatePDF(projectData, clientData, engineerData, analystData) {
    const pdfDoc = await PDFDocument.create();
    
    // Carregar e preparar todos os recursos (assets)
    const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
    const logoBytes = fs.readFileSync(logoPath);
    const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
    
    let logoClienteImage = null;
    if (clientData && clientData.logo) {
        const logoBuffer = await downloadImageFromFirebase(clientData.logo);
        if (logoBuffer) {
            const compressedLogo = await compressImage(logoBuffer, { width: 150, quality: 80 });
            logoClienteImage = await embedImage(pdfDoc, compressedLogo);
        }
    }

    const assets = {
        logoEmpresaImage,
        logoClienteImage,
        helveticaFont: await pdfDoc.embedFont(StandardFonts.Helvetica),
        helveticaBoldFont: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    };

    const ctx = new PDFContext(pdfDoc, { projectData, clientData, engineerData, analystData }, assets);

    // ===================================================
    // INÍCIO DA CONSTRUÇÃO DAS PÁGINAS
    // ===================================================

    // Página de Rosto (Capa)
    await ctx.addNewPage();
    ctx.currentPage.drawText(`Relatório de Inspeção: ${projectData.tipoEquipamento || "N/A"}`, {
        x: 115,
        y: 700,
        size: 24,
        font: assets.helveticaBoldFont,
        color: rgb(0, 0, 0),
    });

    if (projectData.images && Array.isArray(projectData.images) && projectData.images.length > 0) {
        const imageUrl = projectData.images[0];
        if (imageUrl) {
            const imageBuffer = await downloadImageFromFirebase(imageUrl);
            if (imageBuffer) {
                const compressedImage = await compressImage(imageBuffer, { width: 400, quality: 70 });
                const embeddedImage = await embedImage(pdfDoc, compressedImage);
                if (embeddedImage) {
                    ctx.currentPage.drawImage(embeddedImage, {
                        x: 172,
                        y: 420,
                        width: 250,
                        height: 250,
                    });
                }
            }
        }
    } else {
        console.warn("Nenhuma imagem de inspeção disponível.");
    }

    ctx.cursorY = 380; // Posição inicial para os detalhes do equipamento
    ctx.currentPage.drawText(`Detalhes do Equipamento:`, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 16,
        font: assets.helveticaBoldFont,
    });
    ctx.cursorY -= 30;

    ctx.currentPage.drawText(`Nome do equipamento: `, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaBoldFont,
    });
    ctx.currentPage.drawText(`${projectData.nomeEquipamento || " "}`, {
        x: 208,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 30;

    ctx.currentPage.drawText(`Número de série:`, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaBoldFont,
    });
    ctx.currentPage.drawText(`${projectData.numeroSerie || " "}`, {
        x: 165,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 30;

    ctx.currentPage.drawText(`Patrimônio/TAG: `, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaBoldFont,
    });
    ctx.currentPage.drawText(`${projectData.numeroPatrimonio || " "}  ${projectData.tag || " "}`, {
        x: 162,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 30;

    ctx.currentPage.drawText(`Fabricante: `, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaBoldFont,
    });
    ctx.currentPage.drawText(`${projectData.fabricante || " "}`, {
        x: 128,
        y: ctx.cursorY,
        size: 14,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 30;

    ctx.currentPage.drawText(`${clientData?.person || " "}`, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 12,
        font: assets.helveticaBoldFont,
    });
    ctx.cursorY -= 15;

    ctx.currentPage.drawText(`${clientData?.address || " "} CEP: ${clientData?.cep || " "}`, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 12,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 15;

    ctx.currentPage.drawText(`CNPJ: ${clientData?.cnpj || " "}`, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 12,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 15;

    ctx.currentPage.drawText(`FONE: ${clientData?.phone || " "}`, {
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY,
        size: 12,
        font: assets.helveticaFont,
    });
    ctx.cursorY -= 15;

    // Página 2: Informações Gerais
    await ctx.addNewPage();
    await drawSectionTitle(ctx, "1. INFORMAÇÕES GERAIS");
    await drawSubSectionTitle(ctx, "1.1 DADOS CADASTRAIS");

    const tableDataRegistrationData = [
        ["CLIENTE", "ELABORAÇÃO"],
        [
            `  ${clientData?.person || " "} \n\n        ${clientData?.address || " "}, ${clientData?.neighborhood || " "}, ${clientData?.number || " "} \n\n        CEP: ${clientData?.cep || " "} \n\n        CNPJ: ${clientData?.cnpj || " "} \n\n        TEL.: ${clientData?.phone || " "} \n\n        E-mail: ${clientData?.email || " "}`,
            ` ${engineerData?.name || " "} \n\n        ${engineerData?.address || " "}, ${engineerData?.neighborhood || " "}, ${engineerData?.number || " "} \n\n        CEP: ${engineerData?.cep || " "} \n\n        CNPJ: ${engineerData?.cnpj || " "} \n\n        CREA: ${engineerData?.crea || " "} \n\n        TEL.: ${engineerData?.phone || " "} \n\n        E-mail: ${engineerData?.email || " "}`,
        ],
    ];

    await drawTable(
        ctx,
        ctx.MARGIN_LEFT,
        [247.64, 247.64],
        tableDataRegistrationData,
        assets.helveticaBoldFont,
        assets.helveticaFont,
        rgb(0.102, 0.204, 0.396),
        rgb(0.102, 0.204, 0.396)
    );
    ctx.cursorY -= 20; // Espaço após a tabela

    // Página de Conclusão
    await ctx.addNewPage();
    await drawSectionTitle(ctx, "8. CONCLUSÃO");

    const conclusionText = projectData.inspection.conclusion || "Sem conclusão referente a esta inspeção.";
    await drawJustifiedText(ctx, conclusionText, { font: assets.helveticaFont, fontSize: 12 });
    ctx.cursorY -= 10;

    const certificationText = "A presente inspeção não certifica projeto, materiais e mão-de-obra, utilizados durante a fabricação e instalação do equipamento, sendo de total responsabilidade do fabricante.";
    await drawJustifiedText(ctx, certificationText, { font: assets.helveticaFont, fontSize: 12 });
    ctx.cursorY -= 20;

    // Bloco de Aprovado/Reprovado
    const resultInspection = projectData.inspection.selectedResultInspection?.approved;
    const resultText = resultInspection
        ? `${projectData.tipoEquipamento || "Equipamento"} está APROVADO para operação`
        : `${projectData.tipoEquipamento || "Equipamento"} está REPROVADO para operação`;
    const resultColor = resultInspection ? rgb(0, 0.43, 0) : rgb(0.8, 0, 0);
    
    await ctx.checkSpace(60); // Verifica espaço para o retângulo e texto
    ctx.currentPage.drawRectangle({
        x: ctx.MARGIN_LEFT,
        y: ctx.cursorY - 40,
        width: ctx.PAGE_WIDTH - ctx.MARGIN_LEFT - ctx.MARGIN_RIGHT,
        height: 40,
        color: resultColor,
    });
    ctx.currentPage.drawText(resultText, {
        x: ctx.PAGE_WIDTH / 2 - assets.helveticaBoldFont.widthOfTextAtSize(resultText, 14) / 2,
        y: ctx.cursorY - 25,
        font: assets.helveticaBoldFont,
        size: 14,
        color: rgb(1, 1, 1),
    });
    ctx.cursorY -= 60; // Move o cursor para baixo após o bloco

    // Tabela de Próxima Inspeção
    const tableDataNextInspection = [
        ["PRÓXIMA INSPEÇÃO", "PRAZO NORMA", "PRAZO PLH"],
        [
            formatDate(projectData.inspection.nextInspectionDate),
            formatDate(projectData.inspection.normativeDeadline),
            projectData.inspection.plhDeadline || "N/A",
        ],
    ];

    await drawTable(
        ctx,
        ctx.MARGIN_LEFT,
        [165, 165, 165],
        tableDataNextInspection,
        assets.helveticaBoldFont,
        assets.helveticaFont,
        rgb(0.102, 0.204, 0.396),
        rgb(0.102, 0.204, 0.396)
    );
    ctx.cursorY -= 20; // Espaço após a tabela

    // Assinatura
    await ctx.checkSpace(120); // Verifica espaço para a assinatura e informações
    if (engineerData && engineerData.signature) {
        const signatureBuffer = await downloadImageFromFirebase(engineerData.signature);
        if (signatureBuffer) {
            const signatureImage = await embedImage(pdfDoc, signatureBuffer);
            if (signatureImage) {
                const aspectRatio = signatureImage.height / signatureImage.width;
                const sigWidth = 150;
                const sigHeight = sigWidth * aspectRatio;
                ctx.currentPage.drawImage(signatureImage, {
                    x: ctx.PAGE_WIDTH / 2 - sigWidth / 2,
                    y: ctx.cursorY - sigHeight,
                    width: sigWidth,
                    height: sigHeight,
                });
                ctx.cursorY -= (sigHeight + 5);
            }
        }
    }
    
    const lineY = ctx.cursorY;
    ctx.currentPage.drawLine({
        start: { x: 150, y: lineY },
        end: { x: ctx.PAGE_WIDTH - 150, y: lineY },
        thickness: 1,
    });
    ctx.cursorY -= 15;

    const engineerName = engineerData?.name || "N/A";
    const engineerCrea = engineerData?.crea || "N/A";

    const text1 = `Resp. Téc ${engineerName}`;
    ctx.currentPage.drawText(text1, { x: ctx.PAGE_WIDTH / 2 - assets.helveticaFont.widthOfTextAtSize(text1, 12) / 2, y: ctx.cursorY, size: 12, font: assets.helveticaFont });
    ctx.cursorY -= 15;
    
    const text2 = `CREA ${engineerCrea}`;
    ctx.currentPage.drawText(text2, { x: ctx.PAGE_WIDTH / 2 - assets.helveticaFont.widthOfTextAtSize(text2, 12) / 2, y: ctx.cursorY, size: 12, font: assets.helveticaFont });
    ctx.cursorY -= 15;

    const text3 = "Engenheiro Mecânico";
    ctx.currentPage.drawText(text3, { x: ctx.PAGE_WIDTH / 2 - assets.helveticaFont.widthOfTextAtSize(text3, 12) / 2, y: ctx.cursorY, size: 12, font: assets.helveticaFont });
    ctx.cursorY -= 15;

    // Seção de Recomendações Complementares (Página 25 do PDF original)
    await ctx.addNewPage();
    await drawSectionTitle(ctx, "6. RECOMENDAÇÕES COMPLEMENTARES");
    
    const complementaryRecommendations = projectData.inspection.complementaryRecommendations || "Nenhuma recomendação complementar.";
    await drawJustifiedText(ctx, complementaryRecommendations, { font: assets.helveticaFont, fontSize: 12 });
    ctx.cursorY -= 20;

    // Seção de Limitações do Relatório (Página 27 do PDF original)
    await ctx.addNewPage();
    await drawSectionTitle(ctx, "7. LIMITAÇÕES DO RELATÓRIO");

    const reportLimitations = projectData.inspection.reportLimitations || "Nenhuma limitação de relatório.";
    await drawJustifiedText(ctx, reportLimitations, { font: assets.helveticaFont, fontSize: 12 });
    ctx.cursorY -= 20;

    // ===================================================
    // FIM DA CONSTRUÇÃO DAS PÁGINAS
    // ===================================================

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

// #endregion

// ==========================================================================================
// #region Handler Principal (Exportação)
// ==========================================================================================

async function generateBoilerPdf(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro \'projectId\' é obrigatório.");
  }

  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(projectData.client || projectData.clientId);
    const engineerData = await getEngineerData(projectData.engineer?.id || projectData.engineerId);
    const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);

    const pdfBytes = await generatePDF(projectData, clientData, engineerData, analystData);

    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro fatal ao gerar o PDF:", error);
    const errorPdfDoc = await PDFDocument.create();
    const page = errorPdfDoc.addPage();
    page.drawText("Ocorreu um erro ao gerar o relatório.", { x: 50, y: 750, size: 24 });
    page.drawText(error.message, { x: 50, y: 700, size: 12 });
    const errorPdfBytes = await errorPdfDoc.save();
    return Buffer.from(errorPdfBytes);
  }
}

module.exports = generateBoilerPdf;

// #endregion


