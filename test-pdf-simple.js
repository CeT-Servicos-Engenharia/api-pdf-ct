// test-pdf-simple.js - Teste moderno para geração de PDF
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

async function createTestPDF() {
  try {
    console.log('🔄 Criando PDF de teste...');
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const { width, height } = page.getSize();
    
    // Adiciona texto ao PDF
    page.drawText('PDF de Teste - Gerado com Sucesso!', {
      x: 50,
      y: height - 100,
      size: 24,
      font: font,
      color: rgb(0, 0.53, 0.71),
    });
    
    page.drawText('Este PDF foi criado usando pdf-lib', {
      x: 50,
      y: height - 150,
      size: 16,
      font: font,
      color: rgb(0.2, 0.2, 0.2),
    });
    
    page.drawText(`Data: ${new Date().toLocaleString('pt-BR')}`, {
      x: 50,
      y: height - 200,
      size: 12,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Salva o PDF
    const pdfBytes = await pdfDoc.save();
    
    // Cria a pasta output se não existir
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'teste-pdf-moderno.pdf');
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log('✅ PDF criado com sucesso!');
    console.log(`📄 Arquivo salvo em: ${outputPath}`);
    
    return true;
  } catch (error) {
    console.error('❌ Erro ao criar PDF:', error.message);
    return false;
  }
}

// Executa o teste
createTestPDF()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Erro inesperado:', error);
    process.exit(1);
  });

