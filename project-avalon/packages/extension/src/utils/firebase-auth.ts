import { DEFAULT_ATHENS_API_URL, FIREBASE_AUTH_KEY, FIREBASE_WEB_API_KEY } from './constants';

type StoredAuth = { idToken: string; refreshToken: string; expiresAt: number; email: string };

async function readAuth(): Promise<StoredAuth | null> {
  const stored = await browser.storage.local.get(FIREBASE_AUTH_KEY);
  return (stored[FIREBASE_AUTH_KEY] as StoredAuth | undefined) || null;
}

async function refresh(auth: StoredAuth): Promise<StoredAuth> {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Firebase token refresh failed');
  const next = { ...auth, idToken: data.id_token, refreshToken: data.refresh_token || auth.refreshToken, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  await browser.storage.local.set({ [FIREBASE_AUTH_KEY]: next });
  return next;
}

export async function getFirebaseIdToken(): Promise<string> {
  let auth = await readAuth();
  if (!auth) return '';
  if (auth.expiresAt - Date.now() < 60_000) auth = await refresh(auth);
  return auth.idToken;
}

export async function signInFirebase(email: string, password: string): Promise<{ profileId: string }> {
  if (!FIREBASE_WEB_API_KEY) throw new Error('Firebase web API key is missing from the extension build');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Firebase sign in failed');
  const auth: StoredAuth = { idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000, email: data.email };
  const sessionResponse = await fetch(`${DEFAULT_ATHENS_API_URL.replace(/\/$/, '')}/auth/session`, { headers: { Authorization: `Bearer ${auth.idToken}` } });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || !session?.user?.profileId) throw new Error(session?.error || 'This account has no Athens profile grant');
  await browser.storage.local.set({ [FIREBASE_AUTH_KEY]: auth });
  return { profileId: String(session.user.profileId) };
}

export async function signOutFirebase() {
  await browser.storage.local.remove(FIREBASE_AUTH_KEY);
}
