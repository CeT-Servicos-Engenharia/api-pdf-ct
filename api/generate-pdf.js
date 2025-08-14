const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

/* duplicate sharp require removed */

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
    const formattedDate = data.inspection.endDate ? formatDate(data.inspection.endDate) : "N/A";

    const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto}`;
    const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
    const footerTextEnd = `C&T.0.1 | ${data.inspection.endDate}\nPágina ${pageNumber}`;

    const drawMultilineText = (text, x, y, lineHeight) => {
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: x,
          y: y - index * lineHeight,
          size: 10,
          font: helveticaFont,
          color: rgb(0.5, 0.5, 0.5),
        });
      });
    };

    const textWidthMiddle = helveticaFont.widthOfTextAtSize("Cleonis Batista Santos", 10);
    const textWidthEnd = helveticaFont.widthOfTextAtSize("C&T.0.1 | " + data.inspection.endDate, 10);

    const xStart = 50;
    const xMiddle = (pageWidth - textWidthMiddle) / 3;
    const xEnd = pageWidth - textWidthEnd - 50;
    const baseY = 50;
    const lineHeight = 12;

    drawMultilineText(footerTextStart, xStart, baseY, lineHeight);
    drawMultilineText(footerTextMiddle, xMiddle, baseY, lineHeight);
    drawMultilineText(footerTextEnd, xEnd, baseY, lineHeight);
  }

  await addHeader(pdfDoc, page, clientData, headerAssets);

  page.drawText(`Relatório de Inspeção: ${data.tipoEquipamento}`, {
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
  page.drawText(`${data.nomeEquipamento || " "}`, {
    x: 208,
    y: 350,
    size: 14,
    font: helveticaFont,
  });
  page.drawText(`Número de série:`, {
    x: 50,
    y: 255,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${data.numeroSerie || " "}`, {
    x: 165,
    y: 255,
    size: 14,
    font: helveticaFont,
  });
  page.drawText(`Patrimônio/TAG: `, {
    x: 50,
    y: 290,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${data.numeroPatrimonio || " "}  ${data.tag || " "}`, {
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
  page.drawText(`${data.fabricante}`, {
    x: 128,
    y: 260,
    size: 14,
    font: helveticaFont,
  });

  page.drawText(`${clientData.person || " "}`, {
    x: 50,
    y: 200,
    size: 12,
    font: helveticaBoldFont,
  });
  page.drawText(`${clientData.address || " "} CEP: ${clientData.cep || " "}`, {
    x: 50,
    y: 185,
    size: 12,
    font: helveticaFont,
  });
  page.drawText(`CNPJ: ${clientData.cnpj || " "}`, {
    x: 50,
    y: 170,
    size: 12,
    font: helveticaFont,
  });
  page.drawText(`FONE: ${clientData.phone || " "}`, {
    x: 50,
    y: 155,
    size: 12,
    font: helveticaFont,
  });

  const formattedDate = data.endDate ? formatDate(data.endDate) : "N/A";

  await addFooter(pdfDoc, page, data, countPages);

  const page2 = pdfDoc.addPage([595.28, 841.89]);
  countPages = 3;

  let upTo14 = countPages;

  await addHeader(pdfDoc, page2, clientData, headerAssets);

  page2.drawText("1. INFORMAÇÕES GERAIS", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });
  page2.drawText("1.1 DADOS CADASTRAIS", {
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
      `  ${clientData.person || " "} \n
        ${clientData.address || " "}, ${clientData.neighborhood || " "}, ${clientData.number || " "
      } \n
        CEP: ${clientData.cep || " "} \n
        CNPJ: ${clientData.cnpj || " "} \n
        TEL.: ${clientData.phone || " "} \n
        E-mail: ${clientData.email || " "}`,
      ` ${engenieerData.name || " "} \n
        ${engenieerData.address || " "}, ${engenieerData.neighborhood || " "
      }, ${engenieerData.number || " "} \n
        CEP: ${engenieerData.cep || " "} \n
        CNPJ: ${engenieerData.cnpj || " "} \n
        CREA: ${engenieerData.crea || " "} \n
        TEL.: ${engenieerData.phone || " "} \n
        E-mail: ${engenieerData.email || " "}`,
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
      page.drawText(cell, {
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
      currentY -= dynamicRowHeight; // Pular para a próxima linha da tabela
    });
  }

  await drawTableRegistrationData(
    page2,
    pdfDoc,
    50,
    650,
    columnWidths,
    rowHeight,
    tableDataRegistrationData,
    helveticaFont,
    helveticaBoldFont
  );

  page2.drawText("1.2 RESPONSÁVEIS TÉCNICOS", {
    x: 50,
    y: 510,
    size: 16,
    font: helveticaBoldFont,
  });

  const tableDataTechnicalManagers = [
    ["ANALISTA", "ENGENHEIRO"], // Cabeçalho
    [
      `  ${analystData.name || " "} \n
        E-mail: ${analystData.email || "N/C"}`,
      ` ${engenieerData.name || " "} \n
        CREA: ${engenieerData.crea || " "} \n`,
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
      page.drawText(cell, {
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
      currentY -= dataRowHeight; // Pular para a próxima linha da tabela
    });
  }

  await drawTableTechnicalManagers(
    page2,
    pdfDoc,
    50,
    495,
    columnWidths,
    rowHeight,
    tableDataTechnicalManagers,
    helveticaFont,
    helveticaBoldFont
  );

  page2.drawText("1.3 CONTROLE DE REVISÃO", {
    x: 50,
    y: 415,
    size: 16,
    font: helveticaBoldFont,
  });

  const tableDataRevisionControl = [
    ["REVISÃO", "DESCRIÇÃO", "RESPONSÁVEL", "DATA"],
    [
      `${data.numeroProjeto || " "}`,
      `${data.descricaoRevisao || " "}`,
      `${analystData.name || " "}`,
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
      page.drawText(cell, {
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
      currentY -= dataRowHeight; // Pular para a próxima linha da tabela
    });
  }

  await drawTableRevisionControl(
    page2,
    pdfDoc,
    50,
    400,
    columnWidthsDrawTableRevisionControl,
    rowHeight,
    tableDataRevisionControl,
    helveticaFont,
    helveticaBoldFont
  );

  page2.drawText("1.4 INSPEÇÕES CONTRATADAS", {
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
        data.inspection.selectedTypesInspection?.inicial ? "Inicial" : null,
        data.inspection.selectedTypesInspection?.periodica ? "Periódica" : null,
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
      page.drawText(cell, {
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

  await drawTableContractedInspections(
    page2,
    pdfDoc,
    50,
    315,
    columnWidthsDrawTableContractedInspections,
    rowHeight,
    tableDataContractedInspections,
    helveticaFont,
    helveticaBoldFont
  );

  console.log("Renderizando page 3...");

  console.log("Imagens gerais: ", data.images);

  await addFooter(pdfDoc, page2, data, countPages);

  const page3 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo15 = countPages;

  await addHeader(pdfDoc, page3, clientData, headerAssets);

  page3.drawText("1.5 DADOS DO EQUIPAMENTO", {
    x: 50,
    y: 720,
    size: 16,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  async function drawImageGrid({
    page3,
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
    page3.drawRectangle({
      x: startX,
      y: startY - 30,
      width: 495.28,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page3.drawText(headerText, {
      x: startX + columnWidth,
      y: startY - 22,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });

    // Coordenadas iniciais para imagens
    let currentX = startX;
    let currentY = startY - headerHeight - padding;

    for (let i = 0; i < images.length; i++) {
      const imageObj = images[i];

      if (!imageObj || !imageObj.buffer) {
        console.warn(`Imagem inválida no índice ${i}`);
        continue;
      }

      try {
        const pdfImage = await pdfDoc.embedJpg(imageObj.buffer); // já comprimido em jpeg

        const imageWidth = columnWidth;
        const aspectRatio = pdfImage.height / pdfImage.width;
        const scaledHeight = imageWidth * aspectRatio;

        page3.drawImage(pdfImage, {
          x: currentX,
          y: currentY - 155,
          width: imageWidth,
          height: 150,
        });

        page3.drawText(captions[i], {
          x: currentX + 60,
          y: currentY - imageWidth - 5,
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

  const imagensGerais = await baixarEComprimirTodasImagens(data.images);

  await drawImageGrid({
    page3,
    pdfDoc,
    startX: 50,
    startY: 718,
    columnWidth: 161.5,
    rowHeight: 185,
    images: imagensGerais,
    captions: ["Geral", "Traseira", "Direita", "Esquerda", "Frontal", "Placa"],
    helveticaFont: helveticaFont,
    helveticaBoldFont: helveticaBoldFont,
  });

  const columnWidthsDrawGeralDatas = [350, 145.28];
  const rowHeightDrawGeralDatas = 20;

  const tableDataGeralDatas = [
    ["TIPO", `${data.tipoEquipamento || " "}`],
    ["TIPO DA CALDEIRA", `${data.tipoCaldeira || " "}`],
    ["NÚMERO DE SÉRIE", `${data.numeroSerie || " "}`],
    ["ANO DE FABRICAÇÃO", `${data.anoFabricacao || " "}`],
    [
      "PRESSÃO MÁXIMA DE TRABALHO ADMISSÍVEL (PMTA)",
      `${data.pressaoMaxima || " "} ${data.unidadePressaoMaxima || " "}`,
    ],
    [
      "PRESSÃO DE TESTE HIDROSTÁTICO DE FABRICAÇÃO (PTHF)",
      `${data.pressaoTeste} ${data.unidadePressaoMaxima || " "}`,
    ],
    [
      "CAPACIDADE DE PRODUÇÃO DE VAPOR (CPV)",
      `${data.capacidadeProducaoVapor || " "}`,
    ],
    [
      "ÁREA DA SUPERFÍCIE DE AQUECIMENTO (ASA)",
      `${data.areaSuperficieAquecimento || " "}`,
    ],
    [
      "CÓDIGO DO PROJETO / ANO DE EDIÇÃO",
      `${data.codProjeto || " "} / ${data.anoEdicao || " "}`,
    ],
    ["LOCAL DE INSTALAÇÃO", `${data.localInstalacao || " "}`],
  ];

  async function drawTableGeralDatas({
    page3,
    startX,
    startY,
    columnWidthsDrawGeralDatas,
    rowHeightDrawGeralDatas,
    tableDataGeralDatas,
    helveticaFont,
    helveticaBoldFont,
  }) {
    const headerHeight = 20;
    page3.drawRectangle({
      x: startX,
      y: startY,
      width: 495.5,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page3.drawText("DADOS GERAIS", {
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
        const cellText = row[j];
        const cellWidth = columnWidthsDrawGeralDatas[j];

        page3.drawRectangle({
          x: currentX,
          y: currentY,
          width: cellWidth,
          height: rowHeightDrawGeralDatas,
          borderWidth: 1,
          borderColor: rgb(0.102, 0.204, 0.396),
        });

        page3.drawText(cellText, {
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
    page3,
    startX: 50,
    startY: 300,
    columnWidthsDrawGeralDatas,
    rowHeightDrawGeralDatas,
    tableDataGeralDatas,
    helveticaFont,
    helveticaBoldFont,
  });

  await addFooter(pdfDoc, page3, data, countPages);

  const page4 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo18 = countPages;

  await addHeader(pdfDoc, page4, clientData, headerAssets);

  page4.drawText("1.6 CATEGORIZAÇÃO", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  const columnWidthsCategorization = [350, 145.28];
  const rowHeightDrawCategorization = 20;

  const tableDataCategorization = [
    ["TEMPERATURA DE PROJETO", `${data.temperaturaProjeto || " "} °C`],
    ["TEMPERATURA DE TRABALHO", `${data.temperaturaTrabalho || " "} °C`],
    ["VOLUME", `${data.volume || " "}`],
    ["CATEGORIA", `${data.categoriaCaldeira || " "}`],
  ];

  async function drawTableCategorization(
    page4,
    pdfDoc,
    startX,
    startY,
    columnWidthsCategorization,
    rowHeightDrawCategorization,
    tableDataCategorization,
    helveticaFont,
    helveticaBoldFont
  ) {
    const headerHeight = 20;
    page4.drawRectangle({
      x: startX,
      y: startY,
      width: 495.5,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page4.drawText("DADOS DE CATEGORIA", {
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
        const cellText = row[j];
        const cellWidth = columnWidthsCategorization[j];

        page4.drawRectangle({
          x: currentX,
          y: currentY,
          width: cellWidth,
          height: rowHeightDrawCategorization,
          borderWidth: 1,
          borderColor: rgb(0.102, 0.204, 0.396),
        });

        page4.drawText(cellText, {
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

  await drawTableCategorization(
    page4,
    pdfDoc,
    50,
    670,
    columnWidthsCategorization,
    rowHeightDrawCategorization,
    tableDataCategorization,
    helveticaFont,
    helveticaBoldFont
  );

  page4.drawText("1.7 DADOS DE OPERAÇÃO", {
    x: 50,
    y: 560,
    size: 16,
    font: helveticaBoldFont,
  });

  const columnWidthsOperationData = [350, 145.28];
  const rowHeightDrawOperationData = 20;

  const tableDataOperationData = [
    ["COMBUSTÍVEL PRINCIPAL", `${data.combustivelPrincipal || " "}`],
    ["COMBUSTÍVEL AUXILIAR", `${data.combustivelAuxiliar || " "}`],
    ["REGIME DE TRABALHO", `${data.regimeTrabalho || " "}`],
    ["TIPO DE OPRAÇÃO", `${data.tipoOperacao || " "}`],
  ];

  async function drawTableOperationData(
    page4,
    pdfDoc,
    startX,
    startY,
    columnWidthsOperationData,
    rowHeightDrawOperationData,
    tableDataOperationData,
    helveticaFont,
    helveticaBoldFont
  ) {
    const headerHeight = 20;
    page4.drawRectangle({
      x: startX,
      y: startY,
      width: 495.5,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page4.drawText("DADOS DE OPERAÇÃO", {
      x: startX + 180,
      y: startY + 6,
      size: 10,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });

    let currentY = startY - headerHeight;
    for (let i = 0; i < tableDataOperationData.length; i++) {
      const row = tableDataOperationData[i];
      let currentX = startX;

      for (let j = 0; j < row.length; j++) {
        const cellText = row[j];
        const cellWidth = columnWidthsOperationData[j];

        page4.drawRectangle({
          x: currentX,
          y: currentY,
          width: cellWidth,
          height: rowHeightDrawOperationData,
          borderWidth: 1,
          borderColor: rgb(0.102, 0.204, 0.396),
        });

        page4.drawText(cellText, {
          x: currentX + 5,
          y: currentY + 6,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });

        currentX += cellWidth;
      }
      currentY -= rowHeightDrawOperationData;
    }
  }

  await drawTableOperationData(
    page4,
    pdfDoc,
    50,
    522,
    columnWidthsOperationData,
    rowHeightDrawOperationData,
    tableDataOperationData,
    helveticaFont,
    helveticaBoldFont
  );

  page4.drawText("1.8 PESSOAS QUE ACOMPANHARAM", {
    x: 50,
    y: 415,
    size: 16,
    font: helveticaBoldFont,
  });
  page4.drawText(`${data.inspection.peopleWhoAccompanied}`, {
    x: 50,
    y: 385,
    size: 12,
    font: helveticaFont,
  });

  await addFooter(pdfDoc, page4, data, countPages);

  const page5 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo19 = countPages;

  await addHeader(pdfDoc, page5, clientData, headerAssets);

  page5.drawText("1.9 DOCUMENTAÇÃO EXISTENTE", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  const headers = ["ITEM", "DESCRIÇÃO", "SITUAÇÃO"];
  const tableData = Object.entries(data.inspection.checklistSelections).map(
    ([key, value], index) => [(index + 1).toString(), key, value]
  );

  async function drawPaginatedTable({
    pdfDoc,
    page5,
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
    countPages,
  }) {
    const pageHeight = page5.getHeight();
    const margin = 50;
    const availableHeight = pageHeight - startY - margin;

    let currentPage = page5;
    let currentY = startY;

    // Desenhar cabeçalho
    function drawHeader() {
      currentPage.drawRectangle({
        x: startX,
        y: currentY - rowHeight,
        width: columnWidths.reduce((sum, w) => sum + w, 0),
        height: rowHeight,
        color: rgb(0.102, 0.204, 0.396),
      });

      let currentX = startX;
      headers.forEach((header, index) => {
        currentPage.drawText(header, {
          x: currentX + 5,
          y: currentY - rowHeight + 5,
          size: 10,
          font: helveticaBoldFont,
          color: rgb(1, 1, 1),
        });
        currentX += columnWidths[index];
      });
      currentY -= rowHeight;
    }

    // Desenhar linha da tabela
    async function drawRow(row) {
      let currentX = startX;
      for (let index = 0; index < row.length; index++) {
        const cell = row[index];
        const cellWidth = columnWidths[index];

        // Caso o valor da célula precise de dados do Firebase
        const cellValue = typeof cell === "function" ? await cell() : cell;

        // Desenhar borda da célula
        currentPage.drawRectangle({
          x: currentX,
          y: currentY - rowHeight,
          width: cellWidth,
          height: rowHeight,
          borderWidth: 1,
          borderColor: rgb(0.102, 0.204, 0.396),
        });

        // Desenhar texto
        currentPage.drawText(cellValue, {
          x: currentX + 5,
          y: currentY - rowHeight + 5,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });

        currentX += cellWidth;
      }
      currentY -= rowHeight;
    }

    // Iniciar a tabela
    drawHeader();

    // Desenhar dados (iterar com await para processar células assíncronas)
    for (const row of tableData) {
      if (currentY - rowHeight < margin) {
        currentPage = pdfDoc.addPage();
        countPages++;
        console.log(
          "Dados do cliente antes de carregar o cabeçalho:",
          clientData
        );
        await addHeader(pdfDoc, currentPage, clientData, headerAssets); // Garantir que o cabeçalho também é assíncrono
        currentY = pageHeight - margin - 60;
        drawHeader();
      }
      await drawRow(row); // Usar await para garantir que células assíncronas sejam resolvidas
    }
    await addFooter(pdfDoc, currentPage, data, countPages);
  }

  await drawPaginatedTable({
    pdfDoc,
    page5,
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
    countPages,
  });

  await addFooter(pdfDoc, page5, data, countPages);
  countPages++;
  const page7 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo4 = countPages;

  await addHeader(pdfDoc, page7, clientData, headerAssets);

  page7.drawText("2. DEFINIÇÃO", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  await drawIndentedJustifiedText(
    page7,
    "Esta Norma Regulamentadora (NR-13) estabelece requisitos mínimos para gestão da integridade estrutural de caldeiras a vapor, vasos de pressão, suas tubulações de interligação e tanques metálicos de armazenamento nos aspectos relacionados à instalação, inspeção, operação e manutenção, visando à segurança e à saúde dos trabalhadores.",
    50, // posição x
    664, // posição y
    495.28, // largura máxima
    helveticaFont, // fonte
    12, // tamanho da fonte
    4,
    20 // espaçamento entre linhas (menor valor para reduzir o espaçamento)
  );

  page7.drawText("3. OBJETIVO", {
    x: 50,
    y: 577,
    size: 24,
    font: helveticaBoldFont,
  });

  // Uso da função
  await drawIndentedJustifiedText(
    page7,
    "Este relatório tem como objetivo registrar os resultados de uma inspeção em Caldeira sob a óticada NR-13 aprovada pela portaria n° 3.214, de 8 de junho de 1978, e Legislação Complementar pela Portaria SEPRT n° 1.846 de 1º de julho de 2022, - NR13 CALDEIRAS, VASOS DE PRESSÃO, TUBULAÇÕES E TANQUES METÁLICOS.",
    50, // posição x
    544, // posição y
    495.28, // largura máxima
    helveticaFont, // fonte
    12, // tamanho da fonte
    4,
    20 // espaçamento entre linhas (menor valor para reduzir o espaçamento)
  );

  page7.drawText("4. NORMAS", {
    x: 50,
    y: 460,
    size: 24,
    font: helveticaBoldFont,
  });
  page7.drawText("REFERÊNCIAS NORMATIVAS", {
    x: 50,
    y: 420,
    size: 24,
    font: helveticaBoldFont,
  });

  const startX = 50;
  const startY = 400;
  const columnWidthsReferencesNorms = [115.28, 380]; // Largura de cada coluna
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
  function wrapText(text, maxWidth, font, fontSize) {
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
      wrapText(
        cell,
        columnWidthsReferencesNorms[index] - 10,
        i === 0 ? helveticaBoldFont : helveticaFont,
        defaultFontSize
      )
    );
    rowHeight =
      Math.max(...cellLines.map((lines) => lines.length)) * lineHeight;

    // Desenha cada célula da linha
    for (let j = 0; j < row.length; j++) {
      const text = row[j];
      const cellWidth = columnWidthsReferencesNorms[j];
      const lines = cellLines[j];

      // Desenha o fundo da célula (apenas azul no cabeçalho, branco no restante)
      page7.drawRectangle({
        x: currentX,
        y: currentY - rowHeight,
        width: cellWidth,
        height: rowHeight,
        color: i === 0 ? rgb(0.102, 0.204, 0.396) : rgb(1, 1, 1), // Azul para o cabeçalho, branco para as outras linhas
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });

      // Desenha o texto na célula
      for (let k = 0; k < lines.length; k++) {
        page7.drawText(lines[k], {
          x: currentX + 5,
          y: currentY - 12 - k * lineHeight, // Alinha o texto verticalmente
          size: defaultFontSize,
          font: i === 0 ? helveticaBoldFont : helveticaFont,
          color: i === 0 ? rgb(1, 1, 1) : rgb(0, 0, 0), // Texto branco para cabeçalho, preto para o restante
        });
      }

      currentX += cellWidth;
    }

    currentY -= rowHeight; // Ajusta a posição Y para a próxima linha
  }

  await addFooter(pdfDoc, page7, data, countPages);

  let upTo51 = countPages + 1;

  async function generateDevicesPDF(pdfDoc, devicesData) {
    for (const [index, device] of Object.entries(devicesData || {})) {
      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const page8 = pdfDoc.addPage([pageWidth, pageHeight]);
      countPages++;

      await addHeader(pdfDoc, page8, clientData, headerAssets);

      page8.drawText("5. CARACTERIZAÇÃO", {
        x: 50,
        y: 700,
        size: 24,
        font: helveticaBoldFont,
      });
      page8.drawText("5.1 DISPOSITIVOS", {
        x: 50,
        y: 664,
        size: 16,
        font: helveticaBoldFont,
      });
      let cursorY = 640;

      const deviceType =
        device["Tipo de dispositivo"]?.toUpperCase() || "TIPO NÃO ESPECIFICADO";
      const headerHeight = 20;

      page8.drawRectangle({
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

      page8.drawText(deviceType, {
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

          page8.drawRectangle({
            x: 50,
            y: imageY - 5,
            width: 500,
            height: imageHeight + 10,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          await addFirebaseImageToPDF(pdfDoc, page8, imageUrl, {
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
          const text = `${key}: ${value || ""}`;
          const textHeight = 15;

          page8.drawRectangle({
            x: 50,
            y: cursorY - textHeight + 5,
            width: 500,
            height: textHeight,
            color: rgb(1, 1, 1), // Fundo branco
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          page8.drawText(text, {
            x: 55,
            y: cursorY - textHeight + 10,
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });

          cursorY -= textHeight;
        });
      await addFooter(pdfDoc, page8, data, countPages);
    }
  }

  // Gera o PDF para dispositivos
  await generateDevicesPDF(pdfDoc, data.inspection.devicesData);

  const page9 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo52 = countPages;

  await addHeader(pdfDoc, page9, clientData, headerAssets);

  page9.drawText("5.2 MAPA DE MEDIÇÃO", {
    x: 50,
    y: 700,
    size: 16,
    font: helveticaBoldFont,
  });

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


  async function addInspectionDataToPDF(
    page9,
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
      data.inspection.mapOfMedition || {}
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

      page9.drawRectangle({
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

      page9.drawText(sectionTitle, {
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
        page9.drawRectangle({
          x: startX,
          y: currentY - imageSize - 10,
          width: 500,
          height: imageSize + 10,
          color: rgb(1, 1, 1),
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        page9.drawImage(pdfImage, {
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
          page9.drawRectangle({
            x: startX,
            y: currentY - headerHeight,
            width: 500,
            height: headerHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          page9.drawText(`${subKey}:`, {
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

          page9.drawRectangle({
            x: startX,
            y: currentY - headerHeight,
            width: 500,
            height: headerHeight,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });

          page9.drawText(measuresText, {
            x: startX + 10,
            y: currentY - 15,
            size: 10,
            font,
            color: rgb(0, 0, 0),
          });

          currentY -= 20;

          addFooter(pdfDoc, page9, data, countPages);

          if (currentY < 340) {
            page9 = pdfDoc.addPage();
            countPages++;
            addHeader(pdfDoc, page9, clientData, headerAssets);
            page9.drawText("5.2 MAPA DE MEDIÇÃO", {
              x: 50,
              y: 700,
              size: 16,
              font: helveticaBoldFont,
            });
            currentY = startY;
          }
        });

      await addFooter(pdfDoc, page9, data, countPages);
    }

  }

  const imagensDeMedicaoOtimizadas = await prepararImagensDeMedicao(pdfDoc, data.inspection.mapOfMedition);

  await addInspectionDataToPDF(
    page9,
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

  function hasEquipmentBodyData(data) {
    // Verifica se existe dados do tampo superior
    const hasTampoSuperior = data.inspection.tampoSuperiorData && Object.values(data.inspection.tampoSuperiorData).some(value => value && value !== "N/A");

    // Verifica se existe dados do tampo inferior
    const hasTampoInferior = data.inspection.tampoInferiorData && Object.values(data.inspection.tampoInferiorData).some(value => value && value !== "N/A");

    // Verifica se existe dados do costado
    const hasCostado = data.inspection.costadoData && Object.values(data.inspection.costadoData).some(value => value && value !== "N/A");

    return hasTampoSuperior || hasTampoInferior || hasCostado;
  }

  let upTo53 = countPages;
  let upTo54 = countPages;
  let upTo55 = countPages;

  if (hasEquipmentBodyData(data)) {
    const page10 = pdfDoc.addPage([595.28, 841.89]);
    countPages++;

    upTo53 = countPages;

    await addHeader(pdfDoc, page10, clientData, headerAssets);

    page10.drawText("5.3 CORPO DO EQUIPAMENTO", {
      x: 50,
      y: 700,
      size: 16,
      font: helveticaBoldFont,
    });

    //header
    page10.drawRectangle({
      x: 50,
      y: 652,
      width: 495.28,
      height: 32,
      borderWidth: 1,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
    })

    page10.drawText("TAMPO \nESQUERDO",
      {
        x: 200,
        y: 670,
        font: helveticaBoldFont,
        size: 12,
        color: rgb(1, 1, 1),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawLine({
      start: { x: 195, y: 684 },
      end: { x: 195, y: 372 },
      thickness: 1,
      color: rgb(0.102, 0.204, 0.396),
      opacity: 1,
    });

    page10.drawText("COSTADO",
      {
        x: 330,
        y: 665,
        font: helveticaBoldFont,
        size: 12,
        color: rgb(1, 1, 1),
        lineHeight: 24,
        opacity: 0.75,
      },
    )

    page10.drawLine({
      start: { x: 325, y: 684 },
      end: { x: 325, y: 372 },
      thickness: 1,
      color: rgb(0.102, 0.204, 0.396),
      opacity: 1,
    });

    page10.drawText("TAMPO \nDIREITO",
      {
        x: 430,
        y: 670,
        font: helveticaBoldFont,
        size: 12,
        color: rgb(1, 1, 1),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawLine({
      start: { x: 425, y: 684 },
      end: { x: 425, y: 372 },
      thickness: 1,
      color: rgb(0.102, 0.204, 0.396),
      opacity: 1,
    });

    //content
    page10.drawRectangle({
      x: 50,
      y: 632,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })
    page10.drawText("TIPO",
      {
        x: 55,
        y: 638,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.tipo || "N/A"}`,
      {
        x: 200,
        y: 638,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.tipo || "N/A"}`,
      {
        x: 430,
        y: 638,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.tipo || "N/A"}`,
      {
        x: 330,
        y: 638,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 612,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("RAIO DA COROA (mm)",
      {
        x: 55,
        y: 618,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.raioCoroa || "N/A"}`,
      {
        x: 200,
        y: 618,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.raioCoroa || "N/A"}`,
      {
        x: 430,
        y: 618,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.raioCoroa || "N/A"}`,
      {
        x: 330,
        y: 618,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 592,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("RAIO DO REBORDEADO (mm)",
      {
        x: 55,
        y: 598,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.raioRebordeado || "N/A"}`,
      {
        x: 200,
        y: 598,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.raioRebordeado || "N/A"}`,
      {
        x: 330,
        y: 598,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.raioRebordeado || "N/A"}`,
      {
        x: 430,
        y: 598,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 572,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("RAZÃO (D/2h)",
      {
        x: 55,
        y: 578,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.razao || "N/A"}`,
      {
        x: 200,
        y: 578,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.razao || "N/A"}`,
      {
        x: 430,
        y: 578,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.razao || "N/A"}`,
      {
        x: 330,
        y: 578,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 552,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("SEMI-ÂNGULO DO VÉRTICE (°)",
      {
        x: 55,
        y: 558,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.anguloVertice || "N/A"}`,
      {
        x: 200,
        y: 558,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.anguloVertice || "N/A"}`,
      {
        x: 430,
        y: 558,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.anguloVertice || "N/A"}`,
      {
        x: 330,
        y: 558,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 532,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("LADO DA PRESSÃO",
      {
        x: 55,
        y: 538,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.ladoPressao || "N/A"}`,
      {
        x: 200,
        y: 538,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.ladoPressao || "N/A"}`,
      {
        x: 430,
        y: 538,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )
    page10.drawText(`${data.inspection.costadoData.ladoPressao || "N/A"}`,
      {
        x: 330,
        y: 538,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 512,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("DIÂMETRO INTERNO (mm)",
      {
        x: 55,
        y: 518,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.diametroInterno || "N/A"}`,
      {
        x: 200,
        y: 518,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.diametroInterno || "N/A"}`,
      {
        x: 430,
        y: 518,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )
    page10.drawText(`${data.inspection.costadoData.diametroInterno || "N/A"}`,
      {
        x: 330,
        y: 518,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 492,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("COMPRIMENTO (mm)",
      {
        x: 55,
        y: 498,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.comprimento || "N/A"}`,
      {
        x: 200,
        y: 498,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.comprimento || "N/A"}`,
      {
        x: 430,
        y: 498,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.comprimento || "N/A"}`,
      {
        x: 330,
        y: 498,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 472,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("MATERIAL",
      {
        x: 55,
        y: 478,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.material || "N/A"}`,
      {
        x: 195,
        y: 478,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.material || "N/A"}`,
      {
        x: 325,
        y: 478,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.material || "N/A"}`,
      {
        x: 425,
        y: 478,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 452,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("ESPESSURA NOMINAL (mm)",
      {
        x: 55,
        y: 458,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.espessuraNominal || "N/A"}`,
      {
        x: 200,
        y: 458,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.espessuraNominal || "N/A"}`,
      {
        x: 430,
        y: 458,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.espessuraNominal || "N/A"}`,
      {
        x: 330,
        y: 458,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 432,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("ESPESSURA REQUERIDA (mm)",
      {
        x: 55,
        y: 438,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.espessuraRequerida || "N/A"}`,
      {
        x: 200,
        y: 438,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.espessuraRequerida || "N/A"}`,
      {
        x: 430,
        y: 438,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.espessuraRequerida || "N/A"}`,
      {
        x: 330,
        y: 438,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 412,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("SOBREESPESSURA (mm)",
      {
        x: 55,
        y: 418,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.sobreespessura || "N/A"}`,
      {
        x: 200,
        y: 418,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.sobreespessura || "N/A"}`,
      {
        x: 430,
        y: 418,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.sobreespessura || "N/A"}`,
      {
        x: 330,
        y: 418,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 392,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("RADIOGRAFIA",
      {
        x: 55,
        y: 398,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.radiografia || "N/A"}`,
      {
        x: 200,
        y: 398,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.radiografia || "N/A"}`,
      {
        x: 430,
        y: 398,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.radiografia || "N/A"}`,
      {
        x: 330,
        y: 398,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawRectangle({
      x: 50,
      y: 372,
      width: 495.28,
      height: 20,
      borderWidth: 1,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.102, 0.204, 0.396),
      opacity: 0.5,
      borderOpacity: 0.75,
    })

    page10.drawText("EFICIÊNCIA DE JUNTA",
      {
        x: 55,
        y: 378,
        font: helveticaBoldFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      },
    )

    page10.drawText(`${data.inspection.tampoSuperiorData.eficienciaJunta || "N/A"}`,
      {
        x: 200,
        y: 378,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.tampoInferiorData.eficienciaJunta || "N/A"}`,
      {
        x: 430,
        y: 378,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    page10.drawText(`${data.inspection.costadoData.eficienciaJunta || "N/A"}`,
      {
        x: 330,
        y: 378,
        font: helveticaFont,
        size: 9,
        color: rgb(0, 0, 0),
        lineHeight: 14,
        opacity: 0.75,
      }
    )

    await addFooter(pdfDoc, page10, data, countPages);
  } else {
    console.log("Página 5.3 não criada por falta de dados do corpo do equipamento")
  }

  const page12 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  upTo54 = countPages;

  await addHeader(pdfDoc, page12, clientData, headerAssets);

  const sectionNumber = hasEquipmentBodyData(data) ? "5.4" : "5.3";
  page12.drawText(`${sectionNumber} RECOMENDAÇÕES`, {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

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
      const lines = splitTextIntoLines(label, colWidth - 10); // Margem interna de 5px em cada lado
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
        page.drawText(line, {
          x: x + 5,
          y: lineY - 2,
          size: fontSize,
          font,
        });
      });

      return requiredHeight; // Retorna a altura utilizada para ajustar a posição
    };

    const selectedNrDocumentationCases = JSON.parse(
      projectJSON.inspection.selectedNrDocumentationCases || "[]"
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
      await addFooter(pdfDoc, page, data, countPages);
    }
  }

  await createRecommendationsPages(pdfDoc, page12, 50, 690, data);

  const pagePLH = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, pagePLH, clientData, headerAssets);

  async function createRecommendationsPLHPages(
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
      const headerText = "RECOMENDAÇÕES DO PLH";
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
      const lines = splitTextIntoLines(label, colWidth - 10); // Margem interna de 5px em cada lado
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
        page.drawText(line, {
          x: x + 5,
          y: lineY - 2,
          size: fontSize,
          font,
        });
      });

      return requiredHeight; // Retorna a altura utilizada para ajustar a posição
    };

    const selectedNrPLHCases = JSON.parse(
      projectJSON.inspection.selectedRecommendationPLHCases || "[]"
    );
    const maxHeight = startY;
    let currentY = startY;

    // Desenha o cabeçalho na primeira página
    drawHeader(startX, currentY);
    currentY -= 20;

    for (let i = 0; i < selectedNrPLHCases.length; i++) {
      const { text } = selectedNrPLHCases[i];

      // Verifica se o label é válido
      const validLabel =
        typeof text === "string" && text.trim() !== ""
          ? text
          : "Texto não fornecido";

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
      const usedHeight = drawRow(startX, currentY, validLabel);
      currentY -= usedHeight; // Remove qualquer margem adicional
      await addFooter(pdfDoc, page, data, countPages);
    }
  }

  await createRecommendationsPLHPages(pdfDoc, pagePLH, 50, 710, data);

  const page13 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  upTo55 = countPages;

  await addHeader(pdfDoc, page13, clientData, headerAssets);

  const photoSectionNumber = hasEquipmentBodyData(data) ? "5.5" : "5.4";
  page13.drawText(`${photoSectionNumber} REGISTROS FOTOGRÁFICOS`, {
    x: 50,
    y: 700,
    size: 16,
    font: helveticaBoldFont,
  });

  async function drawImageGridRegisterPhotographics(
    page,
    pdfDoc,
    startX,
    startY,
    columnWidth,
    rowHeight,
    imagensOtimizadas, // agora são objetos { buffer, url }
    imagesWithCaptions,
    helveticaFont,
    helveticaBoldFont,
    clientData,
    data,
    countPagesRef // objeto com .value para atualizar o contador
  ) {
    const headerHeight = 20;
    const padding = 5;

    if (!Array.isArray(imagensOtimizadas) || imagensOtimizadas.length === 0) {
      console.error("O array 'imagensOtimizadas' está vazio ou é inválido.");
      return;
    }

    let currentX = startX;
    let currentY = startY - headerHeight - padding;
    let imageCount = 0;

    for (let i = 0; i < imagensOtimizadas.length; i++) {
      const imageObj = imagensOtimizadas[i];

      if (!imageObj || !imageObj.buffer) {
        console.warn(`Imagem inválida no índice ${i}`);
        continue;
      }

      try {
        const pdfImage = await pdfDoc.embedJpg(imageObj.buffer);

        page.drawImage(pdfImage, {
          x: currentX,
          y: currentY - 155,
          width: 190,
          height: 190,
        });

        const caption = imagesWithCaptions[i] || `Imagem ${i + 1}`;
        const textWidth = helveticaFont.widthOfTextAtSize(caption, 10);
        const xPosition = currentX + (190 - textWidth) / 2.5;

        page.drawText(caption, {
          x: xPosition,
          y: currentY - 165,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
      } catch (error) {
        console.error(`Erro ao desenhar imagem no índice ${i}: ${error.message}`);
      }

      currentX += columnWidth + padding;
      imageCount++;

      if ((i + 1) % 2 === 0) {
        currentX = startX;
        currentY -= rowHeight + 5;
      }

      if (imageCount === 6 && i < imagensOtimizadas.length - 1) {
        page = pdfDoc.addPage();
        await addHeader(pdfDoc, page, clientData, headerAssets);
        page.drawText("5.5 REGISTROS FOTOGRÁFICOS", {
          x: 50,
          y: 700,
          size: 16,
          font: helveticaBoldFont,
        });
        countPagesRef.value++;
        currentX = startX;
        currentY = startY - headerHeight - padding;
        imageCount = 0;
        addFooter(pdfDoc, page, data, countPagesRef.value);
      }
    }
  }


  const imagensOtimizadas = await baixarEComprimirTodasImagens(data.inspection.images);
  const imagensComLegenda = Array.isArray(data.inspection.imagesWithCaptions)
    ? data.inspection.imagesWithCaptions.map(img => img.caption)
    : [];

  const countPagesRef = { value: countPages }; // se estiver usando contador fora da função

  await drawImageGridRegisterPhotographics(
    page13,
    pdfDoc,
    50,
    670,
    250,
    200,
    imagensOtimizadas,
    imagensComLegenda,
    helveticaFont,
    helveticaBoldFont,
    clientData,
    data,
    countPagesRef
  );

  countPages = countPagesRef.value;


  await addFooter(pdfDoc, page13, data, (countPages - 2));

  const page14 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo6 = countPages;

  await addHeader(pdfDoc, page14, clientData, headerAssets);

  async function drawIndentedJustifiedText(
    page,
    text,
    x,
    y,
    maxWidth,
    font,
    fontSize,
    lineSpacing,
    indentSize
  ) {
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

        if (
          currentLineWidth +
          wordWidth +
          (currentLine.length > 0 ? spaceWidth : 0) <=
          effectiveMaxWidth
        ) {
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
        const line = lines[i];
        const isLastLine = i === lines.length - 1;
        const startX = line.isFirst ? x + indentSize : x;

        if (!isLastLine && line.words.length > 1) {
          // Justifica a linha
          const wordsWidth = line.words.reduce(
            (sum, word) => sum + font.widthOfTextAtSize(word, fontSize),
            0
          );
          const totalSpaces = line.words.length - 1;
          const totalSpaceWidth =
            maxWidth - wordsWidth - (line.isFirst ? indentSize : 0);
          const spaceWidth =
            totalSpaces > 0 && totalSpaceWidth > 0
              ? totalSpaceWidth / totalSpaces
              : font.widthOfTextAtSize(" ", fontSize);

          let currentX = startX;
          line.words.forEach((word, index) => {
            page.drawText(word, {
              x: currentX,
              y: currentY,
              size: fontSize,
              font: font,
            });
            if (index < line.words.length - 1) {
              currentX += font.widthOfTextAtSize(word, fontSize) + spaceWidth;
            }
          });
        } else {
          // Última linha ou linha de uma palavra: alinhada à esquerda
          page.drawText(line.words.join(" "), {
            x: startX,
            y: currentY,
            size: fontSize,
            font: font,
          });
        }
        currentY -= fontSize + lineSpacing;
      }
      // Espaço extra entre parágrafos
      currentY -= lineSpacing * 2;
    }
    return currentY;

  }

  page14.drawText("6. RECOMENDAÇÕES ADICIONAIS", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  page14.drawText("RECOMENDAÇÕES DE SEGURANÇA", {
    x: 50,
    y: 664,
    size: 16,
    font: helveticaBoldFont,
  });

  async function drawIndentedText(
    page,
    text,
    x,
    y,
    maxWidth,
    font,
    fontSize,
    lineSpacing,
    indentSize
  ) {
    const paragraphs = text.split("\n"); // Dividir o texto em parágrafos
    let currentY = y;

    for (const paragraph of paragraphs) {
      const words = paragraph.split(" ");
      let currentLine = "";
      let isFirstLine = true; // Marca a primeira linha do parágrafo

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (textWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          // Desenhar a linha quando o limite for atingido
          page.drawText(currentLine, {
            x: isFirstLine ? x + indentSize : x, // Adiciona o recuo apenas na primeira linha do parágrafo
            y: currentY,
            size: fontSize,
            font,
          });
          isFirstLine = false; // As próximas linhas não terão recuo
          currentY -= fontSize + lineSpacing;
          currentLine = word;
        }
      }

      if (currentLine) {
        page.drawText(currentLine, {
          x: isFirstLine ? x + indentSize : x,
          y: currentY,
          size: fontSize,
          font,
        });
        currentY -= fontSize + lineSpacing;
      }
    }
  }
  await drawIndentedJustifiedText(
    page14,
    "A caldeira não deve permanecer em operação sozinha, deve sempre ser acompanhada pelo operador credenciado, conforme preconiza a legislação vigente, Portaria do Ministério do trabalho 3214 NR-13 item 13.4.3.4. Este item é imprescindível, nenhuma responsabilidade cabe ao inspetor se este item não for realizado conforme preconiza a legislação.\nDeve ser dada descarga de fundo na caldeira, atendendo as recomendações de responsável pelo tratamento de água.",
    50, // Margem esquerda
    640, // Posição inicial no eixo Y
    480, // Largura máxima
    helveticaFont,
    12, // Tamanho da fonte
    4, // Espaçamento entre linhas
    20 // Tamanho do recuo na primeira linha do parágrafo
  );

  page14.drawText("RECOMENDAÇÕES COMPLEMENTARES", {
    x: 50,
    y: 510,
    size: 16,
    font: helveticaBoldFont,
  });

  await drawIndentedJustifiedText(
    page14,
    "Observar rigorosamente os marcadores de nível de água. Esta operação é muito importante, visto que aumenta a segurança da caldeira. Se não for possível detectar o nível de água no marcador, o visor deve ser substituído. Realizar a descarga do mesmo uma vez ao dia para ter certeza que a marcação é correta.\n Recomendo que as válvulas sejam testadas manualmente uma vez por mês no mínimo, para verificar seu pronto funcionamento. Deve ser anotada no livro de registro da caldeira, toda manutenção que for realizada nas válvulas e na caldeira.\n Não ultrapassar a Máxima Pressão de Trabalho Admissível (MPTA) da caldeira em hipótese alguma; caso isto venha ocorrer desligue a caldeira e comunique imediatamente sua chefia.\n Toda manutenção que for realizada em qualquer área de pressão do equipamento, deve ser feita por pessoa qualificada, e anotado no livro de registro.\n Não travar ou amarrar as válvulas de segurança, elas são a real segurança da caldeira.\n A caldeira só poderá ser operada por pessoa qualificada de acordo com a legislação vigente Portaria 3214 NR-13 de 08-06-78.\n Anotar sistematicamente no livro de segurança da caldeira toda manutenção, reparo, troca de peças, durante o turno de trabalho, todas essas devem ser assinadas pelo operador da caldeira credenciado.\nQualquer anomalia o inspetor deve ser alertado imediatamente.\nToda atenção com a caldeira deve ser REDOBRADA nos períodos NOTURNOS, pois nestes períodos ocorrem as maiorias dos acidentes graves com a caldeira.\nNão deve ser permitida a presença de pessoas estranhas ao serviço na casa da caldeira, e muito menos operar a caldeira.\nObservar constante o funcionamento do sistema Injetor de água da caldeira.",
    50, // Margem esquerda
    482, // Posição inicial no eixo Y
    470, // Largura máxima
    helveticaFont,
    12, // Tamanho da fonte
    4, // Espaçamento entre linhas
    20 // Tamanho do recuo na primeira linha do parágrafo
  );

  await addFooter(pdfDoc, page14, data, countPages);

  const pageLimitationsOfReport = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo7 = countPages;

  await addHeader(pdfDoc, pageLimitationsOfReport, clientData, headerAssets);

  pageLimitationsOfReport.drawText("7. LIMITAÇÕES DO RELATÓRIO", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  await drawIndentedJustifiedText(
    pageLimitationsOfReport,
    `Para garantir a precisão e consistência nesta análise de risco da máquina, é fundamental que as informações fornecidas sejam corretas e confiáveis. O(a) Cleonis Batista Santos não assume responsabilidade por interpretações ou julgamentos baseados em dados incompletos ou imprecisos.\n
    Este relatório refere-se exclusivamente à inspeção periódica realizada em ${data.inspection.startDate} e aos ensaios nela descritos. Qualquer modificação no objeto desta inspeção, bem como o cumprimento das recomendações, é de inteira responsabilidade do proprietário, isentando o profissional habilitado de qualquer responsabilização. \n
    Aspectos como erros humanos e mau uso devido a práticas inadequadas, alimentação incorreta do equipamento, uso inadequado de materiais e inexperiência dos operadores não estão cobertos por este relatório. Da mesma forma, não são considerados neste documento os riscos associados a agentes químicos, biológicos, ergonômicos, radiações ionizantes, combustíveis ou inflamáveis, superfícies aquecidas, sistemas de exaustão, vibrações, ruído e calor.\n
    Caso o equipamento passe por qualquer tipo de intervenção, tanto nas partes sob pressão quanto nos acessórios listados neste Relatório, seus prazos de inspeção deverão ser reavaliados. Nunca devem ser realizados reparos ou serviços de solda nas partes pressurizadas sem a consulta prévia a um profissional habilitado ou ao fabricante.\n
    O profissional habilitado não se responsabiliza pelo uso inadequado do prontuário, sendo que os dados deste se aplicam exclusivamente ao equipamento identificado pelo número de série, placa de identificação, código e data de fabricação. \n 
    Muitas das considerações aqui contidas são interpretações da regulamentação vigente. Apesar de todos os esforços para que as análises sejam o mais objetivas possível, algumas regulamentações podem exigir interpretações subjetivas por parte do profissional legalmente responsável por este documento. Portanto, eventuais divergências na interpretação desta regulamentação não devem ser vistas como omissão ou erro por parte do(a) Cleonis Batista Santos.`,
    50, // Margem esquerda
    640, // Posição inicial no eixo Y
    480, // Largura máxima
    helveticaFont,
    12, // Tamanho da fonte
    4, // Espaçamento entre linhas
    20 // Tamanho do recuo na primeira linha do parágrafo
  );

  await addFooter(pdfDoc, pageLimitationsOfReport, data, countPages);

  const page15 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  let upTo8 = countPages;

  await addHeader(pdfDoc, page15, clientData, headerAssets);

  page15.drawText("8. CONCLUSÃO", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  const yAfterConclusion = await drawIndentedJustifiedText(
    page15,
    data.inspection.conclusion || "Sem conclusão referente a esta inspeção",
    50,
    664,
    470,
    helveticaFont,
    12,
    4,
    20
  );

  const yAfterDisclaimer = yAfterConclusion;


  const resultInspection = data.inspection.selectedResultInspection && data.inspection.selectedResultInspection.approved;
  console.log(resultInspection)

  // Dimensões do retângulo
  const rectX = 50;
  const rectY = (yAfterDisclaimer || 540) - 60;
  const rectWidth = 495.28;
  const rectHeight = 40;

  // Texto dinâmico
  const text = resultInspection
    ? `${data.tipoEquipamento} está APROVADO para operação`
    : `${data.tipoEquipamento} está REPROVADO para operação`;

  const textWidth = helveticaFont.widthOfTextAtSize(text, 14);

  const textX = rectX + (rectWidth - textWidth) / 2;
  const textY = rectY + (rectHeight - 14) / 2 + 4;

  page15.drawRectangle({
    x: rectX,
    y: rectY,
    width: rectWidth,
    height: rectHeight,
    color: resultInspection ? rgb(0, 110 / 255, 0) : rgb(204 / 255, 0, 0), // Verde ou vermelho
  });

  page15.drawText(text, {
    x: textX,
    y: textY,
    size: 14,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  const tableDateNextInspection = [
    ["PRÓXIMA INSPEÇÃO", "PRAZO NORMA", "PRAZO PLH"],
    [
      ` ${data.inspection.DateNextInspectionDocummentation || " "}`,
      ` ${data.inspection.DateNextInspectionDocummentation || " "}`,
      ` ${data.inspection.DateNextInspectionPLHExternal || " "}`,
    ],
  ];

  const columnWidthsNextDate = [165, 165, 165]

  async function drawTableDateNextInspection(
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

    const header = data[0];
    header.forEach((cell, columnIndex) => {
      const x =
        startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidths[columnIndex],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396),
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      page.drawText(cell, {
        x: x + 10,
        y: currentY - headerRowHeight / 2 - 5,
        size: 12,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1),
      });
    });

    currentY -= headerRowHeight;
    const textPadding = 10;
    const lineHeight = 12;
    data.slice(1).forEach((row) => {
      row.forEach((cell, columnIndex) => {
        const x =
          startX +
          columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
        page.drawRectangle({
          x,
          y: currentY,
          width: columnWidths[columnIndex],
          height: dataRowHeight / -4,
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });

        const lines = cell.split("\n").map((line) => line.trim());
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

  await drawTableDateNextInspection(
    page15,
    pdfDoc,
    50,
    rectY - 50,
    columnWidthsNextDate,
    rowHeight,
    tableDateNextInspection,
    helveticaFont,
    helveticaBoldFont
  );

  const pageWidth = 595.28

  const imageWidth = 150;
  const imageHeight = 80;
  const imageX = (pageWidth - imageWidth) / 2;

  // Adiciona a assinatura
  if (engenieerData.signature) {
    try {
      const response = await axios.get(engenieerData.signature, { responseType: 'arraybuffer' });
      const imageBytes = response.data;

      // Verifica se é PNG (pelos bytes do cabeçalho)
      const isPng = imageBytes[0] === 0x89 &&
        imageBytes[1] === 0x50 &&
        imageBytes[2] === 0x4E &&
        imageBytes[3] === 0x47;

      const signatureImage = isPng
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);

      const imageWidth = 150;
      const imageHeight = 80;
      const imageX = (pageWidth - imageWidth) / 2;

      page15.drawImage(signatureImage, {
        x: imageX,
        y: 255,
        width: imageWidth,
        height: imageHeight,
        opacity: 1,
      });
    } catch (error) {
      console.error('Erro ao adicionar a assinatura:', error);
    }
  }
  else {
    console.log("Não há assinatura do engenheiro")
  }

  const lineStartX = pageWidth * 0.25;
  const lineEndX = pageWidth * 0.75;

  page15.drawLine({
    start: { x: lineStartX, y: 235 },
    end: { x: lineEndX, y: 236 },
    thickness: 1,
    color: rgb(0, 0, 0),
    opacity: 1,
  });

  const text1 = `Resp. Téc ${engenieerData.name || ""}`;
  const text1Width = helveticaFont.widthOfTextAtSize(text1, 12); // Largura do texto
  const text1X = (pageWidth - text1Width) / 2; // Centralizado
  page15.drawText(text1, {
    x: text1X,
    y: 228,
    size: 12,
    color: rgb(0, 0, 0),
    font: helveticaFont,
  });
  const text2 = `CREA ${engenieerData.crea || " "}`;
  const text2Width = helveticaFont.widthOfTextAtSize(text2, 12); // Largura do texto
  const text2X = (pageWidth - text2Width) / 2; // Centralizado
  page15.drawText(text2, {
    x: text2X,
    y: 215,
    size: 12,
    color: rgb(0, 0, 0),
    font: helveticaFont,
  });

  const text3 = "Engenheiro Mecânico";
  const text3Width = helveticaFont.widthOfTextAtSize(text3, 12); // Largura do texto
  const text3X = (pageWidth - text3Width) / 2; // Centralizado
  page15.drawText(text3, {
    x: text3X,
    y: 202,
    size: 12,
    color: rgb(0, 0, 0),
    font: helveticaFont,
  });

  await addFooter(pdfDoc, page15, data, countPages);

  const pageSumary = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, pageSumary, clientData, headerAssets);
  pageSumary.drawText("SUMÁRIO", {
    x: 240,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  const pageCount = pdfDoc.getPageCount();

  function generateDynamicSections(data) {
    let sections = [];
    let subSectionCount = 1;

    // Seção 5 principal
    sections.push({
      title: "5. CARACTERIZAÇÃO",
      page: Math.min(upTo51, pageCount)
    });

    // 5.1 Dispositivos (sempre presente)
    sections.push({
      title: `5.${subSectionCount} DISPOSITIVOS`,
      page: Math.min(upTo51, pageCount)
    });
    subSectionCount++;

    // 5.2 Mapa de Medição (sempre presente)
    sections.push({
      title: `5.${subSectionCount} MAPA DE MEDIÇÃO`,
      page: Math.min(upTo52, pageCount)
    });
    subSectionCount++;

    // 5.3 Corpo do Equipamento (condicional)
    if (hasEquipmentBodyData(data)) {
      sections.push({
        title: `5.${subSectionCount} CORPO DO EQUIPAMENTO`,
        page: Math.min(upTo53, pageCount)
      });
      subSectionCount++;
    }

    // 5.4 Recomendações (sempre presente)
    sections.push({
      title: `5.${subSectionCount} RECOMENDAÇÕES`,
      page: Math.min(upTo54, pageCount)
    });
    subSectionCount++;

    // 5.5 Registros Fotográficos (sempre presente)
    sections.push({
      title: `5.${subSectionCount} REGISTROS FOTOGRÁFICOS`,
      page: Math.min(upTo55, pageCount)
    });

    return sections;
  }

  const tocItems = [
    { title: "1. INFORMAÇÕES GERAIS", page: Math.min(upTo14, pageCount) },
    { title: "1.1 DADOS CADASTRAIS", page: Math.min(upTo14, pageCount) },
    { title: "1.2 RESPONSÁVEIS TÉCNICOS", page: Math.min(upTo14, pageCount) },
    { title: "1.3 CONTROLE DE REVISÃO", page: Math.min(upTo14, pageCount) },
    { title: "1.4 INSPEÇÕES CONTARTADAS", page: Math.min(upTo14, pageCount) },
    { title: "1.5 DADOS DO EQUIPAMENTO", page: Math.min(upTo15, pageCount) },
    { title: "1.6 CATEGORIZAÇÃO", page: Math.min(upTo18, pageCount) },
    { title: "1.7 PESSOAS QUE ACOMPANHARAM", page: Math.min(upTo18, pageCount) },
    { title: "1.8 DOCUMENTAÇÃO EXISTENTE", page: Math.min(upTo19, pageCount) },
    { title: "2 DEFINIÇÃO", page: Math.min(upTo4, pageCount) },
    { title: "3 OBJETIVO", page: Math.min(upTo4, pageCount) },
    { title: "4 NORMAS", page: Math.min(upTo4, pageCount) },
    { title: "5. CARACTERIZAÇÃO", page: Math.min(upTo51, pageCount) },
    ...generateDynamicSections(data),
    { title: "6. RECOMENDAÇÕES ADICIONAIS", page: Math.min(upTo6, pageCount) },
    { title: "7. LIMITAÇÕES DO RELATÓRIO", page: Math.min(upTo7, pageCount) },
    { title: "8. CONCLUSÃO", page: Math.min(upTo8, pageCount) },
  ];

  let yPosition = 660;
  const lineHeightSumary = 20;

  tocItems.forEach((item) => {
    const titleX = 50;
    const pageX = 500;

    pageSumary.drawText(`${item.title}`, {
      x: 50,
      y: yPosition,
      size: 12,
      font: helveticaFont,
    });

    const textWidth = helveticaFont.widthOfTextAtSize(item.title, 12);
    const dots = ".".repeat(
      Math.floor(
        (pageX - (titleX + textWidth)) /
        helveticaFont.widthOfTextAtSize(".", 12)
      )
    );

    pageSumary.drawText(dots, {
      x: titleX + textWidth + 5,
      y: yPosition,
      size: 12,
      font: helveticaFont,
    });

    pageSumary.drawText(`${item.page}`, {
      x: 500,
      y: yPosition,
      size: 12,
      font: helveticaFont,
    });

    yPosition -= lineHeightSumary;
  });

  const summaryIndex = 1;
  pdfDoc.insertPage(summaryIndex, pageSumary);

  // Adicione esta função de utilidade
  function validatePageCount(pdfDoc, countPages) {
    const actualPageCount = pdfDoc.getPageCount();
    if (countPages > actualPageCount) {
      countPages = actualPageCount;
    }
    return countPages;
  }

  // E use-a antes de operações críticas
  countPages = validatePageCount(pdfDoc, countPages);

  // Antes de remover a última página
  const totalPages = pdfDoc.getPageCount();
  if (totalPages > 1) { // Só remove se houver mais de uma página
    pdfDoc.removePage(totalPages - 1);
  }

  await addFooter(pdfDoc, pageSumary, data, 2);

  console.log("Quantidade de paginas no pdf: ", countPages);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
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

    const pdfBytes = await generatePDF(
      projectData,
      clientData,
      engenieerData,
      analystData
    );

    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF:", error.message);
    throw new Error("Erro ao gerar o PDF");
  }
}

// Exporta a função corrigida
module.exports = generateBoilerPdf;

