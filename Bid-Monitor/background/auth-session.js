/**
 * Bidder auth session — validates against Athens vendor access.
 * Requires: vendorAllowed ON + vendorPassword set + name+password match.
 */
const AuthSession = (() => {
  const AUTH_KEY = 'auth';

  async function getAuth() {
    const { [AUTH_KEY]: auth = null } = await chrome.storage.local.get(AUTH_KEY);
    return auth;
  }

  async function signIn(_username, password, options = {}) {
    const applierName = String(options.applierName || _username || '').trim();
    const pwd = String(password || '');

    if (!applierName) {
      return {
        ok: false,
        error: 'Profile name is required (your Athens Job Search profile name).',
      };
    }
    if (!pwd) {
      return {
        ok: false,
        error: 'Vendor access password is required.',
      };
    }

    const resolvedApiUrl = AthensApi.DEFAULT_API_URL;
    await AthensApi.saveSettings({
      applierName,
      apiUrl: resolvedApiUrl,
    });

    const result = await AthensApi.bidderSignIn(applierName, pwd, resolvedApiUrl);
    if (!result.ok) {
      return { ok: false, error: result.error || 'Sign in failed.', code: result.code };
    }

    const displayName = String(result.user?.name || applierName).trim() || applierName;
    const auth = {
      profileName: displayName.toLowerCase().replace(/\s+/g, '-'),
      displayName,
      applierName: displayName,
      accountId: result.user?._id ? String(result.user._id) : null,
      role: 'bidder',
      signedInAt: new Date().toISOString(),
      source: 'athens',
    };
    await chrome.storage.local.set({ [AUTH_KEY]: auth });
    await AthensApi.saveSettings({ applierName: displayName, apiUrl: resolvedApiUrl });

    return { ok: true, auth, pools: null, athensError: null, deferredQueue: true };
  }

  async function signOut() {
    await chrome.storage.local.remove(AUTH_KEY);
    return { ok: true };
  }

  return { AUTH_KEY, getAuth, signIn, signOut };
})();
