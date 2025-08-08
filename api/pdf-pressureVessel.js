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

  // Objeto para rastrear as páginas de início de cada seção
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

  // Função addFooter modificada para aceitar total de páginas
  async function addFooter(pdfDoc, page, data, pageNumber, totalPages) {
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pageWidth = page.getWidth();

    const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto}`;
    const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
    const footerTextEnd = `C&T.0.1 | ${formatDate(data.inspection.endDate)}\nPágina ${pageNumber} de ${totalPages}`;

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
    const textWidthEnd = helveticaFont.widthOfTextAtSize(`C&T.0.1 | ${formatDate(data.inspection.endDate)}`, 10);

    const xStart = 50;
    const xMiddle = (pageWidth - textWidthMiddle) / 3;
    const xEnd = pageWidth - textWidthEnd - 50;
    const baseY = 50;
    const lineHeight = 12;

    drawMultilineText(footerTextStart, xStart, baseY, lineHeight);
    drawMultilineText(footerTextMiddle, xMiddle, baseY, lineHeight);
    drawMultilineText(footerTextEnd, xEnd, baseY, lineHeight);
  }

  // Função para verificar se há dados do corpo do equipamento
  function hasEquipmentBodyData(data) {
    return data.inspection && data.inspection.equipmentBodyData && 
           Object.keys(data.inspection.equipmentBodyData).length > 0;
  }

  console.log("Começando pagina 1")
  const page = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.capa = pdfDoc.getPageCount();

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

  console.log("Começando pagina 2")
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.informacoesGerais = pdfDoc.getPageCount();

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

  // Aqui você continuaria com todo o resto do seu código original...
  // Por brevidade, vou pular para as partes importantes e mostrar onde inserir os pageRefs

  // Exemplo de como continuar:
  console.log("Começando pagina 3")
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.dadosEquipamento = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page3, clientData, headerAssets);
  // ... resto do código da página 3

  console.log("Começando pagina 4")
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.categorizacao = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page4, clientData, headerAssets);
  // ... resto do código da página 4

  console.log("Começando pagina 5")
  const page5 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.documentacaoExistente = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page5, clientData, headerAssets);
  // ... resto do código da página 5

  console.log("Começando pagina 7")
  const page7 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs.definicaoNormas = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page7, clientData, headerAssets);
  // ... resto do código da página 7

  // Seção 5: Caracterização
  pageRefs.caracterizacao = pdfDoc.getPageCount() + 1;
  // await generateDevicesPDF(pdfDoc, data.inspection.devicesData);

  const page9 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.mapaMedicao = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page9, clientData, headerAssets);
  // ... resto do código da página 9

  if (hasEquipmentBodyData(data)) {
    const page10 = pdfDoc.addPage([595.28, 841.89]);
    countPages++;
    pageRefs.corpoEquipamento = pdfDoc.getPageCount();
    await addHeader(pdfDoc, page10, clientData, headerAssets);
    // ... resto do código da página 10
  }

  const page12 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.recomendacoes = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page12, clientData, headerAssets);
  // ... resto do código da página 12

  const pagePLH = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, pagePLH, clientData, headerAssets);
  // ... resto do código da página PLH

  const page13 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.registrosFotograficos = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page13, clientData, headerAssets);
  // ... resto do código da página 13

  const page14 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.recomendacoesAdicionais = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page14, clientData, headerAssets);
  // ... resto do código da página 14

  const pageLimitationsOfReport = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.limitacoes = pdfDoc.getPageCount();
  await addHeader(pdfDoc, pageLimitationsOfReport, clientData, headerAssets);
  // ... resto do código da página de limitações

  const page15 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.conclusao = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page15, clientData, headerAssets);
  // ... resto do código da página 15

  // =======================================================================
  // NOVA LÓGICA DO SUMÁRIO E RODAPÉS
  // =======================================================================

  // 1. Criar a página do sumário (ela será adicionada ao final, por enquanto)
  const summaryPage = pdfDoc.addPage();
  const summaryPageIndex = pdfDoc.getPageCount() - 1;
  await addHeader(pdfDoc, summaryPage, clientData, headerAssets);
  summaryPage.drawText("SUMÁRIO", {
    x: 240,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // 2. Montar os itens do sumário usando os números de página corretos de `pageRefs`
  function generateDynamicSections(data, pageRefs) {
    let sections = [];
    let subSectionCount = 1;

    sections.push({ title: "5. CARACTERIZAÇÃO", pageRef: 'caracterizacao' });
    sections.push({ title: `  5.${subSectionCount++} DISPOSITIVOS`, pageRef: 'caracterizacao' });
    sections.push({ title: `  5.${subSectionCount++} MAPA DE MEDIÇÃO`, pageRef: 'mapaMedicao' });
    if (hasEquipmentBodyData(data)) {
      sections.push({ title: `  5.${subSectionCount++} CORPO DO EQUIPAMENTO`, pageRef: 'corpoEquipamento' });
    }
    sections.push({ title: `  5.${subSectionCount++} RECOMENDAÇÕES`, pageRef: 'recomendacoes' });
    sections.push({ title: `  5.${subSectionCount++} REGISTROS FOTOGRÁFICOS`, pageRef: 'registrosFotograficos' });
    
    return sections;
  }

  const tocItems = [
    { title: "1. INFORMAÇÕES GERAIS", pageRef: 'informacoesGerais' },
    { title: "  1.1 DADOS CADASTRAIS", pageRef: 'informacoesGerais' },
    { title: "  1.2 RESPONSÁVEIS TÉCNICOS", pageRef: 'informacoesGerais' },
    { title: "  1.3 CONTROLE DE REVISÃO", pageRef: 'informacoesGerais' },
    { title: "  1.4 INSPEÇÕES CONTRATADAS", pageRef: 'informacoesGerais' },
    { title: "  1.5 DADOS DO EQUIPAMENTO", pageRef: 'dadosEquipamento' },
    { title: "  1.6 CATEGORIZAÇÃO", pageRef: 'categorizacao' },
    { title: "  1.7 PESSOAS QUE ACOMPANHARAM", pageRef: 'categorizacao' },
    { title: "  1.8 DOCUMENTAÇÃO EXISTENTE", pageRef: 'documentacaoExistente' },
    { title: "2. DEFINIÇÃO", pageRef: 'definicaoNormas' },
    { title: "3. OBJETIVO", pageRef: 'definicaoNormas' },
    { title: "4. NORMAS", pageRef: 'definicaoNormas' },
    ...generateDynamicSections(data, pageRefs),
    { title: "6. RECOMENDAÇÕES ADICIONAIS", pageRef: 'recomendacoesAdicionais' },
    { title: "7. LIMITAÇÕES DO RELATÓRIO", pageRef: 'limitacoes' },
    { title: "8. CONCLUSÃO", pageRef: 'conclusao' },
  ];

  let yPosition = 660;
  const lineHeightSumary = 20;

  tocItems.forEach((item) => {
    // O número da página no sumário será o número da página do conteúdo + 1 (por causa da própria pág. do sumário)
    const pageNum = (pageRefs[item.pageRef] || 1) + 1;
    const title = item.title;
    const titleWidth = helveticaFont.widthOfTextAtSize(title, 12);
    const dots = ".".repeat(Math.max(0, Math.floor((450 - titleWidth) / helveticaFont.widthOfTextAtSize(".", 12))));

    summaryPage.drawText(`${title} ${dots} ${pageNum}`, {
        x: 50, y: yPosition, size: 12, font: helveticaFont,
    });
    yPosition -= lineHeightSumary;
  });

  // 3. Mover a página do sumário para a posição correta (índice 1, após a capa)
  const pageToMove = pdfDoc.getPage(summaryPageIndex);
  pdfDoc.removePage(summaryPageIndex);
  pdfDoc.insertPage(1, pageToMove);

  // 4. Adicionar rodapés com numeração correta em TODAS as páginas
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    // Passa o número da página (i + 1) e o total de páginas para a função addFooter
    await addFooter(pdfDoc, page, data, i + 1, totalPages); 
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

module.exports = {
  generatePDF,
  getProjectData,
  getClientData,
  getEngenieerData,
  getAnalystData,
};

