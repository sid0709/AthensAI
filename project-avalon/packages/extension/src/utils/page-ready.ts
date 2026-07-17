/**
 * Page-readiness helpers.
 *
 * A tab reaching `status === 'complete'` only means the initial HTML document and
 * its subresources finished — the browser `load` event. For a React/SPA job site
 * (Ashby, Greenhouse embed, Lever, Workday…) that fires while the app shell is
 * mounted but is STILL fetching the job/form data and showing a spinner. Marking
 * the pipeline's "opened" step off `complete` therefore lands us on a half-loaded
 * page. These helpers gate on what "opened" actually means: the network has gone
 * quiet AND real content (not a spinner) has rendered.
 */

const DOM_SETTLE_FALLBACK_MS = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Network idle ----------------------------------------------------------

/** webRequest resource types worth counting as "the page is still loading data". */
const COUNTED_REQUEST_TYPES: ReadonlySet<string> = new Set([
  'main_frame',
  'sub_frame',
  'xmlhttprequest', // fetch() is reported under this type by chrome.webRequest
  'script',
]);

/**
 * Resolves once the tab has had zero in-flight document/XHR/script requests for
 * `quietMs`, or after `maxMs` (long-poll / websocket / analytics-beacon sites may
 * never reach a true zero, so the cap is mandatory — we fall through to "ready"
 * rather than hang the pipeline). Observation only; requires the `webRequest`
 * permission but NOT `webRequestBlocking`. Uses the `browser.*` polyfill so the
 * callback detail types are inferred (matching the rest of this module).
 */
export function waitForNetworkIdle(
  tabId: number,
  { quietMs = 600, maxMs = 12000 }: { quietMs?: number; maxMs?: number } = {},
): Promise<'idle' | 'timeout'> {
  return new Promise((resolve) => {
    let inFlight = 0;
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;

    const filter = { urls: ['<all_urls>'], tabId };

    const finish = (reason: 'idle' | 'timeout') => {
      if (done) return;
      done = true;
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      try {
        browser.webRequest.onBeforeRequest.removeListener(onStart);
        browser.webRequest.onCompleted.removeListener(onEnd);
        browser.webRequest.onErrorOccurred.removeListener(onEnd);
      } catch {
        /* listeners may already be gone */
      }
      resolve(reason);
    };

    const scheduleQuiet = () => {
      clearTimeout(quietTimer);
      if (inFlight <= 0) quietTimer = setTimeout(() => finish('idle'), quietMs);
    };

    // Return type is `undefined` (not `void`) so these satisfy webRequest's
    // blocking-capable onBeforeRequest listener signature without an `any` cast.
    const onStart = (details: { type: string }): undefined => {
      if (COUNTED_REQUEST_TYPES.has(details.type)) {
        inFlight += 1;
        clearTimeout(quietTimer);
      }
      return undefined;
    };
    // onCompleted and onErrorOccurred both mean "one request left the pipe".
    const onEnd = (details: { type: string }): undefined => {
      if (COUNTED_REQUEST_TYPES.has(details.type)) {
        inFlight = Math.max(0, inFlight - 1);
        scheduleQuiet();
      }
      return undefined;
    };

    browser.webRequest.onBeforeRequest.addListener(onStart, filter);
    browser.webRequest.onCompleted.addListener(onEnd, filter);
    browser.webRequest.onErrorOccurred.addListener(onEnd, filter);

    const hardTimer = setTimeout(() => finish('timeout'), maxMs);
    // Nothing in flight yet (e.g. a gap between `complete` and the first XHR) —
    // start the quiet countdown; the content probe in waitForPageReady is the
    // real backstop against resolving before the data fetch has even begun.
    scheduleQuiet();
  });
}

// --- Content presence ------------------------------------------------------

