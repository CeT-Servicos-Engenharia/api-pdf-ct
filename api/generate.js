
// api/generate-pdf.js  (CommonJS)  — Corrigido
// - Inicializa Firebase Admin com variáveis FIREBASE_* ou GOOGLE_*
// - Gera PDF com pdf-lib
// - Lê dados do Firestore se possível, mas SEM travar o PDF caso falhe

const admin = require('firebase-admin');
const { PDFDocument, StandardFonts } = require('pdf-lib');

function pick(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).length) return v;
  }
  return undefined;
}

function ensureFirebase() {
  if (admin.apps.length) return admin;

  let projectId   = pick('FIREBASE_PROJECT_ID', 'GOOGLE_PROJECT_ID', 'GCLOUD_PROJECT');
  let clientEmail = pick('FIREBASE_CLIENT_EMAIL', 'GOOGLE_CLIENT_EMAIL');
  let privateKey  = pick('FIREBASE_PRIVATE_KEY', 'GOOGLE_PRIVATE_KEY');

  if (!privateKey || !clientEmail || !projectId) {
    console.warn('[generate-pdf] Variáveis de ambiente do Firebase ausentes — seguindo sem Firestore.');
    return admin; // sem inicializar
  }

  // remove aspas externas se existirem e restaura quebras de linha
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, '\n');

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    databaseURL: process.env.FIREBASE_DATABASE_URL || undefined
  });

  console.log('[generate-pdf] Firebase inicializado.');
  return admin;
}

module.exports = async function generateBoilerPdf(projectId) {
  // 1) (Opcional) Buscar dados do Firestore
  let projeto = {};
  try {
    const a = ensureFirebase();
    if (a.apps.length && projectId) {
      const db = a.firestore();
      const snap = await db.collection('projects').doc(projectId).get();
      if (snap.exists) {
        projeto = snap.data() || {};
      } else {
        console.warn(`[generate-pdf] Documento 'projects/${projectId}' não encontrado.`);
      }
    }
  } catch (err) {
    console.warn('[generate-pdf] Falha ao ler Firestore:', err && err.message ? err.message : err);
  }

  // 2) Montar PDF simples (pode ser substituído pelo layout completo depois)
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  function text(x, y, s, size=12) {
    page.drawText(String(s ?? ''), { x, y, size, font });
  }

  text(60, height - 80, 'Relatório de Caldeira (Boiler)', 18);
  text(60, height - 110, `projectId: ${projectId || '-'}`);
  if (projeto && Object.keys(projeto).length) {
    text(60, height - 140, 'Dados do projeto:');
    const linhas = [
      `Cliente: ${projeto.clientName || projeto.cliente || '-'}`,
      `Equipamento: ${projeto.equipment || projeto.equipamento || '-'}`,
      `Local: ${projeto.site || projeto.local || '-'}`
    ];
    let y = height - 160;
    for (const linha of linhas) {
      text(60, y, linha);
      y -= 16;
    }
  } else {
    text(60, height - 140, 'Não foi possível carregar dados do Firestore (ou não existem).');
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
};
