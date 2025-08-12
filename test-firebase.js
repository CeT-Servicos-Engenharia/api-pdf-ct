// test-firebase.js - Teste moderno para verificar a conexão com o Firebase
import admin from './api/lib/firebase-admin.js';

async function testFirebaseConnection() {
  try {
    console.log('🔄 Testando conexão com o Firebase...');
    
    // Testa a conexão com o Firestore
    const db = admin.firestore();
    const testDoc = await db.collection('test').limit(1).get();
    
    console.log('✅ Conexão com o Firebase estabelecida com sucesso!');
    console.log(`📊 Firestore acessível. Documentos encontrados: ${testDoc.size}`);
    
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar com o Firebase:', error.message);
    return false;
  }
}

// Executa o teste
testFirebaseConnection()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('❌ Erro inesperado:', error);
    process.exit(1);
  });