/**
 * Runs in the page's MAIN world. Resolves 'ready' once no VISIBLE spinner/skeleton
 * remains AND the page has meaningful content (a form field, or a non-trivial
 * amount of rendered text), or 'timeout' after `maxMs`. This is what catches the
 * case a pure network-idle or DOM-quiescence check misses: a CSS-animated spinner
 * mutates no DOM and issues no requests, yet the page clearly isn't ready.
 */
function contentReadyInMainWorld(maxMs: number): Promise<string> {
  return new Promise((resolve) => {
    const SPINNER_SELECTOR = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[class*="spinner" i]',
      '[class*="loading" i]',
      '[class*="loader" i]',
      '[class*="skeleton" i]',
    ].join(',');

    const isVisible = (el: Element | null): boolean => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };

    const isReady = (): boolean => {
      // A visible spinner/skeleton means content is still loading.
      const spinner = document.querySelector(SPINNER_SELECTOR);
      if (isVisible(spinner)) return false;
      const hasFormish = Boolean(
        document.querySelector('form, input:not([type="hidden"]), textarea, select, button'),
      );
      const text = (document.body?.innerText ?? '').trim();
      return hasFormish || text.length > 200;
    };

    const start = Date.now();
    let interval: ReturnType<typeof setInterval>;
    const finish = (reason: string) => {
      clearInterval(interval);
      resolve(reason);
    };
    const check = () => {
      if (isReady()) return finish('ready');
      if (Date.now() - start >= maxMs) return finish('timeout');
    };
    interval = setInterval(check, 250);
    check();
  });
}

/** Wait until real content has rendered (spinner gone), bounded by `maxMs`. */
export async function waitForContentReady(tabId: number, maxMs = 12000): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: contentReadyInMainWorld,
      args: [maxMs],
    });
  } catch {
    // Best-effort: a cross-origin frame or CSP quirk can block injection.
    await sleep(Math.min(maxMs, 1500));
  }
}

// --- DOM quiescence (shared with the injection/form-fill path) --------------

/**
 * Resolves once the page's DOM has been quiet for `quietMs` (no mutations), or
 * after `maxMs`. Some uploaders parse the résumé and RE-RENDER the whole form a
 * few seconds later; filling before that re-render lands the values on
 * soon-to-be-discarded nodes. Waiting for quiescence is a generic, portable way
 * to act AFTER the page has settled — no vendor/site strings involved.
 */
function domSettleInMainWorld(quietMs: number, maxMs: number): Promise<string> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = (reason: string) => {
      try {
        observer.disconnect();
      } catch {
        /* already gone */
      }
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      resolve(reason);
    };
    const bump = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish('quiet'), quietMs);
    };
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const hardTimer = setTimeout(() => finish('timeout'), maxMs);
    bump();
  });
}

/** Wait for the page to stop mutating (e.g. a résumé-parse re-render) before filling. */
export async function waitForDomSettle(
  tabId: number,
  quietMs = 1200,
  maxMs = 15000,
): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: domSettleInMainWorld,
      args: [quietMs, maxMs],
    });
  } catch {
    // Best-effort: if settle detection fails, fall back to a short fixed wait.
    await sleep(DOM_SETTLE_FALLBACK_MS);
  }
}

// --- Composite gate for the "open" step ------------------------------------

/**
 * Gate the pipeline's "opened" step on the page actually being ready: first wait
 * for the network to go quiet (the SPA's data fetch), then for real content to
 * have rendered (spinner gone). Every stage is bounded so a long-polling or
 * never-idle site still falls through to "ready" within `hardMaxMs` instead of
 * hanging the pipeline.
 */
export async function waitForPageReady(
  tabId: number,
  {
    hardMaxMs = 20000,
    networkQuietMs = 600,
    networkMaxMs = 12000,
  }: { hardMaxMs?: number; networkQuietMs?: number; networkMaxMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + hardMaxMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  await waitForNetworkIdle(tabId, {
    quietMs: networkQuietMs,
    maxMs: Math.min(networkMaxMs, remaining()),
  });
  await waitForContentReady(tabId, remaining());
}
