const admin = require('firebase-admin');

// Este bloco garante que o Firebase seja inicializado apenas uma vez.
if (!admin.apps.length) {
  try {
    console.log("Inicializando Firebase a partir da variável de ambiente 'FIREBASE_CREDENTIALS'...");

    // ✅ CORRIGIDO: Lê a única variável de ambiente que você configurou na Vercel.
    const serviceAccountString = process.env.FIREBASE_CREDENTIALS;

    if (!serviceAccountString) {
      throw new Error("A variável de ambiente 'FIREBASE_CREDENTIALS' não foi encontrada ou está vazia. Verifique as configurações na Vercel.");
    }

    // Converte a string JSON da variável de ambiente em um objeto JavaScript
    const serviceAccount = JSON.parse(serviceAccountString);

    // Inicializa o Firebase com o objeto de credenciais completo
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log('✅ Firebase inicializado com sucesso via variável de ambiente!');

  } catch (error) {
    console.error('❌ Erro fatal ao inicializar o Firebase:', error.message);
    // Lançar o erro impede que a aplicação continue se o Firebase não inicializar.
    throw error;
  }
}

// Exporta a instância do admin já pronta para ser usada em qualquer lugar.
module.exports = admin;
