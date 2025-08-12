const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const admin = require("./lib/firebase-admin.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// --- Funções Auxiliares ---

async function baixarEComprimirTodasImagens(imageUrls) {
    if (!imageUrls || !Array.isArray(imageUrls)) return [];
    const compressedImages = [];
    for (const url of imageUrls) {
        if (!url) continue;
        try {
            const response = await axios.get(url, { responseType: "arraybuffer" });
            const imageBytes = Buffer.from(response.data, "binary");
            const optimizedBuffer = await sharp(imageBytes).resize({ width: 400 }).jpeg({ quality: 40 }).toBuffer();
            compressedImages.push({ url, buffer: optimizedBuffer });
        } catch (error) {
            console.error("Erro ao baixar/comprimir imagem:", url, error.message);
        }
    }
    return compressedImages;
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
    return clientDoc.exists ? clientDoc.data() : null;
}

async function getEngenieerData(engenieerId) {
    if (!engenieerId) return null;
    const engenieerDocRef = admin.firestore().doc(`engenieer/${engenieerId}`);
    const engenieerDoc = await engenieerDocRef.get();
    return engenieerDoc.exists ? engenieerDoc.data() : null;
}

async function getAnalystData(analystId) {
    if (!analystId) return null;
    const analystDocRef = admin.firestore().doc(`analyst/${analystId}`);
    const analystDoc = await analystDocRef.get();
    return analystDoc.exists ? analystDoc.data() : null;
}

// --- Função Principal de Geração do PDF ---

async function generatePDF(data, clientData, engenieerData, analystData) {
    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const logoPath = path.resolve(__dirname, "../assets/CET LOGO - TRANSPARENCIA(1).png");
    const logoBytes = fs.readFileSync(logoPath);
    const logoEmpresaImage = await pdfDoc.embedPng(logoBytes);

    let logoClienteImage = null;
    if (clientData?.logo) {
        try {
            const response = await axios.get(clientData.logo, { responseType: "arraybuffer" });
            const optimized = await sharp(response.data).resize(150).jpeg({ quality: 60 }).toBuffer();
            logoClienteImage = await pdfDoc.embedJpg(optimized);
        } catch (error) {
            console.error("Erro ao baixar logo do cliente:", error.message);
        }
    }

    const headerAssets = { logoEmpresaImage, logoClienteImage, helveticaFont, helveticaBoldFont };

    // --- Funções de Desenho (internas para manter o escopo) ---
    
    async function addHeader(page) {
        // ... (código da sua função addHeader, idêntico ao pressureVessel)
    }

    async function addFooter(page, pageNumber) {
        // ... (código da sua função addFooter, idêntico ao pressureVessel)
    }

    // --- Início da Construção das Páginas ---

    // Página 1: Capa
    const page1 = pdfDoc.addPage([595.28, 841.89]);
    page1.drawText(`Relatório de Inspeção: Caldeira`, { x: 160, y: 700, size: 24, font: helveticaBoldFont });
    
    if (data?.images?.[0]) {
        const imageBytes = await axios.get(data.images[0], { responseType: 'arraybuffer' }).then(res => res.data);
        const embeddedImage = await pdfDoc.embedJpg(imageBytes);
        page1.drawImage(embeddedImage, { x: 172, y: 420, width: 250, height: 250 });
    }

    page1.drawText(`Detalhes do Equipamento:`, { x: 50, y: 380, size: 16, font: helveticaBoldFont });
    page1.drawText(`Nome do equipamento:`, { x: 50, y: 350, size: 14, font: helveticaBoldFont });
    page1.drawText(`${data?.nomeEquipamento ?? 'Caldeira Flamotubular'}`, { x: 220, y: 350, size: 14, font: helveticaFont });
    page1.drawText(`Número de série:`, { x: 50, y: 320, size: 14, font: helveticaBoldFont });
    page1.drawText(`${data?.numeroSerie ?? 'N/C'}`, { x: 175, y: 320, size: 14, font: helveticaFont });
    page1.drawText(`Patrimônio/TAG:`, { x: 50, y: 290, size: 14, font: helveticaBoldFont });
    page1.drawText(`${data?.numeroPatrimonio ?? data?.tag ?? ''}`, { x: 180, y: 290, size: 14, font: helveticaFont });
    page1.drawText(`Fabricante:`, { x: 50, y: 260, size: 14, font: helveticaBoldFont });
    page1.drawText(`${data?.fabricante ?? ''}`, { x: 140, y: 260, size: 14, font: helveticaFont });
    
    page1.drawText(`${clientData?.person ?? ''}`, { x: 50, y: 200, size: 12, font: helveticaBoldFont });
    page1.drawText(`${clientData?.address ?? ''} CEP: ${clientData?.cep ?? ''}`, { x: 50, y: 185, size: 12, font: helveticaFont });
    page1.drawText(`CNPJ: ${clientData?.cnpj ?? ''}`, { x: 50, y: 170, size: 12, font: helveticaFont });
    page1.drawText(`FONE: ${clientData?.phone ?? ''}`, { x: 50, y: 155, size: 12, font: helveticaFont });

    // Adicione aqui a lógica para as outras páginas, replicando a lógica do pressure-vessel.
    // Esta é uma tarefa de copiar e colar as suas funções de desenho e adaptá-las.
    // Exemplo:
    // const page3 = pdfDoc.addPage();
    // await drawTableRegistrationData(page3, ...); // Você precisaria copiar a função drawTableRegistrationData para cá
    
    // Finalização: Adicionar cabeçalhos e rodapés
    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        await addHeader(page);
        await addFooter(page, i + 1);
    }

    return await pdfDoc.save();
}

// --- Handler de Exportação ---
async function generateBoilerPdf(projectId) {
    if (!projectId) {
        throw new Error("O parâmetro 'projectId' é obrigatório.");
    }
    try {
        const projectData = await getProjectData(projectId);
        const clientData = await getClientData(projectData.client || projectData.clientId);
        const engenieerData = await getEngenieerData(projectData.engenieer?.id || projectData.engenieerId);
        const analystData = await getAnalystData(projectData.analyst?.id || projectData.analystId);
        
        const pdfBytes = await generatePDF(projectData, clientData, engenieerData, analystData);
        
        return Buffer.from(pdfBytes);
    } catch (error) {
        console.error("Erro ao gerar o PDF da Caldeira:", error);
        throw new Error(`Erro ao gerar o PDF da Caldeira: ${error.message}`);
    }
}

module.exports = generateBoilerPdf;
