import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim(),
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);

const app = getApps().length
  ? getApp()
  : initializeApp(
      firebaseConfigured
        ? firebaseConfig
        : {
            apiKey: "firebase-not-configured",
            authDomain: "localhost",
            projectId: "firebase-not-configured",
            appId: "firebase-not-configured",
          },
    );

export const firebaseAuth = getAuth(app);

export async function getFirebaseIdToken(forceRefresh = false): Promise<string> {
  const current = firebaseAuth.currentUser;
  return current ? current.getIdToken(forceRefresh) : "";
}
