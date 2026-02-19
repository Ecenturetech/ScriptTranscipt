/**
 * Middleware de autenticação Firebase.
 * Valida o token JWT do Firebase enviado no header Authorization.
 * Usa as mesmas credenciais do CTB Web Admin (Firebase project ctb-bayer-staging).
 */

import admin from 'firebase-admin';

let authInitialized = false;

function initFirebase() {
  if (authInitialized) return;

  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      authInitialized = true;
    } catch (e) {
      console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT inválido. Auth desabilitado.');
    }
  } else if (serviceAccountPath) {
    try {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
      authInitialized = true;
    } catch (e) {
      console.warn('⚠️  GOOGLE_APPLICATION_CREDENTIALS não configurado corretamente. Auth desabilitado.');
    }
  } else {
    console.warn('⚠️  Firebase não configurado (GOOGLE_APPLICATION_CREDENTIALS ou FIREBASE_SERVICE_ACCOUNT). Rotas protegidas aceitarão qualquer requisição.');
  }
}

/**
 * Middleware que exige token Firebase válido.
 * Se DISABLE_AUTH=1, ignora a validação (apenas para desenvolvimento local).
 */
export function requireAuth(req, res, next) {
  if (process.env.DISABLE_AUTH === '1') {
    return next();
  }

  initFirebase();

  if (!authInitialized) {
    return next(); // Se não configurado, permite (para compatibilidade)
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação ausente' });
  }

  const token = authHeader.split('Bearer ')[1];

  admin
    .auth()
    .verifyIdToken(token)
    .then((decodedToken) => {
      req.user = decodedToken;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'Token inválido ou expirado' });
    });
}
