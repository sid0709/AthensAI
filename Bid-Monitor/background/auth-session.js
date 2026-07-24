/** Firebase Auth session for separate bidder identities with explicit profile grants. */
const AuthSession = (() => {
  const AUTH_KEY = 'auth';

  function apiKey() {
    return String(BidMonitorConfig?.FIREBASE_WEB_API_KEY || '').trim();
  }

  async function rawAuth() {
    const { [AUTH_KEY]: auth = null } = await chrome.storage.local.get(AUTH_KEY);
    return auth;
  }

  async function refresh(auth) {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || 'Firebase session refresh failed.');
    const next = {
      ...auth,
      idToken: data.id_token,
      refreshToken: data.refresh_token || auth.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    await chrome.storage.local.set({ [AUTH_KEY]: next });
    return next;
  }

  async function getAuth() {
    const auth = await rawAuth();
    if (!auth) return null;
    if (Number(auth.expiresAt || 0) - Date.now() < 60_000) {
      try { return await refresh(auth); } catch { await signOut(); return null; }
    }
    return auth;
  }

  async function getIdToken() {
    return String((await getAuth())?.idToken || '');
  }

  async function signIn(email, password) {
    if (!apiKey()) return { ok: false, error: 'Firebase web API key is missing from the extension package.' };
    if (!String(email || '').trim() || !password) return { ok: false, error: 'Email and password are required.' };
    try {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(email).trim(), password: String(password), returnSecureToken: true }),
      });
      const tokenData = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(tokenData?.error?.message || 'Firebase sign in failed.');
      const sessionResponse = await fetch(`${AthensApi.DEFAULT_API_URL}/auth/session`, {
        headers: { Authorization: `Bearer ${tokenData.idToken}` },
      });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || !session?.user) throw new Error(session?.error || 'No Athens profile is granted to this bidder.');
      const profile = session.profiles?.find((grant) => grant.primary) || session.profiles?.[0];
      if (!profile || String(session.user.role || profile.role || '').toLowerCase() !== 'bidder') {
        throw new Error('This Firebase account is not a bidder identity.');
      }
      const displayName = String(profile.profileName || profile.applierName || session.user.name).trim();
      const auth = {
        profileName: displayName.toLowerCase().replace(/\s+/g, '-'),
        displayName,
        applierName: displayName,
        accountId: String(profile.profileId || session.user.profileId || ''),
        uid: tokenData.localId,
        email: tokenData.email,
        role: 'bidder',
        idToken: tokenData.idToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: Date.now() + Number(tokenData.expiresIn || 3600) * 1000,
        signedInAt: new Date().toISOString(),
        source: 'firebase',
      };
      await chrome.storage.local.set({ [AUTH_KEY]: auth });
      await AthensApi.saveSettings({ applierName: displayName, email: auth.email });
      return { ok: true, auth, pools: null, athensError: null, deferredQueue: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'FIREBASE_AUTH' };
    }
  }

  async function signOut() {
    await chrome.storage.local.remove(AUTH_KEY);
    return { ok: true };
  }

  return { AUTH_KEY, getAuth, getIdToken, signIn, signOut };
})();
