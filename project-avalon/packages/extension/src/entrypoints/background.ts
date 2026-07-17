import { DEFAULT_SESSION_ID } from '@avalon/shared';
import {
  AVALON_SERVER_KEY,
  AVALON_SESSION_KEY,
  AVALON_PROFILE_KEY,
  DEFAULT_SERVER_URL,
  EXTENSION_MESSAGES,
  RELAY_KEEPALIVE_PORT,
} from '../utils/constants';
import {
  disconnectRelay,
  ensureRelayConnected,
  getRelayLastError,
  getRelaySocket,
  readStoredRelayError,
  waitForRelayRegistration,
} from '../utils/relay';

const RELAY_ALARM = 'avalon-relay-heartbeat';
const keepalivePorts = new Set<Browser.runtime.Port>();

async function autoConnectRelay() {
  const stored = await browser.storage.local.get([AVALON_SERVER_KEY, AVALON_SESSION_KEY, AVALON_PROFILE_KEY]);
  const serverUrl = (stored[AVALON_SERVER_KEY] as string | undefined) ?? DEFAULT_SERVER_URL;
  const sessionId = (stored[AVALON_SESSION_KEY] as string | undefined) ?? DEFAULT_SESSION_ID;
  const profileId = stored[AVALON_PROFILE_KEY] as string | undefined;
  await ensureRelayConnected({ serverUrl, sessionId, profileId });
}

function bindRelayKeepalive() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RELAY_KEEPALIVE_PORT) return;
    keepalivePorts.add(port);
    void ensureRelayConnected();
    port.onDisconnect.addListener(() => {
      keepalivePorts.delete(port);
    });
  });
}

function bindRelayAlarm() {
  void browser.alarms.create(RELAY_ALARM, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RELAY_ALARM) return;
    void ensureRelayConnected();
  });
}

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  bindRelayKeepalive();
  bindRelayAlarm();

  browser.runtime.onInstalled.addListener(() => {
    void autoConnectRelay();
  });

  browser.runtime.onStartup.addListener(() => {
    void autoConnectRelay();
  });

  void autoConnectRelay();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === EXTENSION_MESSAGES.RELAY_CONNECT) {
      const config = message.config as { serverUrl?: string; sessionId?: string; profileId?: string } | undefined;
      void waitForRelayRegistration(config)
        .then((registered) => {
          sendResponse({ ok: true, registered });
        })
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : getRelayLastError() ?? 'Relay connection failed';
          sendResponse({ ok: false, error: msg });
        });
      return true;
    }

    if (message?.type === EXTENSION_MESSAGES.RELAY_DISCONNECT) {
      disconnectRelay();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === EXTENSION_MESSAGES.RELAY_STATUS) {
      const config = message.config as { serverUrl?: string; sessionId?: string; profileId?: string } | undefined;
      void ensureRelayConnected(config)
        .then(async () => {
          const socket = getRelaySocket();
          const connected = Boolean(socket?.connected);
          const lastError = connected ? null : await readStoredRelayError();
          sendResponse({ connected, lastError });
        })
        .catch(async () => {
          sendResponse({
            connected: false,
            lastError: (await readStoredRelayError()) ?? getRelayLastError(),
          });
        });
      return true;
    }

    return false;
  });
});
