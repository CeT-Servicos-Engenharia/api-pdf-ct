const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// ===================== Helpers: Firebase image download & compression =====================
async function downloadImageFromFirebase(url) {
  try {
    if (!url) return null;

    // If it's a public HTTP(S) URL (including Firebase Storage download URLs), fetch via axios
    if (/^https?:\/\//i.test(url)) {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(response.data);
    }

    // Otherwise, try Firebase Storage via Admin SDK (gs://bucket/path or raw storage path)
    const storage = admin.storage();
    let bucket = storage.bucket(); // default bucket from admin init
    let filePath = url;

    // gs://bucket/path
    const gsMatch = typeof url === "string" ? url.match(/^gs:\/\/([^\/]+)\/(.+)$/i) : null;
    if (gsMatch) {
      const [, bucketName, path] = gsMatch;
      bucket = storage.bucket(bucketName);
      filePath = path;
    } else {
      // normalize leading slash
      if (filePath && filePath.startsWith("/")) filePath = filePath.slice(1);
    }

    const [buffer] = await bucket.file(filePath).download();
    return buffer;
  } catch (err) {
    console.error("downloadImageFromFirebase failed:", err.message);
    return null;
  }
}

// Baixa uma lista de imagens (urls) e retorna JPEGs comprimidos prontos para embedJpg
async function baixarEComprimirTodasImagens(urls) {
  try {
    if (!Array.isArray(urls)) return [];

    const normalized = urls
      .map((u) => (typeof u === "string" ? u : (u && (u.url || u.path || u.src)) || null))
      .filter(Boolean);

    const results = [];
    for (const url of normalized) {
      try {
        const bytes = await downloadImageFromFirebase(url);
        if (!bytes) {
          console.warn("Imagem não baixada (vazia):", url);
          continue;
        }
        // Padroniza para JPEG (as grids usam embedJpg)
        let pipeline = sharp(bytes).rotate().resize({ width: 1000, withoutEnlargement: true });
        const jpegBuffer = await pipeline.jpeg({ quality: 60 }).toBuffer();
        results.push({ buffer: jpegBuffer, url });
      } catch (e) {
        console.warn("Falha ao otimizar imagem:", url, e.message);
      }
    }
    return results;
  } catch (err) {
    console.error("baixarEComprimirTodasImagens falhou:", err.message);
    return [];
  }
}

// ==========================================================================================
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
    const isPng =
      imageBytesArray[0] === 0x89 &&
      imageBytesArray[1] === 0x50 &&
      imageBytesArray[2] === 0x4e &&
      imageBytesArray[3] === 0x47;
    const isJpeg =
      imageBytesArray[0] === 0xff &&
      imageBytesArray[1] === 0xd8 &&
      imageBytesArray[2] === 0xff;

    if (!isPng && !isJpeg) {
      throw new Error(
        "Formato de imagem não suportado. Apenas PNG e JPEG são aceitos."
      );
    }

    console.log("Otimizando a imagem com sharp...");
    // Use `sharp` para otimizar a imagem
    let pipeline = sharp(imageBytes).resize({ width: 400, withoutEnlargement: true });
    const optimizedImageBuffer = isPng
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : await pipeline.jpeg({ quality: 60 }).toBuffer();
    // Decida o formato da imagem otimizada
    const optimizedImageBytesArray = new Uint8Array(optimizedImageBuffer);
    const optimizedIsPng =
      optimizedImageBytesArray[0] === 0x89 &&
      optimizedImageBytesArray[1] === 0x50 &&
      optimizedImageBytesArray[2] === 0x4e &&
      optimizedImageBytesArray[3] === 0x47;

    const embeddedImage = optimizedIsPng
      ? await pdfDoc.embedPng(optimizedImageBuffer)
      : await pdfDoc.embedJpg(optimizedImageBuffer);

    const { x = 50, y = 750, width = 100, height = 100 } = options;

    page.drawImage(embeddedImage, { x, y, width, height });
    console.log("Imagem otimizada e adicionada com sucesso!");
  } catch (error) {
    console.error(
      "Erro ao adicionar a imagem do Firebase ao PDF:",
      error.message
    );
  }
}

let countPages = 0;

// Função para limpar caracteres que podem causar problemas na codificação WinAnsi
function cleanTextForPDF(text) {
  if (!text || typeof text !== 'string') return text || '';
  
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove caracteres de controle
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '') // Mantém apenas caracteres WinAnsi compatíveis
    .trim();
}

async function fetchImage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erro ao buscar a imagem: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return arrayBuffer;
  } catch (error) {
    console.error(`Erro ao carregar a imagem de ${url}: ${error.message}`);
    return null;
  }
}

function formatDate(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
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
    throw error; // Relançar o erro para tratamento em outro local
  }
}

async function getAnalystData(analystId) {
  try {
    console.log("Buscando analista com ID:", analystId);
    const analystDocRef = admin.firestore().doc(`analyst/${analystId}`);
    const analystDoc = await analystDocRef.get();

    if (analystDoc.exists) {
      console.log("Dados do analista encontrados:", analystDoc.data());
      return analystDoc.data();
    } else {
      throw new Error("Analista não encontrado");
    }
  } catch (error) {
    console.error("Erro ao buscar analista:", error.message);
    throw error;
  }
}

