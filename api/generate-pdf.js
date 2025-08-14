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
    const footerTextEnd = `C&T.0.1 | ${formattedDate}\nPágina ${pageNumber}`;

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
    y: 320,
    size: 14,
    font: helveticaBoldFont,
  });
  page.drawText(`${data.numeroSerie || " "}`, {
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
      page.drawText(item.text, {
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
    const words = text.split(' ');
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
      
      page.drawText(line, {
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

  // ===================== CONTINUAÇÃO DAS PÁGINAS =====================
  // Aqui você pode continuar adicionando as outras páginas seguindo o mesmo padrão
  // com as correções aplicadas...

  // ===================== PÁGINA FINAL - RECOMENDAÇÕES =====================
  const pageRecommendations = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  await addHeader(pdfDoc, pageRecommendations, clientData, headerAssets);

  pageRecommendations.drawText("6. RECOMENDAÇÕES DA NORMA", {
    x: 50,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // Texto corrigido com melhor português
  const recommendationsText = `
A atenção com a caldeira deve ser redobrada nos períodos noturnos, pois nesses períodos ocorre a maioria dos acidentes graves com caldeiras.

Não deve ser permitida a presença de pessoas estranhas ao serviço na casa da caldeira, e muito menos operar a caldeira.

Em caso de qualquer anomalia, o inspetor deve ser alertado imediatamente.

Todos os procedimentos de segurança devem ser rigorosamente seguidos durante a fabricação e instalação dos equipamentos.
  `;

  await drawIndentedJustifiedText(
    pageRecommendations,
    recommendationsText.trim(),
    50,
    660,
    495.28,
    helveticaFont,
    12,
    4,
    18
  );

  await addFooter(pdfDoc, pageRecommendations, data, countPages);

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

module.exports = {
  generatePDF,
  getProjectData,
  getClientData,
  getEngenieerData,
  getAnalystData,
};

