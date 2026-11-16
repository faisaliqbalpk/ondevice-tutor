import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getAuth, signInAnonymously, type User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const env = import.meta.env;

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

// App Check is required by Firebase AI Logic.
// Debug tokens are only read in dev builds, so they never ship to the hosted app.
if (env.DEV && (env.VITE_APPCHECK_DEBUG_TOKEN || env.VITE_APPCHECK_DEBUG === 'true')) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
if (env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// Offline-first: Firestore keeps a local cache so student profiles work without a network.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(firebaseApp);

let anonPromise: Promise<User> | null = null;

/**
 * Resolves with the signed-in user, signing in anonymously once if needed.
 * Memoized so concurrent callers (React StrictMode runs effects twice) never create
 * two anonymous users, which would leave listeners on the wrong user's path.
 */
export function waitForUser(): Promise<User> {
  anonPromise ??= (async () => {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    return cred.user;
  })().catch((e) => {
    anonPromise = null;
    throw e;
  });
  return anonPromise;
}

/** Lets the next waitForUser() start a fresh anonymous session (after sign-out). */
export function resetAnonymousSession() {
  anonPromise = null;
}
