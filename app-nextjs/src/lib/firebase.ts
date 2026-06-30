import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth }      from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY            ?? '',
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN        ?? '',
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID         ?? '',
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET     ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID             ?? '',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);

// getAuth validates the API key at init time and throws auth/invalid-api-key
// when env vars are missing (e.g., during SSR without .env.local).
// Guard so the build succeeds — auth is only used on the client side.
let _auth: ReturnType<typeof getAuth> | null = null;
try { _auth = getAuth(app); } catch { /* env vars not set */ }
export const auth = _auth as ReturnType<typeof getAuth>;
