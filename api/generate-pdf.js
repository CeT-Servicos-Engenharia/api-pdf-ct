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
            compressedImages.push(null);
        }
    }
    return compressedImages.filter(Boolean);
}

async function downloadImageFromFirebase(url) {
    try {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        if (!response || !response.data) throw new Error("Imagem não encontrada ou vazia.");
        return response.data;
    } catch (error) {
        console.error("Erro ao baixar a imagem do Firebase:", error.message);
        throw new Error("Falha ao baixar a imagem.");
    }
}

async function addFirebaseImageToPDF(pdfDoc, page, imageUrl, options = {}) {
    try {
        if (!imageUrl || typeof imageUrl !== "string") {
            console.warn("URL da imagem inválida ou nula. Ignorando...");
            return;
        }
        const imageBytes = await downloadImageFromFirebase(imageUrl);
        if (!imageBytes) throw new Error("Bytes da imagem estão vazios.");
        
        const isPng = imageBytes[0] === 0x89 && imageBytes[1] === 0x50;
        const embeddedImage = isPng ? await pdfDoc.embedPng(imageBytes) : await pdfDoc.embedJpg(imageBytes);
        
        page.drawImage(embeddedImage, options);
    } catch (error) {
        console.error(`Erro ao adicionar a imagem do Firebase (${imageUrl}) ao PDF:`, error.message);
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

    // --- Funções de Desenho ---
    
    async function addHeader(page) {
        // ... (código da sua função addHeader, idêntico ao pressureVessel)
    }

    async function addFooter(page, pageNumber) {
        // ... (código da sua função addFooter, idêntico ao pressureVessel)
    }

    // --- Início da Construção das Páginas ---
    let countPages = 0;

    // Página 1: Capa
    const page1 = pdfDoc.addPage([595.28, 841.89]);
    countPages++;
    
    await addHeader(page1);

    page1.drawText(`Relatório de Inspeção: ${data?.tipoEquipamento ?? 'Caldeira'}`, {
        x: 115, y: 700, size: 24, font: helveticaBoldFont,
    });

    if (data?.images?.[0]) {
        await addFirebaseImageToPDF(pdfDoc, page1, data.images[0], { x: 172, y: 420, width: 250, height: 250 });
    }

    // ... (Restante do código de desenho da capa e das outras páginas) ...
    
    // Finalização
    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (i > 0) await addHeader(page);
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
