
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Inicializar o Firebase com a chave de ambiente
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!privateKey) {
  console.error("❌ GOOGLE_PRIVATE_KEY não carregada.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.GOOGLE_PROJECT_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey: privateKey
  })
});

console.log("✅ Firebase inicializado com sucesso!");

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function createSamplePDF() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  const { width, height } = page.getSize();
  const fontSize = 30;
  page.drawText('PDF de teste gerado com sucesso!', {
    x: 50,
    y: height - 100,
    size: fontSize,
    font: timesRomanFont,
    color: rgb(0, 0.53, 0.71),
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(__dirname, 'output', 'teste-gerado.pdf'), pdfBytes);
  console.log('✅ PDF gerado com sucesso em ./output/teste-gerado.pdf');
}

createSamplePDF();
