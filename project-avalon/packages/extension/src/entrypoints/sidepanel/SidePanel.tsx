import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SESSION_ID, type RegisteredPayload } from '@avalon/shared';
import {
  AVALON_SESSION_KEY,
  AVALON_PROFILE_KEY,
  DEFAULT_SERVER_URL,
  DEFAULT_ATHENS_API_URL,
  FIREBASE_WEB_API_KEY,
  EXTENSION_MESSAGES,
  RELAY_KEEPALIVE_PORT,
} from '../../utils/constants';
import { relayHttpBase } from '../../utils/endpoint';
import { saveRelayConfig } from '../../utils/relay';
import {
  relaySessionKey,
  selectRelaySession,
  type DiscoverableRelaySession,
} from '../../utils/session-selection';

type PanelNotification = {
  id: string;
  title?: string;
  message: string;
  kind: 'error' | 'warning' | 'info';
};

type DiscoverableSession = DiscoverableRelaySession;

function sessionKey(s: DiscoverableSession): string {
  return relaySessionKey(s);
}

function sessionDisplayLabel(s: DiscoverableSession): string {
  const id = sessionKey(s);
  const short = id.length > 12 ? `${id.slice(0, 12)}…` : id;
  const name = s.label?.trim();
  const controller = s.peers?.controller ? 'controller online' : 'waiting for Athens';
  return name ? `${name} · ${short}` : `${short} · ${controller}`;
}

/** Strip hosts / IPs / URLs from messages shown in the side panel. */
function redactHostInfo(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[server]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[host]');
}