async function generatePDF(data, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();

  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let logoClienteImage = null;
  if (clientData && clientData.logo) {
    try {
      const response = await axios.get(clientData.logo, { responseType: "arraybuffer" });
      const optimized = await sharp(response.data)
        .resize(150)
        .jpeg({ quality: 60 })
        .toBuffer();

      logoClienteImage = await pdfDoc.embedJpg(optimized);
    } catch (error) {
      console.error("Erro ao baixar logo do cliente:", error.message);
    }
  }

  const headerAssets = {
    logoEmpresaImage,
    logoClienteImage,
    helveticaFont,
    helveticaBoldFont,
  };

  const page = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  async function addHeader(pdfDoc, page, clientData, assets) {
    try {
      // Desestrutura os recursos carregados anteriormente
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

      // Logo do cliente (se tiver sido processada antes)
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

  async function addFooter(pdfDoc, page, data, pageNumber) {
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pageWidth = page.getWidth(); // Obtém a largura da página
    const formattedDate = data.inspection?.endDate ? formatDate(data.inspection.endDate) : "N/A";

    const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto}`;
    const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
    const footerTextEnd = `C&T.0.1 | ${formattedDate}\nPágina ${pageNumber}`;

    const drawMultilineText = (text, x, y, lineHeight) => {
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        page.drawText(cleanTextForPDF(line), {
          x: x,
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

  // Função para desenhar texto justificado com indentação
  async function drawIndentedJustifiedText(
    page,
    text,
    x,
    y,
    maxWidth,
    font,
    fontSize,
    indent = 0,
    lineHeight = 15
  ) {
    // Limpa o texto antes de processar
    const cleanedText = cleanTextForPDF(text);
    const words = cleanedText.split(' ');
    let lines = [];
    let currentLine = '';

    // Quebra o texto em linhas
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth - indent && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Desenha cada linha
    let currentY = y;
    lines.forEach((line, index) => {
      const isFirstLine = index === 0;
      const lineX = isFirstLine ? x + indent : x;
      
      page.drawText(cleanTextForPDF(line), {
        x: lineX,
        y: currentY,
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      
      currentY -= lineHeight;
    });

    return currentY; // Retorna a posição Y final
  }

  await addHeader(pdfDoc, page, clientData, headerAssets);

  page.drawText(`Relatório de Inspeção: ${cleanTextForPDF(data.tipoEquipamento)}`, {
    x: 115,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  if (data.images && Array.isArray(data.images) && data.images.length > 0) {
    const imageUrl = data.images[0];
    if (!imageUrl) {
      console.warn("Imagem inválida no array:", imageUrl);
    }
    console.log("Processando imagem de inspeção:", imageUrl);
    await addFirebaseImageToPDF(pdfDoc, page, imageUrl, {
      x: 172,
      y: 420,
      width: 250,
      height: 250,
    });
  } else {
    console.warn("Nenhuma imagem de inspeção disponível.");
  }

  page.drawText(`Detalhes do Equipamento:`, {
    x: 50,
    y: 380,
    size: 16,
    font: helveticaBoldFont,
  });
  page.drawText(`Nome do equipamento: `, {
    x: 50,
    y: 350,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${cleanTextForPDF(data.nomeEquipamento) || " "}`, {
    x: 208,
    y: 350,
    size: 14,
    font: helveticaFont,
  });
  page.drawText(`Número de série:`, {
    x: 50,
    y: 320,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${cleanTextForPDF(data.numeroSerie) || " "}`, {
    x: 165,
    y: 320,
    size: 14,
    font: helveticaFont,
  });
  page.drawText(`Patrimônio/TAG: `, {
    x: 50,
    y: 290,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${cleanTextForPDF(data.numeroPatrimonio) || " "}  ${cleanTextForPDF(data.tag) || " "}`, {
    x: 162,
    y: 290,
    size: 14,
    font: helveticaFont,
  });
  page.drawText(`Fabricante: `, {
    x: 50,
    y: 260,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${cleanTextForPDF(data.fabricante)}`, {
    x: 128,
    y: 260,
    size: 14,
    font: helveticaFont,
  });

  page.drawText(`${cleanTextForPDF(clientData.person) || " "}`, {
    x: 50,
    y: 200,
    size: 12,
    font: helveticaBoldFont,
  });
  page.drawText(`${cleanTextForPDF(clientData.address) || " "} CEP: ${cleanTextForPDF(clientData.cep) || " "}`, {
    x: 50,
    y: 185,
    size: 12,
    font: helveticaFont,
  });
  page.drawText(`CNPJ: ${cleanTextForPDF(clientData.cnpj) || " "}`, {
    x: 50,
    y: 170,
    size: 12,
    font: helveticaFont,
  });
  page.drawText(`FONE: ${cleanTextForPDF(clientData.phone) || " "}`, {
    x: 50,
    y: 155,
    size: 12,
    font: helveticaFont,
  });

  const formattedDate = data.endDate ? formatDate(data.endDate) : "N/A";

  await addFooter(pdfDoc, page, data, countPages);

  // ===================== PÁGINA 2 - SUMÁRIO =====================
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, page2, clientData, headerAssets);

  // Título do Sumário
  page2.drawText("SUMÁRIO", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // Função para criar sumário com alinhamento adequado
  function drawTableOfContents(page, startY) {
    const items = [
      { text: "1. INFORMAÇÕES GERAIS", page: "3" },
      { text: "1.1 DADOS CADASTRAIS", page: "3" },
      { text: "1.2 RESPONSÁVEIS TÉCNICOS", page: "3" },
      { text: "1.3 CONTROLE DE REVISÃO", page: "3" },
      { text: "1.4 INSPEÇÕES CONTRATADAS", page: "3" },
      { text: "1.5 DADOS DO EQUIPAMENTO", page: "4" },
      { text: "1.6 CATEGORIZAÇÃO", page: "5" },
      { text: "1.7 PESSOAS QUE ACOMPANHARAM", page: "5" },
      { text: "1.8 DOCUMENTAÇÃO EXISTENTE", page: "6" },
      { text: "2. DEFINIÇÃO", page: "7" },
      { text: "3. OBJETIVO", page: "7" },
      { text: "4. NORMAS", page: "7" },
      { text: "5. CARACTERIZAÇÃO", page: "8" },
      { text: "5.1 DISPOSITIVOS", page: "8" },
      { text: "5.2 MAPA DE MEDIÇÃO", page: "12" },
      { text: "6. RECOMENDAÇÕES DA NORMA", page: "15" },
      { text: "7. CONCLUSÃO", page: "26" },
      { text: "8. RESPONSABILIDADE TÉCNICA", page: "27" }
    ];

    let currentY = startY;
    const lineHeight = 20;
    const pageWidth = page.getWidth();
    const rightMargin = 50;

    items.forEach(item => {
      // Desenha o texto do item
      page.drawText(cleanTextForPDF(item.text), {
        x: 50,
        y: currentY,
        size: 12,
        font: helveticaFont,
      });

      // Calcula a largura do número da página
      const pageNumWidth = helveticaFont.widthOfTextAtSize(item.page, 12);
      
      // Desenha pontos de preenchimento
      const textWidth = helveticaFont.widthOfTextAtSize(item.text, 12);
      const dotsStartX = 50 + textWidth + 10;
      const dotsEndX = pageWidth - rightMargin - pageNumWidth - 10;
      const dotsWidth = dotsEndX - dotsStartX;
      const dotSpacing = 8;
      const numDots = Math.floor(dotsWidth / dotSpacing);

      for (let i = 0; i < numDots; i++) {
        page.drawText(".", {
          x: dotsStartX + (i * dotSpacing),
          y: currentY,
          size: 12,
          font: helveticaFont,
        });
      }

      // Desenha o número da página alinhado à direita
      page.drawText(item.page, {
        x: pageWidth - rightMargin - pageNumWidth,
        y: currentY,
        size: 12,
        font: helveticaFont,
      });

      currentY -= lineHeight;
    });
  }

  drawTableOfContents(page2, 660);

  await addFooter(pdfDoc, page2, data, countPages);

  // ===================== PÁGINA 3 - INFORMAÇÕES GERAIS =====================
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, page3, clientData, headerAssets);

  page3.drawText("1. INFORMAÇÕES GERAIS", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });
  page3.drawText("1.1 DADOS CADASTRAIS", {
    x: 50,
    y: 664,
    size: 16,
    font: helveticaBoldFont,
  });

  const columnWidths = [247.64, 247.64]; // Largura das colunas
  const rowHeight = 98;
  const headerRowHeight = 20;
  const dataRowHeight = 90;

  const tableDataRegistrationData = [
    ["CLIENTE", "ELABORAÇÃO"], // Cabeçalho
    [
      `${cleanTextForPDF(clientData.person) || " "}
${cleanTextForPDF(clientData.address) || " "}, ${cleanTextForPDF(clientData.neighborhood) || " "}, ${cleanTextForPDF(clientData.number) || " "}
CEP: ${cleanTextForPDF(clientData.cep) || " "}
CNPJ: ${cleanTextForPDF(clientData.cnpj) || " "}
TEL.: ${cleanTextForPDF(clientData.phone) || " "}
E-mail: ${cleanTextForPDF(clientData.email) || " "}`,
      `${cleanTextForPDF(engenieerData.name) || " "}
${cleanTextForPDF(engenieerData.address) || " "}, ${cleanTextForPDF(engenieerData.neighborhood) || " "}, ${cleanTextForPDF(engenieerData.number) || " "}
CEP: ${cleanTextForPDF(engenieerData.cep) || " "}
CNPJ: ${cleanTextForPDF(engenieerData.cnpj) || " "}
CREA: ${cleanTextForPDF(engenieerData.crea) || " "}
TEL.: ${cleanTextForPDF(engenieerData.phone) || " "}
E-mail: ${cleanTextForPDF(engenieerData.email) || " "}`,
    ],
  ];

  // Função para quebrar texto em múltiplas linhas
  function wrapText(text, maxWidth, font, fontSize) {
    const words = text.split(' ');
    let lines = [];
    let currentLine = '';

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

  async function drawTableRegistrationData(
    page,
    pdfDoc,
    startX,
    startY,
    columnWidths,
    rowHeight,
    data,
    helveticaFont,
    helveticaBoldFont
  ) {
    let currentY = startY;

    // Desenhar cabeçalho com fundo azul
    const header = data[0];
    header.forEach((cell, columnIndex) => {
      const x =
        startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidths[columnIndex],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396), // Azul
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      page.drawText(cleanTextForPDF(cell), {
        x: x + 10, // Margem interna
        y: currentY - headerRowHeight / 2 - 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1), // Branco
      });
    });

    // Desenhar os dados da tabela
    currentY -= headerRowHeight; // Ajuste vertical após cabeçalho
    const textPadding = 10; // Margem interna do texto
    const lineHeight = 12; // Espaçamento entre linhas
    
    data.slice(1).forEach((row) => {
      // Calcular a altura necessária para esta linha baseada no conteúdo
      let maxLinesInRow = 1;
      
      row.forEach((cell, columnIndex) => {
        const maxWidth = columnWidths[columnIndex] - 2 * textPadding;
        const allLines = cell.split("\n").flatMap(line => 
          wrapText(line.trim(), maxWidth, helveticaFont, 10)
        );
        maxLinesInRow = Math.max(maxLinesInRow, allLines.length);
      });
      
      // Altura dinâmica baseada no número de linhas
      const dynamicRowHeight = Math.max(dataRowHeight, maxLinesInRow * lineHeight + 2 * textPadding);
      
      row.forEach((cell, columnIndex) => {
        const x =
          startX +
          columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
        page.drawRectangle({
          x,
          y: currentY - dynamicRowHeight,
          width: columnWidths[columnIndex],
          height: dynamicRowHeight,
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        // Quebrar texto em linhas respeitando a largura da coluna
        const maxWidth = columnWidths[columnIndex] - 2 * textPadding;
        const lines = cell.split("\n").flatMap(line => 
          wrapText(line.trim(), maxWidth, helveticaFont, 10)
        );
        let textY = currentY - textPadding;

        lines.forEach((line) => {
          page.drawText(cleanTextForPDF(line), {
            x: x + textPadding,
            y: textY - lineHeight,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });
          textY -= lineHeight;
        });
      });
      currentY -= dynamicRowHeight; // Pular para a próxima linha da tabela
    });
  }

  await drawTableRegistrationData(
    page3,
    pdfDoc,
    50,
    650,
    columnWidths,
    rowHeight,
    tableDataRegistrationData,
    helveticaFont,
    helveticaBoldFont
  );

  page3.drawText("1.2 RESPONSÁVEIS TÉCNICOS", {
    x: 50,
    y: 510,
    size: 16,
    font: helveticaBoldFont,
  });

  const tableDataTechnicalManagers = [
    ["ANALISTA", "ENGENHEIRO"], // Cabeçalho
    [
      `${cleanTextForPDF(analystData.name) || " "}
E-mail: ${cleanTextForPDF(analystData.email) || "N/C"}`,
      `${cleanTextForPDF(engenieerData.name) || " "}
CREA: ${cleanTextForPDF(engenieerData.crea) || " "}`,
    ],
  ];

  async function drawTableTechnicalManagers(
    page,
    pdfDoc,
    startX,
    startY,
    columnWidths,
    rowHeight,
    data,
    helveticaFont,
    helveticaBoldFont
  ) {
    let currentY = startY;

    // Desenhar cabeçalho com fundo azul
    const header = data[0];
    header.forEach((cell, columnIndex) => {
      const x =
        startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidths[columnIndex],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396), // Azul
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      page.drawText(cleanTextForPDF(cell), {
        x: x + 10, // Margem interna
        y: currentY - headerRowHeight / 2 - 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1), // Branco
      });
    });

    // Desenhar os dados da tabela
    currentY -= headerRowHeight; // Ajuste vertical após cabeçalho
    const textPadding = 10; // Margem interna do texto
    const lineHeight = 12; // Espaçamento entre linhas
    data.slice(1).forEach((row) => {
      row.forEach((cell, columnIndex) => {
        const x =
          startX +
          columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
        page.drawRectangle({
          x,
          y: currentY,
          width: columnWidths[columnIndex],
          height: dataRowHeight / -3,
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        // Ajustar e dividir o texto em linhas
        const lines = cell.split("\n").map((line) => line.trim());
        let textY = currentY - textPadding;

        lines.forEach((line) => {
          page.drawText(cleanTextForPDF(line), {
            x: x + textPadding,
            y: textY - lineHeight + 10,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });
          textY -= lineHeight / 2;
        });
      });
      currentY -= dataRowHeight; // Pular para a próxima linha da tabela
    });
  }

  await drawTableTechnicalManagers(
    page3,
    pdfDoc,
    50,
    495,
    columnWidths,
    rowHeight,
    tableDataTechnicalManagers,
    helveticaFont,
    helveticaBoldFont
  );

  page3.drawText("1.3 CONTROLE DE REVISÃO", {
    x: 50,
    y: 415,
    size: 16,
    font: helveticaBoldFont,
  });

  const tableDataRevisionControl = [
    ["REVISÃO", "DESCRIÇÃO", "RESPONSÁVEL", "DATA"],
    [
      `${cleanTextForPDF(data.numeroProjeto) || " "}`,
      `${cleanTextForPDF(data.descricaoRevisao) || " "}`,
      `${cleanTextForPDF(analystData.name) || " "}`,
      `${data.inspection?.endDate || "N/A"}`,
    ],
  ];

  let columnWidthsDrawTableRevisionControl = [70, 205.28, 140, 80];
  async function drawTableRevisionControl(
    page,
    pdfDoc,
    startX,
    startY,
    columnWidthsDrawTableRevisionControl,
    rowHeight,
    data,
    helveticaFont,
    helveticaBoldFont
  ) {
    let currentY = startY;

    // Desenhar cabeçalho com fundo azul
    const header = data[0];
    header.forEach((cell, columnIndex) => {
      const x =
        startX +
        columnWidthsDrawTableRevisionControl
          .slice(0, columnIndex)
          .reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidthsDrawTableRevisionControl[columnIndex],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396), // Azul
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      page.drawText(cleanTextForPDF(cell), {
        x: x + 10, // Margem interna
        y: currentY - headerRowHeight / 2 - 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1), // Branco
      });
    });

    // Desenhar os dados da tabela
    currentY -= headerRowHeight; // Ajuste vertical após cabeçalho
    const textPadding = 10; // Margem interna do texto
    const lineHeight = 12; // Espaçamento entre linhas
    data.slice(1).forEach((row) => {
      row.forEach((cell, columnIndex) => {
        const x =
          startX +
          columnWidthsDrawTableRevisionControl
            .slice(0, columnIndex)
            .reduce((a, b) => a + b, 0);
        page.drawRectangle({
          x,
          y: currentY,
          width: columnWidthsDrawTableRevisionControl[columnIndex],
          height: dataRowHeight / -4,
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        // Ajustar e dividir o texto em linhas
        const lines = cell.split("\n").map((line) => line.trim());
        let textY = currentY - textPadding;

        lines.forEach((line) => {
          page.drawText(cleanTextForPDF(line), {
            x: x + textPadding,
            y: textY - lineHeight + 10,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });
          textY -= lineHeight / 2;
        });
      });
      currentY -= dataRowHeight; // Pular para a próxima linha da tabela
    });
  }

  await drawTableRevisionControl(
    page3,
    pdfDoc,
    50,
    400,
    columnWidthsDrawTableRevisionControl,
    rowHeight,
    tableDataRevisionControl,
    helveticaFont,
    helveticaBoldFont
  );

  page3.drawText("1.4 INSPEÇÕES CONTRATADAS", {
    x: 50,
    y: 330,
    size: 16,
    font: helveticaBoldFont,
  });

  const tableDataContractedInspections = [
    ["TIPO", "CARACTERÍSTICA", "DATA INÍCIO", "DATA TÉRMINO"],
    [
      `${[
        data.inspection?.selectedTypesInspection?.extraordinaria
          ? "Extraordinária"
          : null,
        data.inspection?.selectedTypesInspection?.inicial ? "Inicial" : null,
        data.inspection?.selectedTypesInspection?.periodica ? "Periódica" : null,
      ]
        .filter(Boolean)
        .join(", ")}`,
      `${[
        data.inspection?.selectedPeriodicInspection?.externa ? "Externa" : null,
        data.inspection?.selectedPeriodicInspection?.interna
          ? " Interna"
          : null,
        data.inspection?.selectedPeriodicInspection?.hidrostatico
          ? " Hidrostático"
          : null,
      ]
        .filter(Boolean)
        .join(", ")}`,
      `${data.inspection?.startDate || "N/A"}`,
      `${data.inspection?.endDate || "N/A"}`,
    ],
  ];

  let columnWidthsDrawTableContractedInspections = [80, 205.28, 110, 110];
  async function drawTableContractedInspections(
    page,
    pdfDoc,
    startX,
    startY,
    columnWidthsDrawTableContractedInspections,
    rowHeight,
    data,
    helveticaFont,
    helveticaBoldFont
  ) {
    let currentY = startY;

    // Desenhar cabeçalho com fundo azul
    const header = data[0];
    header.forEach((cell, columnIndex) => {
      const x =
        startX +
        columnWidthsDrawTableContractedInspections
          .slice(0, columnIndex)
          .reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidthsDrawTableContractedInspections[columnIndex],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396), // Azul
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      page.drawText(cleanTextForPDF(cell), {
        x: x + 10, // Margem interna
        y: currentY - headerRowHeight / 2 - 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1), // Branco
      });
    });

    // Desenhar os dados da tabela
    currentY -= headerRowHeight; // Ajuste vertical após cabeçalho
    const textPadding = 10; // Margem interna do texto
    const lineHeight = 12; // Espaçamento entre linhas
    data.slice(1).forEach((row) => {
      row.forEach((cell, columnIndex) => {
        const x =
          startX +
          columnWidthsDrawTableContractedInspections
            .slice(0, columnIndex)
            .reduce((a, b) => a + b, 0);
        page.drawRectangle({
          x,
          y: currentY,
          width: columnWidthsDrawTableContractedInspections[columnIndex],
          height: dataRowHeight / -4,
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        // Ajustar e dividir o texto em linhas
        const lines = cell.split("\n").map((line) => line.trim());
        let textY = currentY - textPadding;

        lines.forEach((line) => {
          page.drawText(cleanTextForPDF(line), {
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

  await drawTableContractedInspections(
    page3,
    pdfDoc,
    50,
    315,
    columnWidthsDrawTableContractedInspections,
    rowHeight,
    tableDataContractedInspections,
    helveticaFont,
    helveticaBoldFont
  );

  await addFooter(pdfDoc, page3, data, countPages);

  // ===================== PÁGINA 4 - DADOS DO EQUIPAMENTO =====================
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, page4, clientData, headerAssets);

  page4.drawText("1.5 DADOS DO EQUIPAMENTO", {
    x: 50,
    y: 720,
    size: 16,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  // Função para desenhar grid de imagens
  async function drawImageGrid({
    page,
    pdfDoc,
    startX,
    startY,
    columnWidth,
    rowHeight,
    images,
    captions,
    helveticaFont,
    helveticaBoldFont,
  }) {
    const headerHeight = 20;
    const imageHeight = 80;
    const captionHeight = 15;
    const padding = 5;

    // Cabeçalho azul
    const headerText = "IDENTIFICAÇÃO";
    page.drawRectangle({
      x: startX,
      y: startY - 30,
      width: 495.28,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page.drawText(headerText, {
      x: startX + columnWidth,
      y: startY - 22,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });

    // Coordenadas iniciais para imagens
    let currentX = startX;
    let currentY = startY - headerHeight - padding;

    for (let i = 0; i < Math.min(images.length, 6); i++) {
      const imageObj = images[i];

      if (!imageObj || !imageObj.buffer) {
        console.warn(`Imagem inválida no índice ${i}`);
        continue;
      }

      try {
        const pdfImage = await pdfDoc.embedJpg(imageObj.buffer);

        page.drawImage(pdfImage, {
          x: currentX,
          y: currentY - 155,
          width: columnWidth,
          height: 150,
        });

        page.drawText(cleanTextForPDF(captions[i]) || `Imagem ${i + 1}`, {
          x: currentX + 60,
          y: currentY - columnWidth - 5,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
      } catch (error) {
        console.error(`Erro ao desenhar imagem no índice ${i}: ${error.message}`);
      }

      currentX += columnWidth + padding;

      if ((i + 1) % 3 === 0) {
        currentX = startX;
        currentY -= rowHeight;
      }
    }
  }

  // Baixar e processar imagens gerais
  const imagensGerais = await baixarEComprimirTodasImagens(data.images || []);

  await drawImageGrid({
    page: page4,
    pdfDoc,
    startX: 50,
    startY: 700,
    columnWidth: 161.5,
    rowHeight: 185,
    images: imagensGerais,
    captions: ["Geral", "Traseira", "Direita", "Esquerda", "Frontal", "Placa"],
    helveticaFont: helveticaFont,
    helveticaBoldFont: helveticaBoldFont,
  });

  // Tabela de dados gerais
  const columnWidthsDrawGeralDatas = [350, 145.28];
  const rowHeightDrawGeralDatas = 20;

  const tableDataGeralDatas = [
    ["TIPO", `${cleanTextForPDF(data.tipoEquipamento) || " "}`],
    ["TIPO DA CALDEIRA", `${cleanTextForPDF(data.tipoCaldeira) || " "}`],
    ["NÚMERO DE SÉRIE", `${cleanTextForPDF(data.numeroSerie) || " "}`],
    ["ANO DE FABRICAÇÃO", `${cleanTextForPDF(data.anoFabricacao) || " "}`],
    [
      "PRESSÃO MÁXIMA DE TRABALHO ADMISSÍVEL (PMTA)",
      `${cleanTextForPDF(data.pressaoMaxima) || " "} ${cleanTextForPDF(data.unidadePressaoMaxima) || " "}`,
    ],
    [
      "PRESSÃO DE TESTE HIDROSTÁTICO DE FABRICAÇÃO (PTHF)",
      `${cleanTextForPDF(data.pressaoTeste) || " "} ${cleanTextForPDF(data.unidadePressaoMaxima) || " "}`,
    ],
    [
      "CAPACIDADE DE PRODUÇÃO DE VAPOR (CPV)",
      `${cleanTextForPDF(data.capacidadeProducaoVapor) || " "}`,
    ],
    [
      "ÁREA DA SUPERFÍCIE DE AQUECIMENTO (ASA)",
      `${cleanTextForPDF(data.areaSuperficieAquecimento) || " "}`,
    ],
    [
      "CÓDIGO DO PROJETO / ANO DE EDIÇÃO",
      `${cleanTextForPDF(data.codProjeto) || " "} / ${cleanTextForPDF(data.anoEdicao) || " "}`,
    ],
    ["LOCAL DE INSTALAÇÃO", `${cleanTextForPDF(data.localInstalacao) || " "}`],
  ];

  async function drawTableGeralDatas({
    page,
    startX,
    startY,
    columnWidthsDrawGeralDatas,
    rowHeightDrawGeralDatas,
    tableDataGeralDatas,
    helveticaFont,
    helveticaBoldFont,
  }) {
    const headerHeight = 20;
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
    for (let i = 0; i < tableDataGeralDatas.length; i++) {
      const row = tableDataGeralDatas[i];
      let currentX = startX;

      for (let j = 0; j < row.length; j++) {
        const cellText = cleanTextForPDF(row[j]);
        const cellWidth = columnWidthsDrawGeralDatas[j];

        page.drawRectangle({
          x: currentX,
          y: currentY,
          width: cellWidth,
          height: rowHeightDrawGeralDatas,
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
      currentY -= rowHeightDrawGeralDatas;
    }
  }

  await drawTableGeralDatas({
    page: page4,
    startX: 50,
    startY: 300,
    columnWidthsDrawGeralDatas,
    rowHeightDrawGeralDatas,
    tableDataGeralDatas,
    helveticaFont,
    helveticaBoldFont,
  });

  await addFooter(pdfDoc, page4, data, countPages);

  // ===================== PÁGINA 5 - CATEGORIZAÇÃO =====================
  const page5 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, page5, clientData, headerAssets);

  page5.drawText("1.6 CATEGORIZAÇÃO", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  const columnWidthsCategorization = [350, 145.28];
  const rowHeightDrawCategorization = 20;

  const tableDataCategorization = [
    ["CATEGORIA", `${cleanTextForPDF(data.categoria) || " "}`],
    ["CLASSE", `${cleanTextForPDF(data.classe) || " "}`],
    ["FLUÍDO DE TRABALHO", `${cleanTextForPDF(data.fluidoTrabalho) || " "}`],
    ["COMBUSTÍVEL", `${cleanTextForPDF(data.combustivel) || " "}`],
  ];

  async function drawTableCategorization({
    page,
    startX,
    startY,
    columnWidthsCategorization,
    rowHeightDrawCategorization,
    tableDataCategorization,
    helveticaFont,
    helveticaBoldFont,
  }) {
    const headerHeight = 20;
    page.drawRectangle({
      x: startX,
      y: startY,
      width: 495.5,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page.drawText("CATEGORIZAÇÃO", {
      x: startX + 180,
      y: startY + 5,
      size: 10,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });

    let currentY = startY - headerHeight;
    for (let i = 0; i < tableDataCategorization.length; i++) {
      const row = tableDataCategorization[i];
      let currentX = startX;

      for (let j = 0; j < row.length; j++) {
        const cellText = cleanTextForPDF(row[j]);
        const cellWidth = columnWidthsCategorization[j];

        page.drawRectangle({
          x: currentX,
          y: currentY,
          width: cellWidth,
          height: rowHeightDrawCategorization,
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
      currentY -= rowHeightDrawCategorization;
    }
  }

  await drawTableCategorization({
    page: page5,
    startX: 50,
    startY: 680,
    columnWidthsCategorization,
    rowHeightDrawCategorization,
    tableDataCategorization,
    helveticaFont,
    helveticaBoldFont,
  });

  page5.drawText("1.7 PESSOAS QUE ACOMPANHARAM", {
    x: 50,
    y: 580,
    size: 16,
    font: helveticaBoldFont,
  });

  const pessoasText = cleanTextForPDF(data.pessoasAcompanharam || "Não informado");
  await drawIndentedJustifiedText(
    page5,
    pessoasText,
    50,
    550,
    495.28,
    helveticaFont,
    12,
    4,
    18
  );

  page5.drawText("1.8 DOCUMENTAÇÃO EXISTENTE", {
    x: 50,
    y: 480,
    size: 16,
    font: helveticaBoldFont,
  });

  const documentacaoText = cleanTextForPDF(data.documentacaoExistente || "Não informado");
  await drawIndentedJustifiedText(
    page5,
    documentacaoText,
    50,
    450,
    495.28,
    helveticaFont,
    12,
    4,
    18
  );

  await addFooter(pdfDoc, page5, data, countPages);

  // ===================== PÁGINA 6 - DEFINIÇÃO, OBJETIVO E NORMAS =====================
  const page6 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, page6, clientData, headerAssets);

  page6.drawText("2. DEFINIÇÃO", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  await drawIndentedJustifiedText(
    page6,
    "Esta Norma Regulamentadora (NR-13) estabelece requisitos mínimos para gestão da integridade estrutural de caldeiras a vapor, vasos de pressão, suas tubulações de interligação e tanques metálicos de armazenamento nos aspectos relacionados à instalação, inspeção, operação e manutenção, visando à segurança e à saúde dos trabalhadores.",
    50,
    664,
    495.28,
    helveticaFont,
    12,
    4,
    20
  );

  page6.drawText("3. OBJETIVO", {
    x: 50,
    y: 577,
    size: 24,
    font: helveticaBoldFont,
  });

  await drawIndentedJustifiedText(
    page6,
    "Este relatório tem como objetivo registrar os resultados de uma inspeção em Caldeira sob a ótica da NR-13 aprovada pela portaria n° 3.214, de 8 de junho de 1978, e Legislação Complementar pela Portaria SEPRT n° 1.846 de 1º de julho de 2022, - NR13 CALDEIRAS, VASOS DE PRESSÃO, TUBULAÇÕES E TANQUES METÁLICOS.",
    50,
    544,
    495.28,
    helveticaFont,
    12,
    4,
    20
  );

  page6.drawText("4. NORMAS", {
    x: 50,
    y: 460,
    size: 24,
    font: helveticaBoldFont,
  });
  page6.drawText("REFERÊNCIAS NORMATIVAS", {
    x: 50,
    y: 420,
    size: 24,
    font: helveticaBoldFont,
  });

  const startX = 50;
  const startY = 400;
  const columnWidthsReferencesNorms = [115.28, 380];
  const tableDataReferencesNorms = [
    ["NORMA", "DESCRIÇÃO"],
    [
      "NR-13",
      "Caldeiras, vasos de pressão, tubulações e tanques metálicos de armazenamento",
    ],
    ["NBR 15417:2007", "Vasos de pressão - Inspeção de segurança em serviço"],
    [
      "ASME I:2015",
      "ASME Boiler and Pressure Vessel Code An International Code - Rules for Construction of Power Boilers",
    ],
    [
      "ASME II:2015",
      "ASME Boiler and Pressure Vessel Code An International Code - Part D Properties (Customary)",
    ],
    [
      "ASME VIII:2015",
      "ASME Boiler and Pressure Vessel Code An International Code - Division 1",
    ],
    [
      "NBR ISO 12100:2013",
      "Segurança de máquinas - Princípios gerais de projeto - Apreciação e redução de riscos",
    ],
    [
      "EN ISO 12100:2010",
      "Safety of machinery - General principles for design - Risk assessment and risk reduction",
    ],
    [
      "ABNT NBR ISO 16528-1:2021",
      "Caldeiras e vasos de pressão - Parte 1: Requisitos de desempenho",
    ],
  ];

  // Função para quebrar texto
  function wrapTextNorms(text, maxWidth, font, fontSize) {
    const words = text.split(" ");
    let lines = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine + (currentLine ? " " : "") + word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    return lines;
  }

  const defaultFontSize = 10;
  const lineHeight = 16;
  let currentY = startY;

  for (let i = 0; i < tableDataReferencesNorms.length; i++) {
    const row = tableDataReferencesNorms[i];
    let currentX = startX;
    let rowHeight = 0;

    // Calcula a altura necessária para a linha atual
    const cellLines = row.map((cell, index) =>
      wrapTextNorms(
        cleanTextForPDF(cell),
        columnWidthsReferencesNorms[index] - 10,
        i === 0 ? helveticaBoldFont : helveticaFont,
        defaultFontSize
      )
    );
    rowHeight =
      Math.max(...cellLines.map((lines) => lines.length)) * lineHeight;

    // Desenha cada célula da linha
    for (let j = 0; j < row.length; j++) {
      const text = cleanTextForPDF(row[j]);
      const cellWidth = columnWidthsReferencesNorms[j];
      const lines = cellLines[j];

      // Desenha o fundo da célula
      page6.drawRectangle({
        x: currentX,
        y: currentY - rowHeight,
        width: cellWidth,
        height: rowHeight,
        color: i === 0 ? rgb(0.102, 0.204, 0.396) : rgb(1, 1, 1),
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      // Desenha o texto na célula
      for (let k = 0; k < lines.length; k++) {
        page6.drawText(cleanTextForPDF(lines[k]), {
          x: currentX + 5,
          y: currentY - 12 - k * lineHeight,
          size: defaultFontSize,
          font: i === 0 ? helveticaBoldFont : helveticaFont,
          color: i === 0 ? rgb(1, 1, 1) : rgb(0, 0, 0),
        });
      }

      currentX += cellWidth;
    }

    currentY -= rowHeight;
  }

  await addFooter(pdfDoc, page6, data, countPages);

  // ===================== SEÇÃO 5 - CARACTERIZAÇÃO =====================
  
  // Função para gerar páginas de dispositivos
  async function generateDevicesPDF(pdfDoc, devicesData) {
    if (!devicesData || Object.keys(devicesData).length === 0) {
      console.log("Nenhum dispositivo encontrado para gerar páginas");
      return;
    }

    for (const [index, device] of Object.entries(devicesData || {})) {
      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const pageDevice = pdfDoc.addPage([pageWidth, pageHeight]);
      countPages++;

      await addHeader(pdfDoc, pageDevice, clientData, headerAssets);

      pageDevice.drawText("5. CARACTERIZAÇÃO", {
        x: 50,
        y: 700,
        size: 24,
        font: helveticaBoldFont,
      });
      pageDevice.drawText("5.1 DISPOSITIVOS", {
        x: 50,
        y: 664,
        size: 16,
        font: helveticaBoldFont,
      });
      let cursorY = 640;

      const deviceType =
        device["Tipo de dispositivo"]?.toUpperCase() || "TIPO NÃO ESPECIFICADO";
      const headerHeight = 20;

      pageDevice.drawRectangle({
        x: 50,
        y: cursorY - headerHeight,
        width: 500,
        height: headerHeight,
        color: rgb(0.102, 0.204, 0.396), // Azul #4a89dc
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      const textWidth = helveticaFont.widthOfTextAtSize(deviceType, 12);
      const textX = (pageWidth - textWidth) / 2;

      pageDevice.drawText(cleanTextForPDF(deviceType), {
        x: textX,
        y: cursorY - headerHeight + 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1),
      });

      cursorY -= headerHeight + 5;

      if (device["Imagens"] && device["Imagens"].length > 0) {
        for (const imageUrl of device["Imagens"]) {
          console.log(`Processando imagem para o dispositivo: ${deviceType}`);
          const imageWidth = 200;
          const imageHeight = 200;
          const imageX = (pageWidth - imageWidth) / 2;
          const imageY = cursorY - imageHeight;

          pageDevice.drawRectangle({
            x: 50,
            y: imageY - 5,
            width: 500,
            height: imageHeight + 10,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          await addFirebaseImageToPDF(pdfDoc, pageDevice, imageUrl, {
            x: imageX,
            y: cursorY - 200,
            width: 200,
            height: 200,
          });
          cursorY -= 210; // Ajusta a posição após exibir a imagem
        }
      }

      // Detalhes adicionais do dispositivo
      Object.entries(device)
        .filter(([key]) => key !== "Imagens" && key !== "Tipo de dispositivo")
        .forEach(([key, value]) => {
          const text = `${key}: ${cleanTextForPDF(value) || ""}`;
          const textHeight = 15;

          pageDevice.drawRectangle({
            x: 50,
            y: cursorY - textHeight + 5,
            width: 500,
            height: textHeight,
            color: rgb(1, 1, 1), // Fundo branco
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          pageDevice.drawText(cleanTextForPDF(text), {
            x: 55,
            y: cursorY - textHeight + 10,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });

          cursorY -= textHeight;
        });
      await addFooter(pdfDoc, pageDevice, data, countPages);
    }
  }

  // Gera o PDF para dispositivos
  await generateDevicesPDF(pdfDoc, data.inspection?.devicesData);

  // ===================== SEÇÃO 5.2 - MAPA DE MEDIÇÃO =====================
  const pageMapMedition = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, pageMapMedition, clientData, headerAssets);

  pageMapMedition.drawText("5.2 MAPA DE MEDIÇÃO", {
    x: 50,
    y: 700,
    size: 16,
    font: helveticaBoldFont,
  });

  // Função para preparar imagens de medição
  async function prepararImagensDeMedicao(pdfDoc, mapOfMedition) {
    const imagens = {};

    for (const key of Object.keys(mapOfMedition || {})) {
      const imageKey = `image${key[0].toUpperCase()}${key.slice(1)}`;
      const imageURL = mapOfMedition[key]?.[imageKey];

      if (imageURL) {
        try {
          const response = await axios.get(imageURL, { responseType: "arraybuffer" });
          const optimized = await sharp(response.data)
            .resize({ width: 200 })
            .jpeg({ quality: 60 })
            .toBuffer();

          imagens[imageKey] = await pdfDoc.embedJpg(optimized);
        } catch (error) {
          console.error(`Erro ao carregar imagem ${imageKey}:`, error.message);
          imagens[imageKey] = null;
        }
      }
    }

    return imagens;
  }

  // Função para adicionar dados de inspeção ao PDF
  async function addInspectionDataToPDF(
    page,
    pdfDoc,
    data,
    startX,
    startY,
    font,
    fontBold,
    imagensDeMedicaoOtimizadas,
    clientData,
    headerAssets
  ) {
    const headerHeight = 20; // Altura para o cabeçalho de cada seção
    const boxPadding = 10; // Padding das caixas
    const imageSize = 200; // Tamanho das imagens
    let currentY = startY;

    // Verifica se existem medições
    const filteredMeditionData = Object.entries(
      data.inspection?.mapOfMedition || {}
    ).filter(([key, value]) =>
      Object.keys(value).some(
        (subKey) =>
          value[subKey] &&
          (typeof value[subKey] === "string" ||
            (Array.isArray(value[subKey]) && value[subKey].length > 0))
      )
    );

    for (const [key, value] of filteredMeditionData) {
      // Cabeçalho da seção
      const sectionTitle = key.toUpperCase() || "Tipo não especificado";

      page.drawRectangle({
        x: 50,
        y: currentY - headerHeight,
        width: 500,
        height: headerHeight,
        color: rgb(0.102, 0.204, 0.396),
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      const textWidth = helveticaFont.widthOfTextAtSize(sectionTitle, 12);
      const textX = (598.28 - textWidth) / 2;

      page.drawText(cleanTextForPDF(sectionTitle), {
        x: textX,
        y: currentY - headerHeight + 5,
        size: 12,
        font: fontBold,
        color: rgb(1, 1, 1),
      });

      currentY -= headerHeight;

      // Renderizar imagem, se embutida previamente
      const imageKey = `image${key[0].toUpperCase()}${key.slice(1)}`;
      const pdfImage = imagensDeMedicaoOtimizadas[imageKey];

      if (pdfImage) {
        page.drawRectangle({
          x: startX,
          y: currentY - imageSize - 10,
          width: 500,
          height: imageSize + 10,
          color: rgb(1, 1, 1),
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        page.drawImage(pdfImage, {
          x: (595.28 - 200) / 2,
          y: currentY - imageSize - 5,
          width: 200,
          height: 200,
        });

        currentY -= imageSize + 10;
      } else {
        console.warn(`Imagem otimizada não encontrada para chave: ${imageKey}`);
      }

      // Renderizar medições
      Object.entries(value)
        .filter(
          ([subKey, measuresArray]) =>
            subKey.startsWith(key) &&
            Array.isArray(measuresArray) &&
            measuresArray.length > 0
        )
        .forEach(([subKey, measuresArray]) => {
          page.drawRectangle({
            x: startX,
            y: currentY - headerHeight,
            width: 500,
            height: headerHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          page.drawText(cleanTextForPDF(`${subKey}:`), {
            x: startX + 10,
            y: currentY - 15,
            size: 10,
            font: fontBold,
            color: rgb(0, 0, 0),
          });

          currentY -= 20;

          const measuresText = measuresArray
            .map((measure) => `P${measure.id}: ${measure.valor}`)
            .join(", ");

          page.drawRectangle({
            x: startX,
            y: currentY - headerHeight,
            width: 500,
            height: headerHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          page.drawText(cleanTextForPDF(measuresText), {
            x: startX + 10,
            y: currentY - 15,
            size: 10,
            font,
            color: rgb(0, 0, 0),
          });

          currentY -= 20;

          if (currentY < 340) {
            page = pdfDoc.addPage();
            countPages++;
            addHeader(pdfDoc, page, clientData, headerAssets);
            pageMapMedition.drawText("5.2 MAPA DE MEDIÇÃO", {
              x: 50,
              y: 700,
              size: 16,
              font: helveticaBoldFont,
            });
            currentY = startY;
          }
        });

      await addFooter(pdfDoc, page, data, countPages);
    }
  }

  const imagensDeMedicaoOtimizadas = await prepararImagensDeMedicao(pdfDoc, data.inspection?.mapOfMedition);

  await addInspectionDataToPDF(
    pageMapMedition,
    pdfDoc,
    data,
    50,
    690,
    helveticaFont,
    helveticaBoldFont,
    imagensDeMedicaoOtimizadas,
    clientData,
    headerAssets,
  );

  // ===================== SEÇÃO 6 - RECOMENDAÇÕES =====================
  const pageRecommendations = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, pageRecommendations, clientData, headerAssets);

  pageRecommendations.drawText("6. RECOMENDAÇÕES DA NORMA", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // Função para criar páginas de recomendações
  async function createRecommendationsPages(
    pdfDoc,
    page,
    startX,
    startY,
    projectJSON
  ) {
    const font = helveticaFont;
    const fontSize = 10;
    const colWidth = 500; // Largura total para a célula

    const splitTextIntoLines = (text, maxWidth) => {
      const words = text.split(" ");
      const lines = [];
      let currentLine = "";

      words.forEach((word) => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (textWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      });

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    const drawHeader = (x, y) => {
      const headerHeight = 20; // Altura do cabeçalho
      const headerText = "RECOMENDAÇÕES DA NORMA";
      const headerWidth = font.widthOfTextAtSize(headerText, fontSize); // Largura do texto
      const headerX = x + (colWidth - headerWidth) / 2;

      page.drawRectangle({
        x,
        y: y - 20,
        width: colWidth,
        height: 20,
        color: rgb(0.102, 0.204, 0.396),
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      page.drawText(headerText, {
        x: headerX,
        y: y - 15,
        size: fontSize,
        font,
        color: rgb(1, 1, 1),
      });
    };

    const drawRow = (x, y, label) => {
      const lines = splitTextIntoLines(cleanTextForPDF(label), colWidth - 10); // Margem interna de 5px em cada lado
      const requiredHeight = Math.max(lines.length * fontSize + 8, 20); // Altura é o número de linhas vezes o tamanho da fonte

      // Desenha o retângulo da célula, ajustado para colar na célula anterior
      page.drawRectangle({
        x,
        y: y - requiredHeight,
        width: colWidth,
        height: requiredHeight,
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      // Escreve o texto dentro da célula
      lines.forEach((line, index) => {
        const lineY = y - index * fontSize - 8; // Margem interna superior
        page.drawText(cleanTextForPDF(line), {
          x: x + 5,
          y: lineY - 2,
          size: fontSize,
          font,
        });
      });

      return requiredHeight; // Retorna a altura utilizada para ajustar a posição
    };

    const selectedNrDocumentationCases = JSON.parse(
      projectJSON.inspection?.selectedNrDocumentationCases || "[]"
    );
    const maxHeight = startY;
    let currentY = startY;

    // Desenha o cabeçalho na primeira página
    drawHeader(startX, currentY);
    currentY -= 20;

    for (let i = 0; i < selectedNrDocumentationCases.length; i++) {
      const { label } = selectedNrDocumentationCases[i];

      // Verifica se é necessário criar uma nova página
      if (currentY <= 80) {
        page = pdfDoc.addPage([595.28, 841.89]);
        countPages++;
        await addHeader(pdfDoc, page, clientData, headerAssets);
        currentY = maxHeight;

        // Desenha o cabeçalho da tabela na nova página
        drawHeader(startX, currentY);
        currentY -= 20;
      }

      // Adiciona a linha e calcula o espaço ocupado
      const usedHeight = drawRow(startX, currentY, label);
      currentY -= usedHeight; // Remove qualquer margem adicional
    }
    
    await addFooter(pdfDoc, page, data, countPages);
  }

  await createRecommendationsPages(pdfDoc, pageRecommendations, 50, 690, data);

  // ===================== PÁGINA FINAL - RESPONSABILIDADE TÉCNICA =====================
  const pageResponsibility = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, pageResponsibility, clientData, headerAssets);

  pageResponsibility.drawText("8. RESPONSABILIDADE TÉCNICA", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // Texto corrigido
  const responsibilityText = `
A empresa C&T Serviço Engenharia não se responsabiliza por interpretações ou julgamentos baseados em dados incompletos ou imprecisos.

Todos os materiais utilizados durante a fabricação e instalação devem seguir as normas técnicas vigentes.

Este relatório foi elaborado com base nas informações disponíveis no momento da inspeção e nas condições observadas durante o período de análise.
  `;

  await drawIndentedJustifiedText(
    pageResponsibility,
    responsibilityText.trim(),
    50,
    660,
    495.28,
    helveticaFont,
    12,
    4,
    18
  );

  await addFooter(pdfDoc, pageResponsibility, data, countPages);

  return pdfDoc;
}

// Handler principal para Vercel
async function generateBoilerPdf(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro 'projectId' é obrigatório.");
  }

  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(
      projectData.client || projectData.clientId
    );
    const engenieerData = await getEngenieerData(
      projectData.engenieer?.id || projectData.engenieerId || " "
    );
    const analystData = await getAnalystData(
      projectData.analyst?.id || projectData.analystId || " "
    );

    const pdfDoc = await generatePDF(
      projectData,
      clientData,
      engenieerData,
      analystData
    );

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF:", error.message);
    throw new Error("Erro ao gerar o PDF");
  }
}

// Exporta a função principal como módulo
module.exports = generateBoilerPdf;

