
require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const projectId = process.env.GOOGLE_PROJECT_ID;

if (!privateKey || !clientEmail || !projectId) {
  console.error('❌ Variáveis de ambiente faltando. Verifique o .env.local');
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  console.log('✅ Firebase inicializado com sucesso!');
} catch (error) {
  console.error('❌ Erro ao inicializar o Firebase:', error.message);
}
