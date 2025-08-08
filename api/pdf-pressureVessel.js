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
  // (Esta parte permanece a mesma, você gera todas as suas páginas de conteúdo primeiro)
  // Exemplo:
  const page1 = pdfDoc.addPage();
  // ... desenha conteúdo da page1 ...

  const page2 = pdfDoc.addPage();
  pageRefs['1_INFO_GERAIS'] = pdfDoc.getPageCount();
  // ... desenha conteúdo da page2 ...

  // ... continue gerando TODAS as outras páginas do relatório ...
  // ... e populando o objeto pageRefs com a contagem de página de cada seção.
  // IMPORTANTE: Não adicione rodapés aqui. Eles serão adicionados no final.

  // --- FIM DA GERAÇÃO DAS PÁGINAS DE CONTEÚDO ---


  // --- ETAPA FINAL: GERAR SUMÁRIO E NUMERAR PÁGINAS ---

  // 1. Criar a página do sumário (ainda no final do documento)
  const summaryPage = pdfDoc.addPage();
  const summaryPageIndex = pdfDoc.getPageCount() - 1;

  // 2. Desenhar o conteúdo do sumário
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

  let yPosition = 660;
  const lineHeightSumary = 20;
  const pageNumberOffset = 1; // O sumário será a página 2, então tudo é deslocado em +1

  tocItems.forEach((item) => {
    const pageNum = (pageRefs[item.pageRef] || 0) + pageNumberOffset;
    const title = item.title;
    
    const titleWidth = helveticaFont.widthOfTextAtSize(title, 12);
    const dots = ".".repeat(Math.max(0, Math.floor((450 - titleWidth) / helveticaFont.widthOfTextAtSize(".", 12))));

    summaryPage.drawText(`${title} ${dots} ${pageNum}`, {
        x: 50,
        y: yPosition,
        size: 12,
        font: helveticaFont,
    });
    yPosition -= lineHeightSumary;
  });

  // 3. Mover a página do sumário para a posição correta (índice 1, após a capa)
  pdfDoc.insertPage(1, pdfDoc.removePage(summaryPageIndex));

  // 4. Adicionar rodapés com numeração correta em TODAS as páginas
  const totalPages = pdfDoc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const page = pdfDoc.getPage(i);
    // A função addFooter precisa ser chamada com o número da página correto (i + 1)
    await addFooter(pdfDoc, page, data, i + 1, totalPages); 
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// Altere a função de rodapé para aceitar o número total de páginas
async function addFooter(pdfDoc, page, data, pageNumber, totalPages) {
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pageWidth = page.getWidth();

    const footerTextStart = `${data.numeroProjeto || " "}\nART:${data.artProjeto}`;
    const footerTextMiddle = `Eng. Mec. Cleonis Batista Santos\nEng. Mec. Seg. Thiago Wherman Candido Borges`;
    // Use a numeração "Página X de Y"
    const footerTextEnd = `C&T.0.1 | ${formatDate(data.inspection.endDate)}\nPágina ${pageNumber} de ${totalPages}`;

    // ... (resto da sua função drawMultilineText para desenhar o rodapé)
}
