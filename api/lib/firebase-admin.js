const admin = require('firebase-admin');

// Este bloco só roda uma vez em toda a aplicação.
if (!admin.apps.length) {
  try {
    console.log("Inicializando Firebase a partir de variáveis de ambiente...");

    // Lê as variáveis de ambiente configuradas na Vercel
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const projectId = process.env.GOOGLE_PROJECT_ID;

    if (!privateKey || !clientEmail || !projectId) {
      throw new Error('Variáveis de ambiente do Firebase não foram encontradas. Verifique as configurações na Vercel.');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        privateKey: privateKey.replace(/\\n/g, '\n'), // Garante que as quebras de linha sejam formatadas corretamente
        clientEmail,
        projectId
      })
    });

    console.log('✅ Firebase inicializado com sucesso!');

  } catch (error) {
    console.error('❌ Erro fatal ao inicializar o Firebase:', error.message);
    // Lançar o erro impede que a aplicação continue sem o Firebase
    throw error;
  }
}

// Exporta a instância do admin já inicializada
module.exports = admin;

