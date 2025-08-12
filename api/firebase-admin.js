// api/lib/firebase-admin.js

import admin from 'firebase-admin';

// Esta verificação garante que o código de inicialização rode apenas uma vez.
if (!admin.apps.length) {
  try {
    // As credenciais são lidas diretamente das Variáveis de Ambiente da Vercel.
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // Opcional, mas recomendado: adicione a URL do seu bucket do Storage.
      // storageBucket: 'seu-projeto.appspot.com' 
    });
    console.log('Firebase Admin SDK inicializado com sucesso.');
  } catch (error) {
    // Este log é crucial para depurar problemas de credenciais.
    console.error('ERRO FATAL: Falha ao inicializar o Firebase Admin SDK.', error);
  }
}

// Exporta a instância já inicializada para ser usada em outros lugares.
// Embora não seja importado diretamente com "from", executar este arquivo garante a inicialização.
export default admin;
