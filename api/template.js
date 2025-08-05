import { PDFDocument } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
const admin = require("firebase-admin");

async function createTemplate() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);

  // Cabeçalho
  async function addHeader(pdfDoc, page, clientData) {
    try {
      const logoPath = path.resolve(
        __dirname,
        "../assets/CET LOGO - TRANSPARENCIA.png"
      );
      const logoBytes = fs.readFileSync(logoPath);
      const logoImage = await pdfDoc.embedPng(logoBytes);

      page.drawImage(logoImage, {
        x: 60,
        y: 740,
        width: 80,
        height: 80,
      });

      if (clientData && clientData.logo) {
        console.log("Log da imagem do cliente:", clientData.logo);
        await addFirebaseImageToPDF(pdfDoc, page, clientData.logo, {
          x: 448,
          y: 740,
          width: 80,
          height: 80,
        });
      } else {
        console.warn(
          "Logo do cliente não fornecida ou clientData não definido."
        );
      }

      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBoldFont = await pdfDoc.embedFont(
        StandardFonts.HelveticaBold
      );

      page.drawText("Cleonis Batista Santos", {
        x: 242,
        y: 790,
        size: 10,
        font: helveticaBoldFont,
      });
      page.drawText("Avenida Sábia Q:30 L:27, 27, CEP 75904-370", {
        x: 191,
        y: 780,
        size: 10,
        font: helveticaFont,
      });
      page.drawText("(64) 99244-2480, engenheiro@gmail.com", {
        x: 197,
        y: 770,
        size: 10,
        font: helveticaFont,
      });
    } catch (error) {
      console.error("Erro ao carregar o cabeçalho:", error.message);
    }
  }

  async function getProjectData(projectId) {
    const db = admin.firestore();
    const doc = await db.collection("inspections").doc(projectId).get();
    if (!doc.exists) throw new Error("Projeto não encontrado");
    return doc.data();
  }

  const projectData = await getProjectData(projectId);
  const clientData = await getClientData(
    projectData.client || projectData.clientId
  );

  await addHeader(pdfDoc, page, clientData);

  // Salve o template no arquivo
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync('template.pdf', pdfBytes);
}

createTemplate();