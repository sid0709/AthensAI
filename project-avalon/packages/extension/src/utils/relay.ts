import {
  DEFAULT_SESSION_ID,
  SOCKET_EVENTS,
  type ActionResult,
  type ActionablePageContext,
  type ApplyInjectionPlanPayload,
  type ApplyProgress,
  type RemoteAction,
  type RegisteredPayload,
  type TabInfo,
} from '@avalon/shared';
import { io, type Socket } from 'socket.io-client';
import { executeInjectionPlan } from './injection-plan-executor';
import {
  AVALON_RELAY_CONNECTED_KEY,
  AVALON_RELAY_ERROR_KEY,
  AVALON_SERVER_KEY,
  AVALON_SESSION_KEY,
  AVALON_PROFILE_KEY,
  DEFAULT_SERVER_URL,
  EXTENSION_MESSAGES,
} from './constants';
import { ensureContentScript, runActionInTab } from './tab-messages';
import { waitForPageReady } from './page-ready';

let socket: Socket | null = null;
let tabListenersBound = false;
let currentSessionId: string = DEFAULT_SESSION_ID;
let lastConnectionError: string | null = null;

async function persistRelayError(message: string | null) {
  lastConnectionError = message;
  if (message) {
    await browser.storage.local.set({ [AVALON_RELAY_ERROR_KEY]: message });
  } else {
    await browser.storage.local.remove(AVALON_RELAY_ERROR_KEY);
  }
}

async function persistRelayConnected(connected: boolean) {
  await browser.storage.local.set({ [AVALON_RELAY_CONNECTED_KEY]: connected });
}

function relayHealthUrl(serverUrl: string): string {
  const base = serverUrl.replace(/\/$/, '');
  if (base.endsWith('/avalon')) return `${base}/health`;
  return `${base}/avalon/health`;
}

async function probeRelayHealth(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetch(relayHealthUrl(serverUrl), { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function probeRelayHealthWithRetry(
  serverUrl: string,
  attempts = 20,
  intervalMs = 500,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await probeRelayHealth(serverUrl)) return true;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

function isSocketReconnecting(sock: Socket): boolean {
  const mgr = sock.io as Socket['io'] & { reconnecting?: boolean };
  return Boolean(mgr.reconnecting);
}

function emitApplyProgress(progress: Omit<ApplyProgress, 'at' | 'sessionId'>) {
  if (!socket?.connected) return;
  socket.emit(SOCKET_EVENTS.APPLY_PROGRESS, {
    ...progress,
    sessionId: currentSessionId,
    at: Date.now(),
  } satisfies ApplyProgress);
}


function bindTabListeners() {
  if (tabListenersBound) return;
  tabListenersBound = true;

  browser.tabs.onUpdated.addListener(() => {
    void collectTabs().then((tabs) => socket?.connected && socket.emit(SOCKET_EVENTS.TABS_UPDATE, tabs));
  });
  browser.tabs.onActivated.addListener(() => {
    void collectTabs().then((tabs) => socket?.connected && socket.emit(SOCKET_EVENTS.TABS_UPDATE, tabs));
  });
}

async function getStoredConfig() {
  const stored = await browser.storage.local.get([AVALON_SERVER_KEY, AVALON_SESSION_KEY, AVALON_PROFILE_KEY]);
  return {
    serverUrl: (stored[AVALON_SERVER_KEY] as string | undefined) ?? DEFAULT_SERVER_URL,
    sessionId: stored[AVALON_SESSION_KEY] as string | undefined,
    profileId: stored[AVALON_PROFILE_KEY] as string | undefined,
  };
}

async function collectTabs(): Promise<TabInfo[]> {
  const tabs = await browser.tabs.query({});
  return tabs
    .filter((tab): tab is Browser.tabs.Tab & { id: number } => typeof tab.id === 'number')
    .map((tab) => ({
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      active: Boolean(tab.active),
      windowId: tab.windowId ?? 0,
    }));
}

async function readPageContext(tabId: number): Promise<ActionablePageContext> {
  const tab = await browser.tabs.get(tabId);
  return {
    tabId,
    url: tab.url ?? '',
    title: tab.title ?? '',
  };
}

async function resolveTabId(action: RemoteAction): Promise<number | undefined> {
  const payload = action.payload as ApplyInjectionPlanPayload | undefined;
  if (action.tabId != null) return action.tabId;
  if (payload?.page?.tabId != null) return payload.page.tabId;

  const active = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return active[0]?.id;
}

/**
 * Bring a tab (and its window) to the foreground.
 * Used only for open_tab when grant-focus is on, and for screenshots (capture
 * requires a visible tab). Routine actions must not call this — they work in
 * the background without stealing focus on every step.
 */
async function focusTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (tab.windowId != null) {
    await browser.windows.update(tab.windowId, { focused: true });
  }
  await browser.tabs.update(tabId, { active: true });
}

/** Resolve once the given tab has finished loading (status === 'complete'). */
function waitForTabComplete(tabId: number, timeoutMs = 45000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(finish, timeoutMs);
    // In case it already completed before we attached the listener.
    void browser.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    });
  });
}

