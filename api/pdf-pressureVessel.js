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

  // ... (resto do código da página 2 - mantendo igual ao original)
  // Por brevidade, vou pular para as partes importantes

  // Aqui você continuaria com TODO o resto do seu código original,
  // apenas adicionando as linhas pageRefs.nomeSecao = pdfDoc.getPageCount(); 
  // em cada seção importante

  // Exemplo das próximas páginas:
  console.log("Começando pagina 3")
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.dadosEquipamento = pdfDoc.getPageCount();
  let upTo15 = pageRefs.dadosEquipamento;
  // ... resto do código da página 3

  console.log("Começando pagina 4")
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.categorizacao = pdfDoc.getPageCount();
  let upTo18 = pageRefs.categorizacao;
  // ... resto do código da página 4

  console.log("Começando pagina 5")
  const page5 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.documentacaoExistente = pdfDoc.getPageCount();
  let upTo19 = pageRefs.documentacaoExistente;
  // ... resto do código da página 5

  console.log("Começando pagina 7")
  const page7 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs.definicaoNormas = pdfDoc.getPageCount();
  let upTo4 = pageRefs.definicaoNormas;
  // ... resto do código da página 7

  // Seção 5: Caracterização
  pageRefs.caracterizacao = pdfDoc.getPageCount() + 1;
  let upTo51 = pageRefs.caracterizacao;
  // await generateDevicesPDF(pdfDoc, data.inspection.devicesData);

  const page9 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.mapaMedicao = pdfDoc.getPageCount();
  let upTo52 = pageRefs.mapaMedicao;
  // ... resto do código da página 9

  // Função para verificar se há dados do corpo do equipamento
  function hasEquipmentBodyData(data) {
    return data.inspection && data.inspection.equipmentBodyData && 
           Object.keys(data.inspection.equipmentBodyData).length > 0;
  }

  let upTo53 = null;
  if (hasEquipmentBodyData(data)) {
    const page10 = pdfDoc.addPage([595.28, 841.89]);
    countPages++;
    pageRefs.corpoEquipamento = pdfDoc.getPageCount();
    upTo53 = pageRefs.corpoEquipamento;
    // ... resto do código da página 10
  }

  const page12 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.recomendacoes = pdfDoc.getPageCount();
  let upTo54 = pageRefs.recomendacoes;
  // ... resto do código da página 12

  const pagePLH = pdfDoc.addPage([595.28, 841.89]);
  // ... resto do código da página PLH

  const page13 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.registrosFotograficos = pdfDoc.getPageCount();
  let upTo55 = pageRefs.registrosFotograficos;
  // ... resto do código da página 13

  const page14 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.recomendacoesAdicionais = pdfDoc.getPageCount();
  let upTo6 = pageRefs.recomendacoesAdicionais;
  // ... resto do código da página 14

  const pageLimitationsOfReport = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.limitacoes = pdfDoc.getPageCount();
  let upTo7 = pageRefs.limitacoes;
  // ... resto do código da página de limitações

  const page15 = pdfDoc.addPage([595.28, 841.89]);
  countPages++;
  pageRefs.conclusao = pdfDoc.getPageCount();
  let upTo8 = pageRefs.conclusao;
  // ... resto do código da página 15

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

