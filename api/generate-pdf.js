
/**
 * === PATCH: 5.2 MAPA DE MEDIÇÃO — "continuação" nas quebras (sem repetir o título principal) ===
 * Cole este bloco no seu generate-pdf.js, substituindo o renderer atual do Mapa de Medição.
 * Mantém o título "5.2 MAPA DE MEDIÇÃO" apenas na primeira página da seção e,
 * nas páginas seguintes, imprime "Mapa de Medição – continuação" no topo,
 * usando a MESMA fonte e cor de "Dispositivos – continuação".
 */

function _mmFormat(v) {
  if (v === null || v === undefined || v === '' || Number.isNaN(v)) return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

function _collectPointKeys(obj) {
  const keys = Object.keys(obj || {}).filter(k => /^P\d+$/i.test(k));
  return keys.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

function _normalizeMapaMedicao(data) {
  const src = (data && (data.mapaMedicao || data.mapa || data)) || {};
  const get = (k) => src && src[k] ? src[k] : {};

  return [
    { group: 'BALÃO SUPERIOR', rows: [
      { local: 'Costado',        pts: get('balaoSuperiorCostado') },
      { local: 'Tampo direito',  pts: get('balaoSuperiorTampoDireito') },
      { local: 'Tampo esquerdo', pts: get('balaoSuperiorTampoEsquerdo') },
    ]},
    { group: 'BALÃO INFERIOR', rows: [
      { local: 'Costado',        pts: get('balaoInferiorCostado') },
      { local: 'Tampo direito',  pts: get('balaoInferiorTampoDireito') },
      { local: 'Tampo esquerdo', pts: get('balaoInferiorTampoEsquerdo') },
    ]},
    { group: 'FORNALHA', rows: [
      { local: 'Frontal',        pts: get('fornalhaFrontal') },
      { local: 'Lado direito',   pts: get('fornalhaLadoDireito') },
      { local: 'Lado esquerdo',  pts: get('fornalhaLadoEsquerdo') },
      { local: 'Traseira',       pts: get('fornalhaTraseira') },
    ]},
    { group: 'ECONOMIZADOR', rows: [
      { local: 'Tubo', pts: get('economizadorTubo') },
    ]},
    { group: 'DESAERADOR', rows: [
      { local: 'Costado',        pts: get('desaeradorCostado') },
      { local: 'Tampo direito',  pts: get('desaeradorTampoDireito') },
      { local: 'Tampo esquerdo', pts: get('desaeradorTampoEsquerdo') },
    ]},
  ];
}

async function renderMapaMedicao({
  pdfDoc, data, clientData, headerAssets,
  addHeader, addFooter,
  helveticaFont, helveticaBoldFont
}) {
  const PAGE_SIZE = [595.28, 841.89];
  const LEFT = 50;
  const RIGHT = 545.28;
  const WORK_WIDTH = RIGHT - LEFT;
  const TOP = 760;
  const BOTTOM = 80;
  const headerHeight = 20;
  const rowHeight = 22;
  const padding = 8;

  // Página inicial da seção 5.2
  let page = pdfDoc.addPage(PAGE_SIZE);
  countPages++;
  await addHeader(pdfDoc, page, clientData, headerAssets);
  let y = TOP;

  // Título principal (só aqui)
  page.drawText('5.2 MAPA DE MEDIÇÃO', {
    x: LEFT, y,
    size: 16, font: helveticaBoldFont
  });
  y -= 28;

  const groups = _normalizeMapaMedicao(data);

  // Em novas páginas, não repete o título; imprime "Mapa de Medição – continuação"
  const newPage = async (repeatGroupTitle) => {
    await addFooter(pdfDoc, page, data, countPages);
    page = pdfDoc.addPage(PAGE_SIZE);
    countPages++;
    await addHeader(pdfDoc, page, clientData, headerAssets);
    y = TOP;

    // === Continuação (mesma fonte/cor de Dispositivos – continuação) ===
    page.drawText('Mapa de Medição – continuação', {
      x: 50, y: 700, size: 12, font: helveticaFont, color: rgb(0.3, 0.3, 0.3)
    });
    // posiciona o cursor como nas outras seções (logo abaixo do subtítulo discreto)
    y = 640;

    // Se a quebra ocorrer dentro de um grupo, repete o título do grupo (faixa azul)
    if (repeatGroupTitle) {
      page.drawRectangle({
        x: LEFT, y: y - headerHeight + 2,
        width: WORK_WIDTH, height: headerHeight,
        color: rgb(0.102, 0.204, 0.396)
      });
      page.drawText(repeatGroupTitle, {
        x: LEFT + 10, y: y - headerHeight + 8,
        size: 12, font: helveticaBoldFont, color: rgb(1,1,1)
      });
      y -= headerHeight + 8;
    }
  };

  for (const group of groups) {
    // Se não couber o cabeçalho do grupo, quebra com continuação
    if (y - (headerHeight + 12) < BOTTOM) await newPage();

    // Cabeçalho do grupo (faixa azul)
    page.drawRectangle({
      x: LEFT, y: y - headerHeight + 2,
      width: WORK_WIDTH, height: headerHeight,
      color: rgb(0.102, 0.204, 0.396)
    });
    page.drawText(group.group, {
      x: LEFT + 10, y: y - headerHeight + 8,
      size: 12, font: helveticaBoldFont, color: rgb(1,1,1)
    });
    y -= headerHeight + 8;

    // Descobrir as chaves Pn existentes
    const allKeys = new Set();
    for (const r of group.rows) _collectPointKeys(r.pts).forEach(k => allKeys.add(k));
    let pointKeys = Array.from(allKeys);
    if (pointKeys.length === 0) pointKeys = ['P1','P2','P3'];

    const MAX_COLS = 6;
    const chunked = [];
    for (let i = 0; i < pointKeys.length; i += MAX_COLS) {
      chunked.push(pointKeys.slice(i, i + MAX_COLS));
    }

    for (const keys of chunked) {
      const colLocal = 180;
      const colW = (WORK_WIDTH - colLocal) / keys.length;

      if (y - (rowHeight + 4) < BOTTOM) await newPage(group.group);

      // Header da tabela
      page.drawRectangle({
        x: LEFT, y: y - rowHeight,
        width: colLocal, height: rowHeight,
        borderWidth: 1, borderColor: rgb(0.102,0.204,0.396),
        color: rgb(0.95, 0.95, 0.98)
      });
      page.drawText('Local', {
        x: LEFT + padding, y: y - rowHeight + 6,
        size: 10, font: helveticaBoldFont
      });
      for (let i = 0; i < keys.length; i++) {
        const x = LEFT + colLocal + i * colW;
        page.drawRectangle({
          x, y: y - rowHeight,
          width: colW, height: rowHeight,
          borderWidth: 1, borderColor: rgb(0.102,0.204,0.396),
          color: rgb(0.95, 0.95, 0.98)
        });
        page.drawText(keys[i], {
          x: x + padding, y: y - rowHeight + 6,
          size: 10, font: helveticaBoldFont
        });
      }
      y -= rowHeight;

      // Linhas
      for (const r of group.rows) {
        if (y - rowHeight < BOTTOM) {
          await newPage(group.group);
          // redesenha cabeçalho da tabela
          page.drawRectangle({
            x: LEFT, y: y - rowHeight,
            width: colLocal, height: rowHeight,
            borderWidth: 1, borderColor: rgb(0.102,0.204,0.396),
            color: rgb(0.95, 0.95, 0.98)
          });
          page.drawText('Local', {
            x: LEFT + padding, y: y - rowHeight + 6,
            size: 10, font: helveticaBoldFont
          });
          for (let i = 0; i < keys.length; i++) {
            const x = LEFT + colLocal + i * colW;
            page.drawRectangle({
              x, y: y - rowHeight,
              width: colW, height: rowHeight,
              borderWidth: 1, borderColor: rgb(0.102,0.204,0.396),
              color: rgb(0.95, 0.95, 0.98)
            });
            page.drawText(keys[i], {
              x: x + padding, y: y - rowHeight + 6,
              size: 10, font: helveticaBoldFont
            });
          }
          y -= rowHeight;
        }

        // célula Local
        page.drawRectangle({
          x: LEFT, y: y - rowHeight,
          width: colLocal, height: rowHeight,
          borderWidth: 1, borderColor: rgb(0.102,0.204,0.396)
        });
        page.drawText(r.local, {
          x: LEFT + padding, y: y - rowHeight + 6,
          size: 10, font: helveticaFont
        });

        // células Pn
        for (let i = 0; i < keys.length; i++) {
          const x = LEFT + colLocal + i * colW;
          page.drawRectangle({
            x, y: y - rowHeight,
            width: colW, height: rowHeight,
            borderWidth: 1, borderColor: rgb(0.102,0.204,0.396)
          });
          const val = _mmFormat(r.pts[keys[i]]);
          page.drawText(val, {
            x: x + padding, y: y - rowHeight + 6,
            size: 10, font: helveticaFont
          });
        }
        y -= rowHeight;
      }
      y -= 10;
    }
  }
  await addFooter(pdfDoc, page, data, countPages);
}