async function handleRemoteAction(action: RemoteAction): Promise<ActionResult> {
  // Sleep in the extension service worker so Athens-tab background throttling
  // does not stall OTP / verify waits (orchestration awaits this socket reply).
  if (action.action === 'wait') {
    const ms = Math.min(Math.max(0, Number(action.payload?.ms ?? 500)), 120_000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { actionId: action.id, success: true, data: { waitedMs: ms } };
  }

  // open_tab creates its own tab, so it runs before the existing-tab guard.
  if (action.action === 'open_tab') {
    const url = String(action.payload?.url ?? '');
    if (!url) return { actionId: action.id, success: false, error: 'open_tab requires payload.url' };
    // Grant focus on → activate tab + bring window forward once at open.
    // Grant focus off → background tab; never steal the window.
    // Later scan/fill/verify actions never call focusTab.
    const allowFocus = action.allowWindowFocus !== false;
    const active = allowFocus ? action.payload?.active !== false : false;
    const tab = await browser.tabs.create({ url, active });
    if (typeof tab.id !== 'number') {
      return { actionId: action.id, success: false, error: 'Failed to create tab' };
    }
    if (allowFocus) {
      await focusTab(tab.id);
    }
    emitApplyProgress({ phase: 'navigating', message: `Opening ${url}…` });
    await waitForTabComplete(tab.id);
    emitApplyProgress({ phase: 'navigating', message: 'Waiting for the page to finish loading…' });
    await waitForPageReady(tab.id);
    const page = await readPageContext(tab.id);
    emitApplyProgress({ phase: 'navigating', message: `Loaded ${page.title || url}` });
    return { actionId: action.id, success: true, data: { tabId: tab.id, page } };
  }

  const tabId = await resolveTabId(action);

  if (!tabId) {
    return { actionId: action.id, success: false, error: 'No target tab available' };
  }

  if (action.action === 'navigate') {
    const url = String(action.payload?.url ?? '');
    await browser.tabs.update(tabId, { url });
    return { actionId: action.id, success: true, data: { url } };
  }

  if (action.action === 'reload') {
    await browser.tabs.reload(tabId);
    return { actionId: action.id, success: true, data: { reloaded: true } };
  }

  if (action.action === 'close_tab') {
    try {
      await browser.tabs.remove(tabId);
    } catch {
      /* tab may already be gone */
    }
    return { actionId: action.id, success: true, data: { closed: true } };
  }

  if (action.action === 'screenshot') {
    // captureVisibleTab requires the tab to be visible in a focused window.
    await focusTab(tabId);
    const dataUrl = await browser.tabs.captureVisibleTab(undefined, { format: 'png' });
    return { actionId: action.id, success: true, data: { dataUrl } };
  }

  // execute_script handled here (not via content script) to bypass page CSP.
  // new Function() in the service worker is not subject to the page's CSP;
  // chrome.scripting.executeScript injects the serialized function at the
  // browser level, which also bypasses the page's CSP 'unsafe-eval' restriction.
  if (action.action === 'execute_script') {
    const source = String(action.payload?.source ?? 'true');
    let fn: Function;
    try {
      fn = new Function(source);
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        error: `Script compilation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: fn as () => unknown,
      });
      return {
        actionId: action.id,
        success: true,
        data: { result: results[0]?.result },
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // read_page_state is a CSP-safe replacement for reading page text via
  // execute_script. It uses a hardcoded function (no eval needed) injected
  // via chrome.scripting.executeScript, so it works on pages that block
  // 'unsafe-eval' in their CSP (e.g. Greenhouse).
  if (action.action === 'read_page_state') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const controls = document.querySelectorAll(
            'input:not([type=hidden]):not([disabled]),textarea,select,[contenteditable="true"]',
          );
          const full = document.body?.innerText ?? '';
          // Capture head AND tail: on long pages (e.g. a job description above the
          // form) the decisive text — a confirmation, error, or "enter the code"
          // prompt — is often at the BOTTOM, past a simple head-only slice.
          const LIMIT = 8000;
          const text =
            full.length <= LIMIT * 2
              ? full
              : `${full.slice(0, LIMIT)}\n…\n${full.slice(-LIMIT)}`;
          // Greenhouse-only hardcode: the emailed-code step renders an
          // #email-verification fieldset with single-char security-input-{n} boxes.
          // Detect it deterministically here so step 8 never depends on the AI
          // guessing "needs_verification" (it often mislabels it "incomplete").
          const otpInputs = document.querySelectorAll(
            '[id^="security-input-"]',
          ).length;
          const hasVerificationSection = Boolean(
            document.querySelector('#email-verification, fieldset#email-verification'),
          );
          return { text, controlCount: controls.length, otpInputs, hasVerificationSection };
        },
      });
      return {
        actionId: action.id,
        success: true,
        data: results[0]?.result ?? { text: '', controlCount: 0, otpInputs: 0, hasVerificationSection: false },
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // fill_verification_code is CSP-safe (hardcoded func, no eval). It distributes an
  // emailed one-time code across the page's code inputs — a group of single-char
  // boxes, or a single code field — using the React-safe native setter, then clicks
  // the submit/verify control. Generic DOM heuristics only (no vendor strings).
  if (action.action === 'fill_verification_code') {
    const code = String(action.payload?.code ?? '').trim();
    const platform = String(action.payload?.platform ?? '').toLowerCase();
    if (!code) return { actionId: action.id, success: false, error: 'code is required' };
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (codeStr: string, platformHint: string) => {
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const nativeSet = (el: HTMLInputElement, v: string) => {
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc?.set) desc.set.call(el, v);
            else el.value = v;
          };
          // Fire a full key sequence so controlled/React OTP inputs register the
          // character (and auto-advance focus): keydown → beforeinput → input → keyup → change.
          const typeChar = (el: HTMLInputElement, ch: string) => {
            el.focus();
            el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
            try {
              el.dispatchEvent(new InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true }));
            } catch {
              /* older engines */
            }
            nativeSet(el, ch);
            el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };

          const chars = codeStr.split('');
          let filled = 0;
          let mode = 'none';

          const clearInput = (el: HTMLInputElement) => {
            nativeSet(el, '');
            el.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
          };

          // Greenhouse-only hardcode: #email-verification fieldset with security-input-{n} boxes.
          const greenhouseBoxes = Array.from(
            document.querySelectorAll<HTMLInputElement>('[id^="security-input-"]'),
          )
            .filter((i) => !i.disabled && i.offsetParent !== null)
            .sort((a, b) => {
              const ai = Number.parseInt(a.id.replace('security-input-', ''), 10);
              const bi = Number.parseInt(b.id.replace('security-input-', ''), 10);
              return (Number.isFinite(ai) ? ai : 0) - (Number.isFinite(bi) ? bi : 0);
            });

          const useGreenhouse =
            platformHint === 'greenhouse' ||
            greenhouseBoxes.length >= chars.length ||
            Boolean(document.querySelector('#email-verification, fieldset#email-verification'));

          let boxes: HTMLInputElement[] = [];
          if (useGreenhouse && greenhouseBoxes.length > 0) {
            boxes = greenhouseBoxes;
            mode = 'greenhouse-boxes';
          } else {
            const inputs = Array.from(
              document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([disabled])'),
            ).filter((i) => ['text', 'tel', 'number', ''].includes(i.type) || i.inputMode === 'numeric');
            boxes = inputs.filter((i) => i.getAttribute('maxlength') === '1');
          }

          if (boxes.length >= chars.length && boxes.length > 0) {
            // Clear stale digits from a prior wrong attempt before filling.
            for (const box of boxes) clearInput(box);
            await wait(40);

            // Try a real PASTE first — many OTP widgets distribute a pasted code
            // across the boxes in one shot.
            try {
              const dt = new DataTransfer();
              dt.setData('text', codeStr);
              boxes[0].focus();
              boxes[0].dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
              await wait(80);
            } catch {
              /* paste not supported — fall through to typing */
            }
            const pasteWorked = boxes.slice(0, chars.length).every((b, i) => (b.value || '') === chars[i]);
            if (!pasteWorked) {
              for (const box of boxes) clearInput(box);
              await wait(40);
              for (let i = 0; i < chars.length; i += 1) {
                typeChar(boxes[i], chars[i]);
                await wait(30);
              }
            }
            filled = boxes.slice(0, chars.length).filter((b) => (b.value || '').length > 0).length;
            if (mode === 'greenhouse-boxes') {
              mode = pasteWorked ? 'greenhouse-paste' : 'greenhouse-type';
            } else {
              mode = pasteWorked ? 'boxes-paste' : 'boxes-type';
            }
          } else {
            const inputs = Array.from(
              document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([disabled])'),
            ).filter((i) => ['text', 'tel', 'number', ''].includes(i.type) || i.inputMode === 'numeric');
            const labelled = inputs.find((i) =>
              /code|verif|security|otp|passcode|pin/i.test(
                `${i.name} ${i.id} ${i.getAttribute('aria-label') ?? ''} ${i.placeholder ?? ''}`,
              ),
            );
            const single = labelled ?? inputs[0];
            if (single) {
              single.focus();
              nativeSet(single, codeStr);
              single.dispatchEvent(new InputEvent('input', { data: codeStr, inputType: 'insertText', bubbles: true }));
              single.dispatchEvent(new Event('change', { bubbles: true }));
              filled = (single.value || '').length > 0 ? 1 : 0;
              mode = 'single';
            }
          }

          // Give the framework a tick to enable the submit button, then click it.
          await wait(120);
          const clickable = Array.from(
            document.querySelectorAll<HTMLElement>('button, input[type=submit], [role=button]'),
          ).filter((b) => b.offsetParent !== null);
          const submitBtn =
            clickable.find((b) => (b as HTMLInputElement).type === 'submit') ??
            clickable.find((b) => /submit|verify|confirm|continue|apply/i.test(b.textContent ?? '')) ??
            null;
          let clicked = false;
          if (filled >= chars.length && submitBtn && !(submitBtn as HTMLButtonElement).disabled) {
            submitBtn.click();
            clicked = true;
          }
          return { filled, mode, clicked, boxes: boxes.length, expected: chars.length, code: codeStr };
        },
        args: [code, platform],
      });
      return { actionId: action.id, success: true, data: results[0]?.result ?? { filled: 0, clicked: false } };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (action.action === 'fetch_actionable_tree') {
    const result = await runActionInTab(tabId, action);
    if (!result.success) return result;

    const page = await readPageContext(tabId);
    return {
      ...result,
      data: {
        ...(result.data as Record<string, unknown>),
        page,
      },
    };
  }

  if (action.action === 'apply_injection_plan') {
    const payload = (action.payload ?? {}) as ApplyInjectionPlanPayload;
    const planTabId = payload.page?.tabId ?? tabId;

    await ensureContentScript(planTabId);

    const current = await readPageContext(planTabId);
    const urlMismatch =
      payload.page?.url && current.url && current.url !== payload.page.url
        ? { expected: payload.page.url, actual: current.url }
        : undefined;

    try {
      const data = await executeInjectionPlan(planTabId, payload, emitApplyProgress);
      return {
        actionId: action.id,
        success: true,
        data: {
          ...data,
          page: current,
          urlMismatch,
        },
      };
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return runActionInTab(tabId, action);
}

export async function connectRelay(
  overrides?: { serverUrl?: string; sessionId?: string; profileId?: string },
  onRegistered?: (payload: RegisteredPayload) => void,
  onConnectError?: (error: Error) => void,
  options?: { waitForHealth?: boolean },
) {
  const config = await getStoredConfig();
  const serverUrl = overrides?.serverUrl ?? config.serverUrl;
  // Fall back to the SAVED session before "default" — otherwise any reconnect
  // without an explicit override silently re-registers this extension into the
  // shared default session, where it executes another user's commands.
  const sessionId = overrides?.sessionId?.trim() || config.sessionId?.trim() || DEFAULT_SESSION_ID;
  const profileId = overrides?.profileId?.trim() || config.profileId?.trim() || '';

  if (!profileId) {
    const message = 'Sign in required before connecting';
    await persistRelayConnected(false);
    await persistRelayError(message);
    onConnectError?.(new Error(message));
    return null;
  }

  if (options?.waitForHealth) {
    const reachable = await probeRelayHealthWithRetry(serverUrl);
    if (!reachable) {
      const message =
        'Relay server unreachable. Check that the Avalon relay is running, then reconnect.';
      await persistRelayError(message);
      onConnectError?.(new Error(message));
      return null;
    }
  } else {
    await persistRelayError(null);
  }

  socket?.disconnect();
  socket?.removeAllListeners();
  // MV3 service workers have NO XMLHttpRequest, so socket.io's HTTP long-polling
  // transport fails immediately ("xhr poll error"). WebSocket IS available in the
  // worker, so we use it exclusively — this is what makes the extension actually
  // connect to the relay.
  socket = io(serverUrl, {
    path: '/avalon/socket.io',
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 10000,
    timeout: 20000,
  });
  bindTabListeners();

  socket.on('connect_error', (error: Error) => {
    if (socket?.connected) return;
    void persistRelayConnected(false);
    onConnectError?.(error);
  });

  socket.on('disconnect', (reason) => {
    void persistRelayConnected(false);
    if (reason === 'io server disconnect') {
      void persistRelayError('Relay disconnected by server.');
    }
  });

  socket.on('connect', () => {
    void persistRelayError(null);
    void persistRelayConnected(true);
    socket?.emit(
      SOCKET_EVENTS.REGISTER,
      { role: 'extension', sessionId, profileId },
      (response: RegisteredPayload) => {
        currentSessionId = response.sessionId;
        void browser.storage.local.set({
          [AVALON_SERVER_KEY]: serverUrl,
          [AVALON_SESSION_KEY]: response.sessionId,
          [AVALON_PROFILE_KEY]: response.profileId,
        });
        onRegistered?.(response);
        void collectTabs().then((tabs) => socket?.emit(SOCKET_EVENTS.TABS_UPDATE, tabs));
      },
    );
  });

  socket.on(SOCKET_EVENTS.EXECUTE_ACTION, async (action: RemoteAction) => {
    const result = await handleRemoteAction(action);
    socket?.emit(SOCKET_EVENTS.ACTION_RESULT, result);
  });


  socket.on(SOCKET_EVENTS.REQUEST_TABS, async () => {
    const tabs = await collectTabs();
    socket?.emit(SOCKET_EVENTS.TABS_UPDATE, tabs);
  });

  socket.on(SOCKET_EVENTS.REQUEST_SCREENSHOT, async (payload: { tabId?: number }) => {
    try {
      const tabId =
        payload.tabId ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (!tabId) throw new Error('No tab for screenshot');
      await focusTab(tabId);
      const dataUrl = await browser.tabs.captureVisibleTab(undefined, { format: 'png' });
      socket?.emit(SOCKET_EVENTS.SCREENSHOT_RESULT, { tabId, dataUrl });
    } catch (error) {
      socket?.emit(SOCKET_EVENTS.SCREENSHOT_RESULT, {
        tabId: payload.tabId ?? -1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return socket;
}

/** Re-open the relay if the MV3 service worker woke without an in-memory socket. */
export async function ensureRelayConnected(
  overrides?: { serverUrl?: string; sessionId?: string; profileId?: string },
): Promise<void> {
  const existing = getRelaySocket();
  if (existing?.connected) {
    await persistRelayError(null);
    await persistRelayConnected(true);
    return;
  }
  if (existing && !existing.connected) {
    if (isSocketReconnecting(existing)) return;
    existing.disconnect();
    socket = null;
  }

  const config = await getStoredConfig();
  await connectRelay({
    serverUrl: overrides?.serverUrl ?? config.serverUrl,
    sessionId: overrides?.sessionId ?? config.sessionId,
    profileId: overrides?.profileId ?? config.profileId,
  });
}

export function waitForRelayRegistration(
  overrides?: { serverUrl?: string; sessionId?: string; profileId?: string },
  timeoutMs = 20000,
): Promise<RegisteredPayload> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(getRelayLastError() ?? 'Relay connection timed out'));
    }, timeoutMs);

    void connectRelay(
      overrides,
      (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
      { waitForHealth: true },
    );
  });
}

export function disconnectRelay() {
  socket?.disconnect();
  socket = null;
  void persistRelayConnected(false);
}

export function getRelaySocket() {
  return socket;
}

export function getRelayLastError() {
  return lastConnectionError;
}

export async function readStoredRelayError(): Promise<string | null> {
  const stored = await browser.storage.local.get(AVALON_RELAY_ERROR_KEY);
  const message = (stored[AVALON_RELAY_ERROR_KEY] as string | undefined) ?? null;
  lastConnectionError = message;
  return message;
}

export async function saveRelayConfig(serverUrl: string, sessionId?: string, profileId?: string) {
  await browser.storage.local.set({
    [AVALON_SERVER_KEY]: serverUrl,
    ...(sessionId ? { [AVALON_SESSION_KEY]: sessionId } : {}),
    ...(profileId ? { [AVALON_PROFILE_KEY]: profileId } : {}),
  });
}