export default function SidePanel() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [sessionId, setSessionId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [connected, setConnected] = useState(false);
  const [registered, setRegistered] = useState<RegisteredPayload | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<PanelNotification[]>([]);
  const seenErrorRef = useRef<string | null>(null);
  const autoConnectedSessionRef = useRef<string | null>(null);
  const connectRef = useRef<() => Promise<void>>(async () => {});

  const [signinName, setSigninName] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [signinLoading, setSigninLoading] = useState(false);
  const [signinError, setSigninError] = useState<string | null>(null);

  const [availableSessions, setAvailableSessions] = useState<DiscoverableSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const pushNotification = useCallback((notification: Omit<PanelNotification, 'id'>) => {
    const item = { ...notification, id: `${Date.now()}_${Math.random()}` };
    setNotifications((prev) => [...prev, item]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== item.id));
    }, notification.kind === 'error' ? 12000 : 7000);
  }, []);

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const refreshStatus = useCallback(async () => {
    try {
      const status = (await browser.runtime.sendMessage({
        type: EXTENSION_MESSAGES.RELAY_STATUS,
        config: { serverUrl, sessionId: sessionId || undefined, profileId: profileId || undefined },
      })) as { connected?: boolean; lastError?: string | null };
      const isConnected = Boolean(status?.connected);
      setConnected(isConnected);
      const err = isConnected ? null : (status?.lastError ?? null);
      const safeErr = err ? redactHostInfo(err) : null;
      setLastError(safeErr);
      if (isConnected) {
        seenErrorRef.current = null;
        setNotifications((prev) => prev.filter((n) => n.kind !== 'error'));
        return;
      }
      if (safeErr && safeErr !== seenErrorRef.current) {
        seenErrorRef.current = safeErr;
        pushNotification({ kind: 'error', title: 'Relay offline', message: safeErr });
      }
      if (!err) seenErrorRef.current = null;
    } catch {
      setConnected(false);
    }
  }, [pushNotification, serverUrl, sessionId, profileId]);

  const refreshSessions = useCallback(async () => {
    if (!profileId) {
      setAvailableSessions([]);
      setSessionsError(null);
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const url = `${relayHttpBase(serverUrl)}/sessions?profileId=${encodeURIComponent(profileId)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Relay returned ${res.status}`);
      const data = (await res.json()) as { ok?: boolean; active?: DiscoverableSession[] };
      const list = Array.isArray(data.active) ? data.active : [];
      // Prefer rooms that have an Athens controller online (created sessions).
      const withController = list.filter((s) => s.peers?.controller);
      const ordered = withController.slice().sort((a, b) => {
        const la = (a.label || sessionKey(a)).localeCompare(b.label || sessionKey(b));
        return la;
      });
      setAvailableSessions(ordered);

      // Exactly one live controller is unambiguous. Multiple live controllers
      // require an explicit choice instead of silently pairing the first one.
      setSessionId((prev) => {
        return selectRelaySession(prev, ordered);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load sessions';
      setSessionsError(redactHostInfo(message));
      setAvailableSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [profileId, serverUrl]);

  useEffect(() => {
    // Always use the build-time default relay URL — never expose or edit it in the UI.
    setServerUrl(DEFAULT_SERVER_URL);
    void browser.storage.local
      .get([AVALON_SESSION_KEY, AVALON_PROFILE_KEY])
      .then((stored) => {
        const savedSession = stored[AVALON_SESSION_KEY] as string | undefined;
        const savedProfile = stored[AVALON_PROFILE_KEY] as string | undefined;
        if (savedSession) setSessionId(savedSession);
        if (savedProfile) setProfileId(savedProfile);
      });
  }, []);

  useEffect(() => {
    // Keep the MV3 service worker alive while the side panel is open so Socket.IO
    // can finish connecting (otherwise the worker sleeps mid-handshake).
    const port = browser.runtime.connect({ name: RELAY_KEEPALIVE_PORT });
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 2500);
    return () => {
      clearInterval(timer);
      port.disconnect();
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (!profileId) return;
    void refreshSessions();
    const timer = window.setInterval(() => void refreshSessions(), 4000);
    return () => clearInterval(timer);
  }, [profileId, refreshSessions]);

  const selectedInList = useMemo(
    () => availableSessions.some((s) => sessionKey(s) === sessionId),
    [availableSessions, sessionId],
  );

  const connect = async () => {
    if (!profileId) {
      pushNotification({ kind: 'error', title: 'Sign in required', message: 'Enter your Athens name + password.' });
      return;
    }
    if (!sessionId.trim()) {
      pushNotification({
        kind: 'error',
        title: 'No session selected',
        message: 'Open Agents in Athens to create a session, then pick it here.',
      });
      return;
    }

    await saveRelayConfig(serverUrl, sessionId || undefined, profileId);
    try {
      const response = (await browser.runtime.sendMessage({
        type: EXTENSION_MESSAGES.RELAY_CONNECT,
        config: { serverUrl, sessionId: sessionId || undefined, profileId },
      })) as { ok?: boolean; registered?: RegisteredPayload; error?: string };

      if (response?.error) {
        pushNotification({
          kind: 'error',
          title: 'Connect failed',
          message: redactHostInfo(response.error),
        });
        setConnected(false);
        return;
      }

      if (response?.registered) {
        setRegistered(response.registered);
        setSessionId(response.registered.sessionId);
        setConnected(true);
        setLastError(null);
        pushNotification({
          kind: 'info',
          title: 'Relay connected',
          message: `Session ${response.registered.sessionId}`,
        });
      }
      await refreshStatus();
      await refreshSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connect failed';
      pushNotification({
        kind: 'error',
        title: 'Connect failed',
        message: redactHostInfo(message),
      });
      setConnected(false);
    }
  };
  connectRef.current = connect;

  useEffect(() => {
    if (!profileId || connected || availableSessions.length !== 1) return;
    const onlySession = sessionKey(availableSessions[0]);
    if (!onlySession || sessionId !== onlySession || autoConnectedSessionRef.current === onlySession) return;
    autoConnectedSessionRef.current = onlySession;
    void connectRef.current();
  }, [availableSessions, connected, profileId, sessionId]);

  const signIn = async () => {
    const name = signinName.trim();
    const password = signinPassword;
    if (!name || !password) {
      setSigninError('Enter both name and password.');
      return;
    }

    setSigninLoading(true);
    setSigninError(null);
    try {
      const base = DEFAULT_ATHENS_API_URL.replace(/\/$/, '');
      let id = '';
      if (FIREBASE_WEB_API_KEY) {
        const authResponse = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: name, password, returnSecureToken: true }),
          },
        );
        const authData = (await authResponse.json().catch(() => ({}))) as {
          idToken?: string;
          error?: { message?: string };
        };
        if (!authResponse.ok || !authData.idToken) {
          throw new Error(authData.error?.message || 'Firebase sign in failed');
        }
        const sessionResponse = await fetch(`${base}/auth/session`, {
          headers: { Authorization: `Bearer ${authData.idToken}` },
          cache: 'no-store',
        });
        const sessionData = (await sessionResponse.json().catch(() => ({}))) as {
          success?: boolean;
          user?: { profileId?: unknown };
          profiles?: Array<{ profileId?: unknown; primary?: boolean }>;
          message?: string;
        };
        const primary = sessionData.profiles?.find((profile) => profile.primary) || sessionData.profiles?.[0];
        id = String(sessionData.user?.profileId || primary?.profileId || '');
        if (!sessionResponse.ok || !sessionData.success || !id) {
          throw new Error(sessionData.message || 'This account has no Athens profile grant');
        }
      } else {
        const response = await fetch(`${base}/auth/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          user?: { _id?: unknown };
          message?: string;
        };
        if (!response.ok || !data?.success || data.user?._id == null) {
          throw new Error(data?.message || 'Sign in failed');
        }
        id = String(data.user._id);
      }
      setProfileId(id);
      setSessionId('');
      autoConnectedSessionRef.current = null;
      await browser.storage.local.set({ [AVALON_PROFILE_KEY]: id });
      setSigninPassword('');
      pushNotification({ kind: 'info', title: 'Signed in', message: 'Profile connected to Avalon relay.' });
      await refreshStatus();
    } catch (error: unknown) {
      const message = redactHostInfo(
        error instanceof Error ? error.message : 'Sign in failed',
      );
      setSigninError(message);
      pushNotification({ kind: 'error', title: 'Sign in failed', message });
    } finally {
      setSigninLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await browser.runtime.sendMessage({ type: EXTENSION_MESSAGES.RELAY_DISCONNECT });
    } catch {
      /* ignore */
    }
    await browser.storage.local.remove([AVALON_PROFILE_KEY]);
    setProfileId('');
    setConnected(false);
    setRegistered(null);
    setLastError(null);
    setAvailableSessions([]);
    setSessionsError(null);
    setSigninName('');
    setSigninPassword('');
    setSigninError(null);
    pushNotification({ kind: 'info', title: 'Signed out', message: 'Athens profile cleared from this extension.' });
  };

  const disconnect = async () => {
    await browser.runtime.sendMessage({ type: EXTENSION_MESSAGES.RELAY_DISCONNECT });
    setConnected(false);
    setRegistered(null);
    setLastError(null);
  };

  const copySessionId = async () => {
    const id = registered?.sessionId ?? sessionId;
    if (!id) return;
    await navigator.clipboard.writeText(id);
    pushNotification({ kind: 'info', title: 'Copied', message: 'Session ID copied to clipboard.' });
  };

  return (
    <div className="sidepanel">
      <div className="sidepanel-header">
        <div className="sidepanel-logo" aria-hidden>
          <img src="/logo.png" alt="" width={40} height={40} />
        </div>
        <div className="sidepanel-brand">
          <h1>Project Avalon</h1>
          <p>Extension relay · Athens design</p>
        </div>
      </div>

      {notifications.length > 0 && (
        <div className="notification-stack" role="status" aria-live="polite">
          {notifications.map((item) => (
            <div key={item.id} className={`notification notification-${item.kind}`}>
              <div className="notification-icon" aria-hidden>
                {item.kind === 'error' ? '!' : 'i'}
              </div>
              <div className="notification-body">
                {item.title && <p className="notification-title">{item.title}</p>}
                <p className="notification-message">{item.message}</p>
              </div>
              <button
                type="button"
                className="notification-dismiss"
                onClick={() => dismissNotification(item.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="panel-card">
        <p className="hint">
          Sign in, open a session in Athens Agents, then select it here — no typing session IDs.
        </p>

        {!profileId && (
          <div className={`status-card ${signinError ? 'error' : ''}`}>
            <div className="status-label">Sign in (no signup)</div>

            <label htmlFor="signin-name">{FIREBASE_WEB_API_KEY ? 'Athens email' : 'Athens name'}</label>
            <input
              id="signin-name"
              value={signinName}
              onChange={(e) => setSigninName(e.target.value)}
              placeholder={FIREBASE_WEB_API_KEY ? 'you@example.com' : 'Your Athens login name'}
              disabled={signinLoading}
            />

            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              value={signinPassword}
              onChange={(e) => setSigninPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              disabled={signinLoading}
            />

            {signinError && <div>{signinError}</div>}

            <div className="button-row" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => void signIn()} disabled={signinLoading}>
                {signinLoading ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </div>
        )}

        {profileId && (
          <div className="status-card connected" style={{ marginBottom: 12 }}>
            <div className="status-label">Signed in</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Profile <code>{profileId.slice(0, 10)}…</code>
            </div>
            <div className="button-row" style={{ marginTop: 8 }}>
              <button className="secondary" type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="session-select">Athens session</label>
          <div className="button-row" style={{ marginBottom: 6 }}>
            <button
              className="secondary"
              type="button"
              onClick={() => void refreshSessions()}
              disabled={!profileId || sessionsLoading}
            >
              {sessionsLoading ? 'Refreshing…' : 'Refresh sessions'}
            </button>
          </div>
          <select
            id="session-select"
            value={selectedInList ? sessionId : ''}
            onChange={(e) => setSessionId(e.target.value)}
            disabled={!profileId}
          >
            <option value="">
              {availableSessions.length === 0
                ? 'No Athens sessions online — open Agents'
                : 'Select a session…'}
            </option>
            {availableSessions.map((s) => {
              const id = sessionKey(s);
              return (
                <option key={id} value={id}>
                  {sessionDisplayLabel(s)}
                </option>
              );
            })}
          </select>
          {sessionsError && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--destructive, #b91c1c)' }}>
              {sessionsError}
            </div>
          )}
          {sessionId && (
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75 }}>
              ID <code>{sessionId}</code>
              {!selectedInList && ' (not in live list — refresh after opening Athens)'}
            </div>
          )}
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Fallback shared lane: <code>{DEFAULT_SESSION_ID}</code> only if Athens has no named
            session open.
          </p>
        </div>

        <div
          className={`status-card ${connected ? 'connected' : lastError ? 'error' : ''}`}
        >
          <div className="status-label">{connected ? 'Connected' : 'Disconnected'}</div>
          {lastError && !connected && <div>{lastError}</div>}
          {registered && (
            <>
              Session: <code>{registered.sessionId}</code>
              <br />
              Controller: {registered.peers.controller ? 'online' : 'waiting…'}
            </>
          )}
        </div>

        <div className="button-row">
          <button type="button" onClick={() => void connect()} disabled={!profileId || !sessionId}>
            {connected ? 'Reconnect' : 'Connect'}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => void copySessionId()}
            disabled={!sessionId && !registered}
          >
            Copy session ID
          </button>
          <button className="secondary" type="button" onClick={() => void disconnect()} disabled={!connected}>
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
