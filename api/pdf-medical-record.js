const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js"); // ✅ CORRIGIDO: Usa o inicializador central
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// O resto do seu código para pdf-medical-record.js permanece exatamente o mesmo...
// (addHeader, addFooter, generateMedicalRecordPDF, etc.)
// ...
// ... (cole o resto do seu código original aqui)
// ...

// No final do arquivo, a exportação já está correta:
module.exports = generateMedicalRecordPdf;

// Inicialização do Firebase
if (!admin.apps.length) {
  const serviceAccount = require("../nr13-c33f2-firebase-adminsdk-y8x46-0d71dfb66e.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
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

// Função para obter dados do projeto
async function getProjectData(projectId) {
  const db = admin.firestore();
  const doc = await db.collection("inspections").doc(projectId).get();
  if (!doc.exists) throw new Error("Projeto não encontrado");
  return doc.data();
}

// Função para obter dados do cliente
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

const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");

// Função para adicionar o cabeçalho ao PDF
async function addHeader(pdfDoc, page, clientData, assets) {
  try {
    const {
      logoEmpresaImage,
      helveticaFont,
      helveticaBoldFont,
    } = assets;

    if (logoEmpresaImage) {
      page.drawImage(logoEmpresaImage, {
        x: 60,
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
    console.error("Erro ao carregar o cabeçalho:", error.message);
  }
}

// Função para adicionar o rodapé ao PDF
async function addFooter(pdfDoc, page, data, pageNumber) {
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const footerTextStart = `ART:${data.artProjeto}`;
  const footerTextEnd = `C&T.0.1 | ${data.numeroProjeto || " "} | ${data.inspection.endDate}`;

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

  const textWidthEnd = helveticaFont.widthOfTextAtSize("C&T.0.1 | " + data.inspection.endDate, 10);

  const xStart = 50;
  const xEnd = 598.28 - textWidthEnd - 50;
  const baseY = 50;
  const lineHeight = 12;

  drawMultilineText(footerTextStart, xStart, baseY, lineHeight);
  drawMultilineText(footerTextEnd, xEnd, baseY, lineHeight);
}

// Função principal para gerar o PDF
async function generateMedicalRecordPDF(projectData, clientData, engenieerData) {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Carregar o logo
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  const headerAssets = {
    logoEmpresaImage,
    helveticaFont,
    helveticaBoldFont,
  };

  const page = pdfDoc.addPage([595.28, 841.89]);

  await addHeader(pdfDoc, page, clientData, headerAssets);

  const pageWidth = page.getWidth();

  // Título principal
  const title1 = "PRONTUÁRIO RECONSTITUÍDO DE";
  const title2 = `${(projectData.tipoEquipamento).toUpperCase()}`;
  
  const title1Width = helveticaBoldFont.widthOfTextAtSize(title1, 16);
  const title2Width = helveticaBoldFont.widthOfTextAtSize(title2, 16);
  
  page.drawText(title1, {
    x: (pageWidth - title1Width) / 2,
    y: 700,
    size: 16,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  page.drawText(title2, {
    x: (pageWidth - title2Width) / 2,
    y: 684,
    size: 16,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  // Função para criar tabelas com cabeçalho azul
  function createTable(startY, title, data, columnWidths) {
    let currentY = startY;

    // Cabeçalho da seção
    page.drawRectangle({
      x: 50,
      y: currentY - 20,
      width: 495.28,
      height: 20,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });

    const titleWidth = helveticaBoldFont.widthOfTextAtSize(title, 12);
    page.drawText(title, {
      x: 50 + (495.28 - titleWidth) / 2,
      y: currentY - 15,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });

    currentY -= 20;

    // Dados da tabela
    data.forEach((row, rowIndex) => {
      let currentX = 50;
      
      row.forEach((cell, cellIndex) => {
        // Desenhar célula
        page.drawRectangle({
          x: currentX,
          y: currentY - 20,
          width: columnWidths[cellIndex],
          height: 20,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
          color: rowIndex % 2 === 0 ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
        });

        // Desenhar texto
        page.drawText(cell.label + ":", {
          x: currentX + 5,
          y: currentY - 15,
          size: 8,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });

        page.drawText(cell.value || "N/A", {
          x: currentX + 5 + helveticaBoldFont.widthOfTextAtSize(cell.label + ": ", 8),
          y: currentY - 15,
          size: 8,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });

        currentX += columnWidths[cellIndex];
      });
      
      currentY -= 20;
    });

    return currentY;
  }

  const medicalRecord = projectData.inspection?.medicalRecord || {};

  let currentY = 650;

  // Seção IDENTIFICAÇÃO
  const identificacaoData = [
    [
      { label: "Código do Produto", value: projectData.numeroProjeto },
      { label: "Nº Série", value: projectData.numeroSerie }
    ],
    [
      { label: "Descrição", value: projectData.tipoEquipamento },
      { label: "Data de Fabricação", value: projectData.anoFabricacao }
    ],
    [
      { label: "VASO DE PRESSÃO", value: "Categoria " + (projectData.categoriaCaldeira || "V") },
      { label: "Fabricante", value: projectData.fabricante }
    ]
  ];

  currentY = createTable(currentY, "IDENTIFICAÇÃO", identificacaoData, [247.64, 247.64]);
  currentY -= 10;

  // Seção DADOS DE OPERAÇÃO
  const operacaoData = [
    [
      { label: "Fluido", value: medicalRecord.fluido || "Ar Comprimido" },
      { label: "Pressão de Operação", value: medicalRecord.pressaoMaximaOperacao }
    ],
    [
      { label: "Pressão Máxima de Trabalho(PMTA)", value: medicalRecord.pmtaCasco },
      { label: "Temperatura de Trabalho", value: medicalRecord.temperaturaMinima + " a " + medicalRecord.temperaturaMaxima }
    ]
  ];

  currentY = createTable(currentY, "DADOS DE OPERAÇÃO", operacaoData, [247.64, 247.64]);
  currentY -= 10;

  // Seção DADOS DE PROJETO
  const projetoData = [
    [
      { label: "Temperatura Máxima", value: medicalRecord.temperaturaMaxima },
      { label: "Diâmetro Nominal da Abertura", value: medicalRecord.diametroNominalInterno }
    ],
    [
      { label: "Pressão Teste Hidrostático", value: medicalRecord.pressaoProjeto },
      { label: "Temperatura Teste Hidrostático", value: medicalRecord.temperaturaMinima }
    ]
  ];

  currentY = createTable(currentY, "DADOS DE PROJETO", projetoData, [247.64, 247.64]);
  currentY -= 10;

  // Seção MATERIAIS
  const materiaisData = [
    [
      { label: "Tampo", value: medicalRecord.materialBase },
      { label: "Pé", value: medicalRecord.materialPes }
    ],
    [
      { label: "Costado", value: medicalRecord.materialBase },
      { label: "Base", value: medicalRecord.materialBase }
    ],
    [
      { label: "Bocal", value: "N/A" },
      { label: "Luvas, Tubos", value: medicalRecord.materialLuvas }
    ]
  ];

  currentY = createTable(currentY, "MATERIAIS", materiaisData, [247.64, 247.64]);
  currentY -= 10;

  // Seção ASPECTOS CONSTRUTIVOS - Dividida em duas colunas
  page.drawRectangle({
    x: 50,
    y: currentY - 20,
    width: 495.28,
    height: 20,
    color:   rgb(0.102, 0.204, 0.396),
    borderColor:   rgb(0.102, 0.204, 0.396),
    borderWidth: 1,
  });

  const aspectosTitle = "ASPECTOS CONSTRUTIVOS";
  const aspectosTitleWidth = helveticaBoldFont.widthOfTextAtSize(aspectosTitle, 12);
  page.drawText(aspectosTitle, {
    x: 50 + (495.28 - aspectosTitleWidth) / 2,
    y: currentY - 15,
    size: 12,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  currentY -= 20;

  // Sub-cabeçalhos
  page.drawRectangle({
    x: 50,
    y: currentY - 20,
    width: 247.64,
    height: 20,
    color: rgb(0.102, 0.204, 0.396),
    borderColor: rgb(0.102, 0.204, 0.396),
    borderWidth: 1,
  });

  page.drawText("SOLDA TAMPO/CASCO", {
    x: 50 + (247.64 - helveticaBoldFont.widthOfTextAtSize("SOLDA TAMPO/CASCO", 10)) / 2,
    y: currentY - 15,
    size: 10,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  page.drawRectangle({
    x: 297.64,
    y: currentY - 20,
    width: 247.64,
    height: 20,
    color: rgb(0.102, 0.204, 0.396),
    borderColor: rgb(0.102, 0.204, 0.396),
    borderWidth: 1,
  });

  page.drawText("SOLDA CASCO/CASCO", {
    x: 297.64 + (247.64 - helveticaBoldFont.widthOfTextAtSize("SOLDA CASCO/CASCO", 10)) / 2,
    y: currentY - 15,
    size: 10,
    font: helveticaBoldFont,
    color: rgb(1, 1, 1),
  });

  currentY -= 20;

  // Dados das soldas
  const soldaData = [
    [
      { label: "Local", value: medicalRecord.soldaTampoCascoLocal },
      { label: "Local", value: medicalRecord.soldaCascoCascoLocal }
    ],
    [
      { label: "Método", value: medicalRecord.soldaTampoCascoMetodo },
      { label: "Método", value: medicalRecord.soldaCascoCascoMetodo }
    ],
    [
      { label: "Código", value: medicalRecord.soldaTampoCascoCodigo },
      { label: "Código", value: medicalRecord.soldaCascoCascoCodigo }
    ],
    [
      { label: "Eficiência", value: medicalRecord.soldaTampoCascoEficiencia },
      { label: "Eficiência", value: medicalRecord.soldaCascoCascoEficiencia }
    ],
    [
      { label: "Radiografia", value: medicalRecord.soldaTampoCascoRadiografia },
      { label: "Radiografia", value: medicalRecord.soldaCascoCascoRadiografia }
    ]
  ];

  soldaData.forEach((row, rowIndex) => {
    let currentX = 50;
    
    row.forEach((cell, cellIndex) => {
      const cellWidth = 247.64;
      
      // Desenhar célula
      page.drawRectangle({
        x: currentX,
        y: currentY - 20,
        width: cellWidth,
        height: 20,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
        color: rowIndex % 2 === 0 ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1),
      });

      // Desenhar texto
      page.drawText(cell.label + ":", {
        x: currentX + 5,
        y: currentY - 15,
        size: 8,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });

      page.drawText(cell.value || "N/A", {
        x: currentX + 5 + helveticaBoldFont.widthOfTextAtSize(cell.label + ": ", 8),
        y: currentY - 15,
        size: 8,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });

      currentX += cellWidth;
    });
    
    currentY -= 20;
  });

  await addFooter(pdfDoc, page, projectData, 1);

  // Segunda página para tabelas adicionais
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, page2, clientData, headerAssets);

  let currentY2 = 700;

  // Função para criar tabelas com texto longo (quebra de linha)
  function createLongTextTable(page, startY, title, content, maxWidth = 495.28) {
    let currentY = startY;

    // Cabeçalho da seção
    page.drawRectangle({
      x: 50,
      y: currentY - 20,
      width: maxWidth,
      height: 20,
      color: rgb(0.102, 0.204, 0.396),
      borderColor: rgb(0.102, 0.204, 0.396),
      borderWidth: 1,
    });

    const titleWidth = helveticaBoldFont.widthOfTextAtSize(title, 12);
    page.drawText(title, {
      x: 50 + (maxWidth - titleWidth) / 2,
      y: currentY - 15,
      size: 12,
      font: helveticaBoldFont,
      color: rgb(1, 1, 1),
    });

    currentY -= 20;

    // Função para quebrar texto em linhas
    function wrapText(text, maxWidth, font, fontSize) {
      if (!text) return [];
      
      const words = text.split(' ');
      const lines = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);
        
        if (textWidth <= maxWidth - 20) { // 20px de margem interna
          currentLine = testLine;
        } else {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            lines.push(word);
          }
        }
      }
      
      if (currentLine) {
        lines.push(currentLine);
      }
      
      return lines;
    }

    // Quebrar o conteúdo em linhas
    const lines = wrapText(content || "Não informado", maxWidth - 20, helveticaFont, 10);
    const lineHeight = 15;
    const cellHeight = Math.max(lines.length * lineHeight + 10, 25);

    // Desenhar célula do conteúdo
    page.drawRectangle({
      x: 50,
      y: currentY - cellHeight,
      width: maxWidth,
      height: cellHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
      color: rgb(1, 1, 1),
    });

    // Desenhar texto linha por linha
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 60, // 10px de margem interna
        y: currentY - 20 - (index * lineHeight),
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
    });

    return currentY - cellHeight - 10; // Retorna nova posição Y
  }

  // Seção PROCEDIMENTOS DE INSPEÇÃO
  currentY2 = createLongTextTable(
    page2, 
    currentY2, 
    "PROCEDIMENTOS DE INSPEÇÃO", 
    medicalRecord.procedimentosInspecao
  );
  currentY2 -= 20;

  // Seção PRECAUÇÕES
  currentY2 = createLongTextTable(
    page2, 
    currentY2, 
    "PRECAUÇÕES", 
    medicalRecord.precaucoes
  );

  // Seção do Engenheiro Responsável
  currentY2 -= 40;

  // Título da seção de responsabilidade
  const respTitle = "RESPONSÁVEL TÉCNICO";
  const respTitleWidth = helveticaBoldFont.widthOfTextAtSize(respTitle, 14);
  page2.drawText(respTitle, {
    x: (pageWidth - respTitleWidth) / 2,
    y: currentY2,
    size: 14,
    font: helveticaBoldFont,
    color: rgb(0, 0, 0),
  });

  currentY2 -= 40;

  // Espaço para assinatura
  if (engenieerData.signature) {
    try {
      const response = await axios.get(engenieerData.signature, { responseType: 'arraybuffer' });
      const imageBytes = response.data;

      // Verifica se é PNG ou JPG
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

      page2.drawImage(signatureImage, {
        x: imageX,
        y: currentY2 - imageHeight,
        width: imageWidth,
        height: imageHeight,
        opacity: 1,
      });

      currentY2 -= imageHeight + 10;
    } catch (error) {
      console.error('Erro ao adicionar a assinatura:', error);
      currentY2 -= 80; // Espaço reservado mesmo sem assinatura
    }
  } else {
    currentY2 -= 80; // Espaço reservado para assinatura manual
  }

  // Linha para assinatura
  const lineStartX2 = pageWidth * 0.25;
  const lineEndX2 = pageWidth * 0.75;

  page2.drawLine({
    start: { x: lineStartX2, y: currentY2 },
    end: { x: lineEndX2, y: currentY2 },
    thickness: 1,
    color: rgb(0, 0, 0),
    opacity: 1,
  });

  currentY2 -= 15;

  // Nome do engenheiro
  const engineerName = engenieerData.name || "Cleonis Batista Santos";
  const engineerNameWidth = helveticaFont.widthOfTextAtSize(engineerName, 12);
  page2.drawText(engineerName, {
    x: (pageWidth - engineerNameWidth) / 2,
    y: currentY2,
    size: 12,
    color: rgb(0, 0, 0),
    font: helveticaFont,
  });

  currentY2 -= 15;

  // CREA do engenheiro
  const creaMember = `CREA ${engenieerData.crea || "GO - 123456"}`;
  const creaMemberWidth = helveticaFont.widthOfTextAtSize(creaMember, 12);
  page2.drawText(creaMember, {
    x: (pageWidth - creaMemberWidth) / 2,
    y: currentY2,
    size: 12,
    color: rgb(0, 0, 0),
    font: helveticaFont,
  });

  currentY2 -= 15;

  // Título profissional
  const profTitle = "Engenheiro Mecânico";
  const profTitleWidth = helveticaFont.widthOfTextAtSize(profTitle, 12);
  page2.drawText(profTitle, {
    x: (pageWidth - profTitleWidth) / 2,
    y: currentY2,
    size: 12,
    color: rgb(0, 0, 0),
    font: helveticaFont,
  });

  await addFooter(pdfDoc, page2, projectData, 2);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

async function generateMedicalRecordPdf(projectId) {
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

    const pdfBytes = await generateMedicalRecordPDF(
      projectData,
      clientData,
      engenieerData,
    );

    return Buffer.from(pdfBytes);
  } catch (error) {
    console.error("Erro ao gerar o PDF:", error.message);
    throw new Error("Erro ao gerar o PDF");
  }
}

// Exportação da função para gerar o PDF
module.exports = generateMedicalRecordPdf;