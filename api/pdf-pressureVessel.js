const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("firebase-admin");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { font } = require("pdfkit");

if (!admin.apps.length) {
  const serviceAccount = require("../nr13-c33f2-firebase-adminsdk-y8x46-0d71dfb66e.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function baixarEComprimirTodasImagens(imageUrls) {
  return await Promise.all(
    imageUrls.map(async (url) => {
      try {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        const imageBytes = Buffer.from(response.data, "binary");

        // Reduz tamanho e qualidade pra melhorar performance
        const optimizedBuffer = await sharp(imageBytes)
          .resize({ width: 400 }) // ou 300, ajustável
          .jpeg({ quality: 40 })
          .toBuffer();

        return {
          url,
          buffer: optimizedBuffer,
        };
      } catch (error) {
        console.error("Erro ao baixar/comprimir imagem:", url, error.message);
        return null;
      }
    })
  );
}

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

const sharp = require("sharp");

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
    const optimizedImageBuffer = await sharp(imageBytes)
      .resize(400) // Redimensiona para largura máxima de 800px (ajuste conforme necessário)
      .jpeg({ quality: 30 })
      .png({ quality: 30 })
      .toBuffer();

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
  // Resetar contador de páginas a cada geração
  let countPages = 0;
  
  const pdfDoc = await PDFDocument.create();

  // NOVO: Objeto para rastrear páginas reais
  const pageRefs = {};

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

  console.log("Começando pagina 1")
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

  // MODIFICADO: addFooter agora aceita totalPages
  async function addFooter(pdfDoc, page, data, pageNumber = null, totalPages = null, skipFooter = false) {
    // Se skipFooter for true, não adicionar rodapé (usado durante criação inicial das páginas)
    if (skipFooter) {
      return;
    }
    
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pageWidth = page.getWidth(); // Obtém a largura da página
    const formattedDate = data.inspection.endDate ? formatDate(data.inspection.endDate) : "N/A";

    // Se pageNumber não foi fornecido, calcular automaticamente baseado na posição da página
    if (pageNumber === null) {
      const pages = [];
      for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        pages.push(pdfDoc.getPage(i));
      }
      const currentPageIndex = pages.indexOf(page);
      
      // TODAS as páginas têm numeração sequencial (1, 2, 3, 4...)
      pageNumber = currentPageIndex + 1;
    }

    // Se totalPages não foi fornecido, usar o total atual
    if (totalPages === null) {
      totalPages = pdfDoc.getPageCount();
    }

    const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto}`;
    const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
    
    // MODIFICADO: Incluir total de páginas
    const footerTextEnd = `C&T.0.1 | ${data.inspection.endDate}\nPágina ${pageNumber} de ${totalPages}`;

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

  page.drawText(`Relatório de Inspeção Vaso de Pressão`, {
    x: 70,
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

  console.log("Concluindo pagina 1")
  await addFooter(pdfDoc, page, data);

  console.log("Começando pagina 2")
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.informacoesGerais = pdfDoc.getPageCount();
  let upTo14 = pageRefs.informacoesGerais;

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
      ` Cleonis Batista Santos \n
        Rua Laudemiro José Bueno, Centro, 192 \n
        CEP: 75901130 \n
        CNPJ: 28992646000111 \n
        CREA: 24625/ D-GO \n
        TEL.: 64992442480 \n
        E-mail: cleonis@engenhariact.com.br`,
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

  console.log("Concluindo pagina 2")
  await addFooter(pdfDoc, page2, data);

  console.log("Começando pagina 3")
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.dadosEquipamento = pdfDoc.getPageCount();
  let upTo15 = pageRefs.dadosEquipamento;

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
    ["TIPO DA CATEGORIA", `${data.tipoCaldeira || " "}`],
    ["FABRICANTE", `${data.fabricante}`],
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

  console.log("Concluindo pagina 3")
  await addFooter(pdfDoc, page3, data);

  console.log("Começando pagina 4")
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.categorizacao = pdfDoc.getPageCount();
  let upTo18 = pageRefs.categorizacao;

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
    ["CATEGORIA", `${data.categoria || " "}`],
    ["CLASSE DE FLUIDO", `${data.classeFluido || " "}`],
    ["GRUPO DE POTENCIAL DE RISCO", `${data.grupoPotencialRisco || " "}`],
  ];

  async function drawTableCategorization({
    page4,
    startX,
    startY,
    columnWidthsCategorization,
    rowHeightDrawCategorization,
    tableDataCategorization,
    helveticaFont,
    helveticaBoldFont,
  }) {
    const headerHeight = 20;
    page4.drawRectangle({
      x: startX,
      y: startY,
      width: 495.5,
      height: headerHeight,
      color: rgb(0.102, 0.204, 0.396),
    });

    page4.drawText("CATEGORIZAÇÃO", {
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

  await drawTableCategorization({
    page4,
    startX: 50,
    startY: 650,
    columnWidthsCategorization,
    rowHeightDrawCategorization,
    tableDataCategorization,
    helveticaFont,
    helveticaBoldFont,
  });

  page4.drawText("1.7 PESSOAS QUE ACOMPANHARAM", {
    x: 50,
    y: 580,
    size: 16,
    font: helveticaBoldFont,
  });

  const tableDataPeopleWhoAccompanied = [
    ["NOME", "FUNÇÃO", "EMPRESA"],
    [
      `${data.inspection?.peopleWhoAccompanied?.name || " "}`,
      `${data.inspection?.peopleWhoAccompanied?.role || " "}`,
      `${data.inspection?.peopleWhoAccompanied?.company || " "}`,
    ],
  ];

  let columnWidthsDrawTablePeopleWhoAccompanied = [165.28, 165.28, 165.28];
  async function drawTablePeopleWhoAccompanied(
    page,
    pdfDoc,
    startX,
    startY,
    columnWidthsDrawTablePeopleWhoAccompanied,
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
        columnWidthsDrawTablePeopleWhoAccompanied
          .slice(0, columnIndex)
          .reduce((a, b) => a + b, 0);
      page.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidthsDrawTablePeopleWhoAccompanied[columnIndex],
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
          columnWidthsDrawTablePeopleWhoAccompanied
            .slice(0, columnIndex)
            .reduce((a, b) => a + b, 0);
        page.drawRectangle({
          x,
          y: currentY,
          width: columnWidthsDrawTablePeopleWhoAccompanied[columnIndex],
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

  await drawTablePeopleWhoAccompanied(
    page4,
    pdfDoc,
    50,
    565,
    columnWidthsDrawTablePeopleWhoAccompanied,
    rowHeight,
    tableDataPeopleWhoAccompanied,
    helveticaFont,
    helveticaBoldFont
  );

  console.log("Concluindo pagina 4")
  await addFooter(pdfDoc, page4, data);

  console.log("Começando pagina 5")
  const page5 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.documentacaoExistente = pdfDoc.getPageCount();
  let upTo19 = pageRefs.documentacaoExistente;

  await addHeader(pdfDoc, page5, clientData, headerAssets);

  page5.drawText("1.8 DOCUMENTAÇÃO EXISTENTE", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Função para verificar se há dados do corpo do equipamento
  function hasEquipmentBodyData(data) {
    return data.inspection && data.inspection.equipmentBodyData && 
           Object.keys(data.inspection.equipmentBodyData).length > 0;
  }

  // Função para criar tabela paginada
  async function drawPaginatedTable(
    pdfDoc,
    startPage,
    startX,
    startY,
    columnWidths,
    tableData,
    helveticaFont,
    helveticaBoldFont,
    clientData,
    headerAssets
  ) {
    const headerRowHeight = 20;
    const dataRowHeight = 20;
    const maxRowsPerPage = 25; // Número máximo de linhas por página
    let currentPage = startPage;
    let currentY = startY;
    let rowIndex = 0;

    // Desenhar cabeçalho da tabela
    const header = tableData[0];
    header.forEach((cell, columnIndex) => {
      const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
      currentPage.drawRectangle({
        x,
        y: currentY - headerRowHeight,
        width: columnWidths[columnIndex],
        height: headerRowHeight,
        color: rgb(0.102, 0.204, 0.396),
        borderColor: rgb(0.102, 0.204, 0.396),
        borderWidth: 1,
      });
      currentPage.drawText(cell, {
        x: x + 5,
        y: currentY - headerRowHeight / 2 - 5,
        size: 10,
        font: helveticaBoldFont,
        color: rgb(1, 1, 1),
      });
    });

    currentY -= headerRowHeight;

    // Desenhar dados da tabela
    for (let i = 1; i < tableData.length; i++) {
      const row = tableData[i];

      // Verificar se precisa de nova página
      if (rowIndex >= maxRowsPerPage) {
        // Criar nova página
        currentPage = pdfDoc.addPage([595.28, 841.89]);
        await addHeader(pdfDoc, currentPage, clientData, headerAssets);
        currentY = 650; // Reset Y position
        rowIndex = 0;

        // Redesenhar cabeçalho na nova página
        header.forEach((cell, columnIndex) => {
          const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
          currentPage.drawRectangle({
            x,
            y: currentY - headerRowHeight,
            width: columnWidths[columnIndex],
            height: headerRowHeight,
            color: rgb(0.102, 0.204, 0.396),
            borderColor: rgb(0.102, 0.204, 0.396),
            borderWidth: 1,
          });
          currentPage.drawText(cell, {
            x: x + 5,
            y: currentY - headerRowHeight / 2 - 5,
            size: 10,
            font: helveticaBoldFont,
            color: rgb(1, 1, 1),
          });
        });
        currentY -= headerRowHeight;
      }

      // Desenhar linha de dados
      row.forEach((cell, columnIndex) => {
        const x = startX + columnWidths.slice(0, columnIndex).reduce((a, b) => a + b, 0);
        currentPage.drawRectangle({
          x,
          y: currentY - dataRowHeight,
          width: columnWidths[columnIndex],
          height: dataRowHeight,
          borderColor: rgb(0.102, 0.204, 0.396),
          borderWidth: 1,
        });
        currentPage.drawText(cell, {
          x: x + 5,
          y: currentY - dataRowHeight / 2 - 5,
          size: 9,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
      });

      currentY -= dataRowHeight;
      rowIndex++;
    }

    return currentPage;
  }

  const tableDataExistingDocumentation = [
    ["DOCUMENTO", "DISPONÍVEL", "OBSERVAÇÕES"],
    ["Projeto de Fabricação", "Não", ""],
    ["Memorial de Cálculo", "Não", ""],
    ["Procedimento de Soldagem", "Não", ""],
    ["Procedimento de Tratamento Térmico", "Não", ""],
    ["Relatório de Ensaios Não Destrutivos", "Não", ""],
    ["Relatório de Teste Hidrostático", "Não", ""],
    ["Certificado de Materiais", "Não", ""],
    ["Relatório de Inspeção de Fabricação", "Não", ""],
    ["Registro de Segurança", "Sim", ""],
    ["Projeto de Instalação", "Não", ""],
    ["Projeto de Alteração ou Reparo", "Não", ""],
    ["Relatórios de Inspeções Anteriores", "Não", ""],
    ["Livro de Ocorrências", "Não", ""],
    ["Manual de Operação", "Não", ""],
    ["Certificado de Inspeção de Segurança", "Não", ""],
    ["Relatório de Análise de Integridade Estrutural", "Não", ""],
    ["Plano de Inspeção", "Não", ""],
    ["Outros", "Não", ""],
  ];

  const columnWidthsExistingDocumentation = [300, 100, 95.28];

  await drawPaginatedTable(
    pdfDoc,
    page5,
    50,
    695,
    columnWidthsExistingDocumentation,
    tableDataExistingDocumentation,
    helveticaFont,
    helveticaBoldFont,
    clientData,
    headerAssets
  );

  console.log("Concluindo pagina 5")
  await addFooter(pdfDoc, page5, data);

  console.log("Começando pagina 7")
  const page7 = pdfDoc.addPage([595.28, 841.89]);

  // NOVO: Registrar página real
  pageRefs.definicaoNormas = pdfDoc.getPageCount();
  let upTo4 = pageRefs.definicaoNormas;

  await addHeader(pdfDoc, page7, clientData, headerAssets);

  page7.drawText("2. DEFINIÇÃO", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  page7.drawText(
    "Vaso de pressão é um equipamento que contém fluidos sob pressão interna ou externa, diferente da atmosférica.",
    {
      x: 50,
      y: 690,
      size: 12,
      font: helveticaFont,
      maxWidth: 495.28,
    }
  );

  page7.drawText("3. OBJETIVO", {
    x: 50,
    y: 650,
    size: 16,
    font: helveticaBoldFont,
  });

  page7.drawText(
    "Este relatório tem por objetivo apresentar os resultados da inspeção de segurança realizada no vaso de pressão, conforme estabelecido na NR-13.",
    {
      x: 50,
      y: 630,
      size: 12,
      font: helveticaFont,
      maxWidth: 495.28,
    }
  );

  page7.drawText("4. NORMAS", {
    x: 50,
    y: 590,
    size: 16,
    font: helveticaBoldFont,
  });

  page7.drawText(
    "• NR-13 - Caldeiras, Vasos de Pressão e Tubulações\n• ASME Boiler and Pressure Vessel Code\n• NBR 13177 - Inspeção de Vasos de Pressão",
    {
      x: 50,
      y: 570,
      size: 12,
      font: helveticaFont,
      maxWidth: 495.28,
      lineHeight: 15,
    }
  );

  console.log("Concluindo pagina 7")
  await addFooter(pdfDoc, page7, data);

  // NOVO: Registrar página real para caracterização
  pageRefs.caracterizacao = pdfDoc.getPageCount() + 1;
  let upTo51 = pageRefs.caracterizacao;

  await generateDevicesPDF(pdfDoc, data.inspection.devicesData);

  const page9 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.mapaMedicao = pdfDoc.getPageCount();
  let upTo52 = pageRefs.mapaMedicao;

  await addHeader(pdfDoc, page9, clientData, headerAssets);

  page9.drawText("5.2 MAPA DE MEDIÇÃO", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Adicionar conteúdo do mapa de medição aqui...

  console.log("Concluindo pagina 9")
  await addFooter(pdfDoc, page9, data);

  let upTo53 = null;
  if (hasEquipmentBodyData(data)) {
    const page10 = pdfDoc.addPage([595.28, 841.89]);
    countPages++;

    // NOVO: Registrar página real
    pageRefs.corpoEquipamento = pdfDoc.getPageCount();
    upTo53 = pageRefs.corpoEquipamento;

    await addHeader(pdfDoc, page10, clientData, headerAssets);

    page10.drawText("5.3 CORPO DO EQUIPAMENTO", {
      x: 50,
      y: 710,
      size: 16,
      font: helveticaBoldFont,
    });

    // Adicionar conteúdo do corpo do equipamento aqui...

    console.log("Concluindo pagina 10")
    await addFooter(pdfDoc, page10, data);
  } else {
    console.log("Página 5.3 não criada por falta de dados do corpo do equipamento")
  }

  const page12 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.recomendacoes = pdfDoc.getPageCount();
  let upTo54 = pageRefs.recomendacoes;

  await addHeader(pdfDoc, page12, clientData, headerAssets);

  const sectionNumber = hasEquipmentBodyData(data) ? "5.4" : "5.3";
  page12.drawText(`${sectionNumber} RECOMENDAÇÕES`, {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Adicionar conteúdo das recomendações aqui...

  console.log("Concluindo pagina 12")
  await addFooter(pdfDoc, page12, data);

  const pagePLH = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, pagePLH, clientData, headerAssets);

  // Adicionar conteúdo da página PLH aqui...

  console.log("Concluindo pagina PLH")
  await addFooter(pdfDoc, pagePLH, data);

  const page13 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.registrosFotograficos = pdfDoc.getPageCount();
  let upTo55 = pageRefs.registrosFotograficos;

  await addHeader(pdfDoc, page13, clientData, headerAssets);

  const sectionNumberPhoto = hasEquipmentBodyData(data) ? "5.5" : "5.4";
  page13.drawText(`${sectionNumberPhoto} REGISTROS FOTOGRÁFICOS`, {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Adicionar conteúdo dos registros fotográficos aqui...

  console.log("Concluindo pagina 13")
  await addFooter(pdfDoc, page13, data);

  const page14 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.recomendacoesAdicionais = pdfDoc.getPageCount();
  let upTo6 = pageRefs.recomendacoesAdicionais;

  await addHeader(pdfDoc, page14, clientData, headerAssets);

  page14.drawText("6. RECOMENDAÇÕES ADICIONAIS", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Adicionar conteúdo das recomendações adicionais aqui...

  console.log("Concluindo pagina 14")
  await addFooter(pdfDoc, page14, data);

  const pageLimitationsOfReport = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.limitacoes = pdfDoc.getPageCount();
  let upTo7 = pageRefs.limitacoes;

  await addHeader(pdfDoc, pageLimitationsOfReport, clientData, headerAssets);

  pageLimitationsOfReport.drawText("7. LIMITAÇÕES DO RELATÓRIO", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Adicionar conteúdo das limitações aqui...

  console.log("Concluindo pagina de limitações")
  await addFooter(pdfDoc, pageLimitationsOfReport, data);

  const page15 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;

  // NOVO: Registrar página real
  pageRefs.conclusao = pdfDoc.getPageCount();
  let upTo8 = pageRefs.conclusao;

  await addHeader(pdfDoc, page15, clientData, headerAssets);

  page15.drawText("8. CONCLUSÃO", {
    x: 50,
    y: 710,
    size: 16,
    font: helveticaBoldFont,
  });

  // Adicionar conteúdo da conclusão aqui...

  console.log("Concluindo pagina 15")
  await addFooter(pdfDoc, page15, data);

  // SUMÁRIO CORRIGIDO - usando pageRefs em vez de upTo...
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
      page: pageRefs.caracterizacao + 1 // +1 porque o sumário será inserido antes
    });

    // 5.1 Dispositivos (sempre presente)
    sections.push({
      title: `5.${subSectionCount} DISPOSITIVOS`,
      page: pageRefs.caracterizacao + 1
    });
    subSectionCount++;

    // 5.2 Mapa de Medição (sempre presente)
    sections.push({
      title: `5.${subSectionCount} MAPA DE MEDIÇÃO`,
      page: pageRefs.mapaMedicao + 1
    });
    subSectionCount++;

    // 5.3 Corpo do Equipamento (condicional)
    if (hasEquipmentBodyData(data)) {
      sections.push({
        title: `5.${subSectionCount} CORPO DO EQUIPAMENTO`,
        page: pageRefs.corpoEquipamento + 1
      });
      subSectionCount++;
    }

    // 5.4 Recomendações (sempre presente)
    sections.push({
      title: `5.${subSectionCount} RECOMENDAÇÕES`,
      page: pageRefs.recomendacoes + 1
    });
    subSectionCount++;

    // 5.5 Registros Fotográficos (sempre presente)
    sections.push({
      title: `5.${subSectionCount} REGISTROS FOTOGRÁFICOS`,
      page: pageRefs.registrosFotograficos + 1
    });

    return sections;
  }

  // CORRIGIDO: usar pageRefs + 1 (por causa do sumário que será inserido)
  const tocItems = [
    { title: "1. INFORMAÇÕES GERAIS", page: pageRefs.informacoesGerais + 1 },
    { title: "1.1 DADOS CADASTRAIS", page: pageRefs.informacoesGerais + 1 },
    { title: "1.2 RESPONSÁVEIS TÉCNICOS", page: pageRefs.informacoesGerais + 1 },
    { title: "1.3 CONTROLE DE REVISÃO", page: pageRefs.informacoesGerais + 1 },
    { title: "1.4 INSPEÇÕES CONTRATADAS", page: pageRefs.informacoesGerais + 1 },
    { title: "1.5 DADOS DO EQUIPAMENTO", page: pageRefs.dadosEquipamento + 1 },
    { title: "1.6 CATEGORIZAÇÃO", page: pageRefs.categorizacao + 1 },
    { title: "1.7 PESSOAS QUE ACOMPANHARAM", page: pageRefs.categorizacao + 1 },
    { title: "1.8 DOCUMENTAÇÃO EXISTENTE", page: pageRefs.documentacaoExistente + 1 },
    { title: "2 DEFINIÇÃO", page: pageRefs.definicaoNormas + 1 },
    { title: "3 OBJETIVO", page: pageRefs.definicaoNormas + 1 },
    { title: "4 NORMAS", page: pageRefs.definicaoNormas + 1 },
    ...generateDynamicSections(data),
    { title: "6. RECOMENDAÇÕES ADICIONAIS", page: pageRefs.recomendacoesAdicionais + 1 },
    { title: "7. LIMITAÇÕES DO RELATÓRIO", page: pageRefs.limitacoes + 1 },
    { title: "8. CONCLUSÃO", page: pageRefs.conclusao + 1 },
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

  // Inserir sumário na posição 1 (segunda página)
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

  // CORRIGIDO: Adicionar rodapés com total de páginas correto
  const finalTotalPages = pdfDoc.getPageCount();
  for (let i = 0; i < finalTotalPages; i++) {
    const page = pdfDoc.getPage(i);
    
    // Para páginas 3+ (índice 2+), limpar área da numeração antiga antes de redesenhar
    if (i >= 2) {
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pageWidth = page.getWidth();
      
      // Calcular posição da numeração para limpeza precisa
      const textWidthEnd = helveticaFont.widthOfTextAtSize("C&T.0.1 | " + data.inspection.endDate, 10);
      const xEnd = pageWidth - textWidthEnd - 50;
      
      // Limpar APENAS a área da numeração (quadrado pequeno e preciso)
      page.drawRectangle({
        x: xEnd - 5, // Margem pequena à esquerda
        y: 35, // Área específica da numeração
        width: textWidthEnd + 60, // Largura suficiente para cobrir "C&T.0.1 | data\nPágina X"
        height: 25, // Altura para cobrir 2 linhas da numeração
        color: rgb(1, 1, 1), // Branco para apagar
      });
    }
    
    // CORRIGIDO: Passar o total de páginas correto
    await addFooter(pdfDoc, page, data, i + 1, finalTotalPages); // Numeração sequencial 1, 2, 3...
  }

  console.log("Quantidade de paginas no pdf: ", countPages);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// Função generateDevicesPDF (placeholder - você precisa incluir a implementação completa)
async function generateDevicesPDF(pdfDoc, devicesData) {
  // Implementação da geração de dispositivos
  // Esta função deve criar as páginas necessárias para os dispositivos
  console.log("Gerando páginas de dispositivos...");
}

// Handler principal para Vercel
async function generatePressureVesselPdf(projectId) {
  if (!projectId) {
    throw new Error("O parâmetro 'projectId' é obrigatório.");
  }

  try {
    const projectData = await getProjectData(projectId);
    const clientData = await getClientData(
      projectData.client || projectData.clientId
    );
    const engenieerData = await getEngenieerData(
      projectData.engenieer?.id || projectData.engenieerId
    );
    const analystData = await getAnalystData(
      projectData.analyst?.id || projectData.analystId
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
module.exports = generatePressureVesselPdf;

