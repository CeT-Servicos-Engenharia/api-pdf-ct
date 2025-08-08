// ... (todo o código anterior, como getProjectData, addHeader, etc., permanece o mesmo)

async function generatePDF(data, clientData, engenieerData, analystData) {
  const pdfDoc = await PDFDocument.create();

  // Carregar fontes e recursos (assets)
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
  const logoBytes = fs.readFileSync(logoPath);
  const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

  let logoClienteImage = null;
  if (clientData && clientData.logo) {
    try {
      const response = await axios.get(clientData.logo, { responseType: "arraybuffer" });
      const optimized = await sharp(response.data).resize(150).jpeg({ quality: 60 }).toBuffer();
      logoClienteImage = await pdfDoc.embedJpg(optimized);
    } catch (error) {
      console.error("Erro ao baixar logo do cliente:", error.message);
    }
  }

  const headerAssets = { logoEmpresaImage, logoClienteImage, helveticaFont, helveticaBoldFont };
  
  // Objeto para rastrear as páginas de início de cada seção
  const pageRefs = {};

  // --- INÍCIO DA GERAÇÃO DAS PÁGINAS DE CONTEÚDO ---

  // Página 1: Capa
  const page1 = pdfDoc.addPage([595.28, 841.89]);
  // ... (código para desenhar a capa - igual ao seu original)
  // ... (desenhar título, imagem, detalhes do equipamento, etc.)
  
  // Página 2: Informações Gerais
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['1_INFO_GERAIS'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page2, clientData, headerAssets);
  // ... (código para desenhar a página 2 - igual ao seu original)
  // ... (tabelas de dados cadastrais, responsáveis, etc.)

  // Página 3: Dados do Equipamento
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['1_5_DADOS_EQUIPAMENTO'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page3, clientData, headerAssets);
  // ... (código para desenhar a página 3 - igual ao seu original)

  // Página 4: Categorização
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['1_6_CATEGORIZACAO'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page4, clientData, headerAssets);
  // ... (código para desenhar a página 4 - igual ao seu original)

  // Página 5: Documentação Existente (pode criar mais páginas)
  const page5 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['1_8_DOC_EXISTENTE'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page5, clientData, headerAssets);
  // ... (chamar sua função drawPaginatedTable, que já adiciona páginas se necessário)
  // A função drawPaginatedTable precisa ser ajustada para não adicionar rodapés ainda.
  
  // Página 7: Definição, Objetivo, Normas
  const page7 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['2_DEFINICAO'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page7, clientData, headerAssets);
  // ... (código para desenhar a página 7 - igual ao seu original)

  // Seção 5: Caracterização
  pageRefs['5_CARACTERIZACAO'] = pdfDoc.getPageCount() + 1; // Próxima página a ser criada
  
  // 5.1 Dispositivos
  await generateDevicesPDF(pdfDoc, data.inspection.devicesData, clientData, headerAssets); // Passar assets
  pageRefs['5_1_DISPOSITIVOS'] = pageRefs['5_CARACTERIZACAO']; // Começa na mesma página

  // 5.2 Mapa de Medição
  const page9 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['5_2_MAPA_MEDICAO'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page9, clientData, headerAssets);
  // ... (código para desenhar a página 9 - igual ao seu original)

  // 5.3 Corpo do Equipamento (Condicional)
  if (hasEquipmentBodyData(data)) {
      const page10 = pdfDoc.addPage([595.28, 841.89]);
      pageRefs['5_3_CORPO_EQUIPAMENTO'] = pdfDoc.getPageCount();
      await addHeader(pdfDoc, page10, clientData, headerAssets);
      // ... (código para desenhar a página 10 - igual ao seu original)
  }

  // 5.4 Recomendações
  const page12 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['5_4_RECOMENDACOES'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page12, clientData, headerAssets);
  // ... (chamar sua função createRecommendationsPages)

  // Página de Recomendações PLH
  const pagePLH = pdfDoc.addPage([595.28, 841.89]);
  await addHeader(pdfDoc, pagePLH, clientData, headerAssets);
  // ... (chamar sua função createRecommendationsPLHPages)

  // 5.5 Registros Fotográficos
  const page13 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['5_5_REGISTROS_FOTOGRAFICOS'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page13, clientData, headerAssets);
  // ... (chamar sua função drawImageGridRegisterPhotographics)

  // Página 6: Recomendações Adicionais
  const page14 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['6_RECOMENDACOES_ADICIONAIS'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page14, clientData, headerAssets);
  // ... (código para desenhar a página 14 - igual ao seu original)

  // Página 7: Limitações do Relatório
  const pageLimitations = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['7_LIMITACOES'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, pageLimitations, clientData, headerAssets);
  // ... (código para desenhar a página de limitações - igual ao seu original)

  // Página 8: Conclusão
  const page15 = pdfDoc.addPage([595.28, 841.89]);
  pageRefs['8_CONCLUSAO'] = pdfDoc.getPageCount();
  await addHeader(pdfDoc, page15, clientData, headerAssets);
  // ... (código para desenhar a página de conclusão - igual ao seu original)

  // --- FIM DA GERAÇÃO DAS PÁGINAS DE CONTEÚDO ---


  // --- ETAPA FINAL: GERAR SUMÁRIO E NUMERAR PÁGINAS ---

  // Criar a página do sumário
  const summaryPage = await PDFDocument.create().then(doc => doc.addPage());
  await addHeader(pdfDoc, summaryPage, clientData, headerAssets);
  summaryPage.drawText("SUMÁRIO", {
    x: 240,
    y: 700,
    size: 24,
    font: helveticaBoldFont,
  });

  // Estrutura dinâmica do sumário
  let subSectionCounter = 1;
  const tocItems = [
      { title: "1. INFORMAÇÕES GERAIS", pageRef: '1_INFO_GERAIS' },
      { title: "  1.1 DADOS CADASTRAIS", pageRef: '1_INFO_GERAIS' },
      { title: "  1.2 RESPONSÁVEIS TÉCNICOS", pageRef: '1_INFO_GERAIS' },
      { title: "  1.3 CONTROLE DE REVISÃO", pageRef: '1_INFO_GERAIS' },
      { title: "  1.4 INSPEÇÕES CONTRATADAS", pageRef: '1_INFO_GERAIS' },
      { title: "  1.5 DADOS DO EQUIPAMENTO", pageRef: '1_5_DADOS_EQUIPAMENTO' },
      { title: "  1.6 CATEGORIZAÇÃO", pageRef: '1_6_CATEGORIZACAO' },
      { title: "  1.7 PESSOAS QUE ACOMPANHARAM", pageRef: '1_6_CATEGORIZACAO' },
      { title: "  1.8 DOCUMENTAÇÃO EXISTENTE", pageRef: '1_8_DOC_EXISTENTE' },
      { title: "2. DEFINIÇÃO", pageRef: '2_DEFINICAO' },
      { title: "3. OBJETIVO", pageRef: '2_DEFINICAO' },
      { title: "4. NORMAS", pageRef: '2_DEFINICAO' },
      { title: "5. CARACTERIZAÇÃO", pageRef: '5_CARACTERIZACAO' },
      { title: `  5.${subSectionCounter++} DISPOSITIVOS`, pageRef: '5_1_DISPOSITIVOS' },
      { title: `  5.${subSectionCounter++} MAPA DE MEDIÇÃO`, pageRef: '5_2_MAPA_MEDICAO' },
  ];

  if (hasEquipmentBodyData(data)) {
      tocItems.push({ title: `  5.${subSectionCounter++} CORPO DO EQUIPAMENTO`, pageRef: '5_3_CORPO_EQUIPAMENTO' });
  }
  
  tocItems.push({ title: `  5.${subSectionCounter++} RECOMENDAÇÕES`, pageRef: '5_4_RECOMENDACOES' });
  tocItems.push({ title: `  5.${subSectionCounter++} REGISTROS FOTOGRÁFICOS`, pageRef: '5_5_REGISTROS_FOTOGRAFICOS' });
  
  tocItems.push({ title: "6. RECOMENDAÇÕES ADICIONAIS", pageRef: '6_RECOMENDACOES_ADICIONAIS' });
  tocItems.push({ title: "7. LIMITAÇÕES DO RELATÓRIO", pageRef: '7_LIMITACOES' });
  tocItems.push({ title: "8. CONCLUSÃO", pageRef: '8_CONCLUSAO' });

  // Desenhar itens do sumário
  let yPosition = 660;
  const lineHeightSumary = 20;
  const pageNumberOffset = 1; // O sumário será a página 2, então tudo é deslocado

  tocItems.forEach((item) => {
    // O número da página é a referência + o deslocamento
    const pageNum = (pageRefs[item.pageRef] || 0) + pageNumberOffset;
    const title = item.title;
    
    const titleWidth = helveticaFont.widthOfTextAtSize(title, 12);
    const dots = ".".repeat(Math.floor((450 - titleWidth) / helveticaFont.widthOfTextAtSize(".", 12)));

    summaryPage.drawText(`${title} ${dots} ${pageNum}`, {
        x: 50,
        y: yPosition,
        size: 12,
        font: helveticaFont,
    });
    yPosition -= lineHeightSumary;
  });

  // Inserir a página de sumário na posição correta (após a capa)
  const [summaryPageCopied] = await pdfDoc.copyPages(summaryPage.doc, [0]);
  pdfDoc.insertPage(1, summaryPageCopied);

  // Adicionar rodapés com numeração correta em TODAS as páginas
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    // A função addFooter precisa ser chamada com o número da página correto
    await addFooter(pdfDoc, page, data, i + 1); 
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


// Função de rodapé (sem alterações, apenas para referência)
async function addFooter(pdfDoc, page, data, pageNumber) {
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pageWidth = page.getWidth();
    const totalPages = pdfDoc.getPageCount(); // Pega o número total de páginas

    const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto}`;
    const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
    const footerTextEnd = `C&T.0.1 | ${formatDate(data.inspection.endDate)}\nPágina ${pageNumber} de ${totalPages}`;

    // ... (resto da sua função drawMultilineText para desenhar o rodapé)
}

