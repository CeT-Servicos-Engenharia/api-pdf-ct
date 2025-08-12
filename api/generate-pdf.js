
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

// Carrega as variáveis de ambiente do arquivo .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

try {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const projectId = process.env.GOOGLE_PROJECT_ID;

  if (!privateKey || !clientEmail || !projectId) {
    throw new Error('Uma ou mais variáveis de ambiente estão faltando.');
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      privateKey,
      clientEmail,
      projectId
    })
  });

  console.log('✅ Firebase inicializado com sucesso!');

  // TODO: Coloque aqui o restante da lógica de geração de PDF
} catch (error) {
  console.error('❌ Erro ao inicializar o Firebase:', error.message);
}
