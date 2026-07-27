(() => {
  // src/linkedin-voyager-cache.ts
  var VOYAGER_JOB_POSTING_EVENT = "li-facilitator-voyager-job-posting";
  var applyUrlByJobId = /* @__PURE__ */ new Map();
  function ingestVoyagerJobPostingPayload(jobId, payload) {
    if (!jobId || !/^\d+$/.test(jobId)) return "";
    const url = extractApplyUrlFromVoyagerPayload(payload);
    if (url) applyUrlByJobId.set(jobId, url);
    return url;
  }
  function getCachedCompanyApplyUrl(jobId) {
    if (!jobId) return "";
    return applyUrlByJobId.get(jobId) || "";
  }
  function setCachedCompanyApplyUrl(jobId, url) {
    if (!jobId || !url || !/^\d+$/.test(jobId)) return;
    applyUrlByJobId.set(jobId, url);
  }
  async function waitForCachedApplyUrl(jobId, maxWaitMs = 1e3) {
    const cached = getCachedCompanyApplyUrl(jobId);
    if (cached) return cached;
    const started = Date.now();
    while (Date.now() - started < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const next = getCachedCompanyApplyUrl(jobId);
      if (next) return next;
    }
    return "";
  }
  function bindVoyagerJobPostingListener() {
    window.addEventListener(VOYAGER_JOB_POSTING_EVENT, (event) => {
      const detail = event.detail;
      if (!detail?.jobId || detail.payload === void 0) return;
      ingestVoyagerJobPostingPayload(detail.jobId, detail.payload);
    });
  }

  // src/linkedin-voyager.ts
  function decodeLinkedInSafetyUrl(href) {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.origin);
      if (!url.hostname.includes("linkedin.com")) {
        return isExternalJobUrl(href) ? href : "";
      }
      if (url.pathname.includes("/safety/go") || url.pathname.includes("/externalApply") || url.pathname.includes("/redir/redirect")) {
        const encodedTarget = url.searchParams.get("url");
        if (encodedTarget) {
          return decodeURIComponent(encodedTarget);
        }
      }
      return "";
    } catch {
      return "";
    }
  }
  function isExternalJobUrl(url) {
    try {
      return !new URL(url).hostname.includes("linkedin.com");
    } catch {
      return false;
    }
  }
  function normalizeApplyUrl(raw) {
    if (!raw) return "";
    const decoded = decodeLinkedInSafetyUrl(raw);
    if (decoded && isExternalJobUrl(decoded)) return decoded;
    if (isExternalJobUrl(raw)) return raw;
    try {
      const unescaped = decodeURIComponent(raw);
      const decodedUnescaped = decodeLinkedInSafetyUrl(unescaped);
      if (decodedUnescaped && isExternalJobUrl(decodedUnescaped)) return decodedUnescaped;
      if (isExternalJobUrl(unescaped)) return unescaped;
    } catch {
    }
    return "";
  }
  function extractApplyUrlFromVoyagerPayload(payload) {
    const candidates = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const record = node;
      for (const key of ["companyApplyUrl", "applyUrl", "externalApplyUrl"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
          candidates.push(value.trim());
        }
      }
      if (record.applyMethod && typeof record.applyMethod === "object") {
        walk(record.applyMethod);
      }
      for (const value of Object.values(record)) {
        if (value && typeof value === "object") walk(value);
      }
    };
    walk(payload);
    for (const raw of candidates) {
      const normalized = normalizeApplyUrl(raw);
      if (normalized) return normalized;
    }
    return "";
  }
  function getCsrfTokenFromDocumentCookie() {
    const match = document.cookie.match(/JSESSIONID=([^;]+)/);
    if (!match?.[1]) return "";
    return match[1].replace(/^"|"$/g, "");
  }
  function voyagerHeaders(csrf) {
    return {
      "csrf-token": csrf,
      accept: "application/vnd.linkedin.normalized+json+2.1",
      "x-li-lang": "en_US",
      "x-restli-protocol-version": "2.0.0"
    };
  }
  var VOYAGER_JOB_POSTINGS_ENDPOINT = (jobId) => `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}`;
  var inFlightApplyUrlRequests = /* @__PURE__ */ new Map();
  var fetchFailedUntil = /* @__PURE__ */ new Map();
  var FETCH_FAILURE_COOLDOWN_MS = 6e4;
  function isFetchCoolingDown(jobId) {
    const until = fetchFailedUntil.get(jobId);
    return until !== void 0 && Date.now() < until;
  }
  function markFetchFailed(jobId) {
    fetchFailedUntil.set(jobId, Date.now() + FETCH_FAILURE_COOLDOWN_MS);
  }
  async function fetchApplyUrlFromVoyagerEndpoint(endpoint, csrf) {
    const response = await fetch(endpoint, {
      credentials: "include",
      headers: voyagerHeaders(csrf)
    });
    if (!response.ok) return "";
    const payload = await response.json();
    return extractApplyUrlFromVoyagerPayload(payload);
  }
  async function requestApplyUrlFromBackground(jobId) {
    if (!chrome.runtime?.id) return "";
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "FETCH_VOYAGER_APPLY_URL", jobId }, (response) => {
        if (chrome.runtime.lastError) {
          resolve("");
          return;
        }
        resolve(typeof response?.url === "string" ? response.url : "");
      });
    });
  }
  async function fetchCompanyApplyUrlViaVoyager(jobId, options = {}) {
    if (!jobId || !/^\d+$/.test(jobId)) return "";
    const cached = getCachedCompanyApplyUrl(jobId);
    if (cached) return cached;
    if (options.allowFetch === false) return "";
    if (isFetchCoolingDown(jobId)) return "";
    const inFlight = inFlightApplyUrlRequests.get(jobId);
    if (inFlight) return inFlight;
    const request = (async () => {
      const fromWait = await waitForCachedApplyUrl(jobId);
      if (fromWait) return fromWait;
      let csrf = getCsrfTokenFromDocumentCookie();
      let url = "";
      if (csrf) {
        try {
          url = await fetchApplyUrlFromVoyagerEndpoint(
            VOYAGER_JOB_POSTINGS_ENDPOINT(jobId),
            csrf
          );
        } catch {
        }
      }
      if (!url) {
        url = await requestApplyUrlFromBackground(jobId);
      }
      if (url) {
        setCachedCompanyApplyUrl(jobId, url);
      } else {
        markFetchFailed(jobId);
      }
      return url;
    })();
    inFlightApplyUrlRequests.set(jobId, request);
    try {
      return await request;
    } finally {
      inFlightApplyUrlRequests.delete(jobId);
    }
  }

  // src/extract-job.ts
  var ABOUT_THE_JOB_COMPONENT = "com.linkedin.sdui.generated.jobseeker.dsl.impl.aboutTheJob";
  var JOB_DETAILS_SCREEN = "com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails";
  var ABOUT_THE_JOB_SELECTOR = `[data-sdui-component="${ABOUT_THE_JOB_COMPONENT}"]`;
  function walkShadowRoots(root, visit) {
    const elements = root instanceof Document ? Array.from(root.body?.querySelectorAll("*") || []) : root instanceof ShadowRoot ? Array.from(root.querySelectorAll("*")) : Array.from(root.querySelectorAll("*"));
    for (const el of elements) {
      const match = visit(el);
      if (match) return match;
      if (el.shadowRoot) {
        const shadowMatch = walkShadowRoots(el.shadowRoot, visit);
        if (shadowMatch) return shadowMatch;
      }
    }
    return null;
  }
  function queryDeep(selector, root = document) {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    return walkShadowRoots(root, (el) => {
      if (el.matches(selector)) return el;
      if (el.shadowRoot) {
        return el.shadowRoot.querySelector(selector);
      }
      return null;
    });
  }
  function getDeepText(el) {
    const parts = [];
    if (el.shadowRoot) {
      for (const child of Array.from(el.shadowRoot.childNodes)) {
        const text = getTextFromNode(child);
        if (text) parts.push(text);
      }
    }
    for (const child of Array.from(el.childNodes)) {
      const text = getTextFromNode(child);
      if (text) parts.push(text);
    }
    if (parts.length) {
      return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    return (el.textContent || el.innerText || "").trim();
  }
  function getTextFromNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.trim() || "";
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (el.shadowRoot) return getDeepText(el);
      const blockTags = /* @__PURE__ */ new Set([
        "P",
        "DIV",
        "LI",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "BR",
        "SECTION",
        "UL"
      ]);
      if (blockTags.has(el.tagName)) {
        const inner = getDeepText(el);
        return inner ? `${inner}
` : "";
      }
      return getDeepText(el);
    }
    return "";
  }
  function queryDeepText(selector, root = document) {
    const el = queryDeep(selector, root);
    return el ? getDeepText(el) : "";
  }
  function cleanText(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function cleanJobDescription(text) {
    return text.replace(/^About the job\s*/i, "").replace(/\s*…\s*more\s*$/i, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  var LEGACY_JOB_DETAIL_ROOT_SELECTORS = [
    ".jobs-details__main-content",
    ".jobs-search__job-details--container",
    ".jobs-search__job-details",
    ".job-view-layout",
    ".scaffold-layout__detail",
    "[data-test-job-details]"
  ];
  var LEGACY_UNIFIED_TOP_CARD_SELECTORS = {
    title: [
      ".job-details-jobs-unified-top-card__job-title h1 a",
      ".job-details-jobs-unified-top-card__job-title h1",
      ".jobs-unified-top-card__job-title h1 a",
      ".jobs-unified-top-card__job-title h1",
      ".job-details-jobs-unified-top-card__sticky-header h2"
    ],
    company: [
      ".job-details-jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name a",
      'a[data-view-name="job-details-about-company-name-link"]',
      ".jobs-company .artdeco-entity-lockup__title a"
    ],
    location: [
      ".job-details-jobs-unified-top-card__tertiary-description-container",
      ".jobs-unified-top-card__tertiary-description-container",
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__primary-description"
    ],
    description: [
      "#job-details",
      ".jobs-description__content",
      ".jobs-box__html-content",
      "article.jobs-description__container",
      ".jobs-description",
      ".jobs-description-content__text--stretch",
      ".jobs-description-content__text",
      ".description__text"
    ]
  };
  function isLocationMetaNoise(text) {
    const lower = text.toLowerCase();
    return lower.includes("ago") || lower.includes("clicked") || lower.includes("promoted") || lower.includes("applicant") || lower.includes("response") || lower.includes("insights") || lower.includes("hirer") || lower.includes("easy apply");
  }
  function queryDeepTextFromSelectors(selectors, root = document) {
    for (const selector of selectors) {
      const text = cleanText(queryDeepText(selector, root));
      if (text) return text;
    }
    return "";
  }
  function getLegacyJobDetailsRoot() {
    for (const selector of LEGACY_JOB_DETAIL_ROOT_SELECTORS) {
      const el = queryDeep(selector);
      if (el) return el;
    }
    const topCardContainer = queryDeep(".job-details-jobs-unified-top-card__container");
    if (topCardContainer) {
      return topCardContainer.closest(".jobs-details__main-content") || topCardContainer.closest(".jobs-search__job-details") || topCardContainer.closest(".jobs-details") || topCardContainer.parentElement;
    }
    return null;
  }
  function getJobDetailsRoot() {
    const sduiRoot = queryDeep(`[data-sdui-screen="${JOB_DETAILS_SCREEN}"]`) || queryDeep('[componentkey^="JobDetails_"]')?.closest("[data-sdui-screen]") || queryDeep(ABOUT_THE_JOB_SELECTOR)?.closest("[data-sdui-screen]");
    if (sduiRoot) return sduiRoot;
    const legacyRoot = getLegacyJobDetailsRoot();
    if (legacyRoot) return legacyRoot;
    return document.body;
  }
  function extractJobId(root = document) {
    const fromParam = new URL(window.location.href).searchParams.get("currentJobId");
    if (fromParam) return fromParam;
    const viewMatch = window.location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];
    const detailLinkSelectors = [
      '.job-details-jobs-unified-top-card__job-title a[href*="/jobs/view/"]',
      '.jobs-search__job-details a[href*="/jobs/view/"]',
      '.jobs-details__main-content a[href*="/jobs/view/"]'
    ];
    for (const selector of detailLinkSelectors) {
      const link = queryDeep(selector, root);
      const linkMatch2 = link?.href?.match(/\/jobs\/view\/(\d+)/);
      if (linkMatch2) return linkMatch2[1];
    }
    const activeCard = queryDeep(".jobs-search-results-list__list-item--active [data-job-id]") || queryDeep('.job-card-container[aria-current="page"][data-job-id]');
    const activeJobId = activeCard?.getAttribute("data-job-id")?.trim();
    if (activeJobId && /^\d+$/.test(activeJobId)) return activeJobId;
    const applyButton = queryDeep("[data-job-id]", root);
    const fromDataAttr = applyButton?.getAttribute("data-job-id")?.trim();
    if (fromDataAttr && /^\d+$/.test(fromDataAttr)) return fromDataAttr;
    const jobLink = queryDeep('a[href*="/jobs/view/"]', root);
    const linkMatch = jobLink?.href?.match(/\/jobs\/view\/(\d+)/);
    return linkMatch?.[1] || null;
  }
  function extractJobUrl(root = document) {
    const jobId = extractJobId(root);
    if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
    return window.location.href.split("?")[0];
  }
  function tryExpandJobDescription(root = document) {
    const expandSelectors = [
      ".jobs-description__footer-button",
      '[data-tracking-control-name="public_jobs_show-more-html-btn"]',
      ".jobs-description-content__text button",
      ".feed-shared-inline-show-more-text__see-more-less-toggle",
      ".inline-show-more-text__button"
    ];
    for (const selector of expandSelectors) {
      const el = queryDeep(selector, root);
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "").toLowerCase();
      if (label.includes("show less")) continue;
      el.click();
      return;
    }
  }
  function isExternalJobUrl2(url) {
    try {
      const parsed = new URL(url);
      return !parsed.hostname.includes("linkedin.com");
    } catch {
      return false;
    }
  }
  function queryDeepAll(selector, root = document) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (el) => {
      if (!seen.has(el)) {
        seen.add(el);
        results.push(el);
      }
    };
    if (root instanceof Document) {
      root.querySelectorAll(selector).forEach(add);
    } else {
      if (root.matches(selector)) add(root);
      root.querySelectorAll(selector).forEach(add);
    }
    walkShadowRoots(root, (el) => {
      if (el.matches(selector)) add(el);
      if (el.shadowRoot) {
        el.shadowRoot.querySelectorAll(selector).forEach(add);
      }
      return null;
    });
    return results;
  }
  function decodeLinkedInSafetyUrl2(href) {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.origin);
      if (!url.hostname.includes("linkedin.com")) {
        return isExternalJobUrl2(href) ? href : "";
      }
      if (url.pathname.includes("/safety/go") || url.pathname.includes("/externalApply") || url.pathname.includes("/redir/redirect")) {
        const encodedTarget = url.searchParams.get("url");
        if (encodedTarget) {
          return decodeURIComponent(encodedTarget);
        }
      }
      return "";
    } catch {
      return "";
    }
  }
  var SDUI_REAL_JOB_URL_SELECTORS = [
    'a[aria-label*="Apply on company website"][href*="/safety/go"]',
    'a[href*="/safety/go"][aria-label*="Apply on company"]',
    '[componentkey^="JobDetails_"] a[href*="/safety/go"]',
    `a[href*="/safety/go"]`
  ];
  var LEGACY_REAL_JOB_URL_SELECTORS = [
    ".jobs-apply-button--top-card a[href]",
    "a.jobs-apply-button[href]",
    ".jobs-s-apply a[href]",
    'a[data-control-name="jobdetails_topcard_inapply"]',
    'a[href*="/externalApply"]',
    'a[href*="/safety/go"]',
    'a[data-tracking-control-name*="apply-link-offsite"]'
  ];
  var LEGACY_OFFSITE_APPLY_BUTTON_SELECTORS = [
    "button.jobs-apply-button[data-live-test-job-apply-button]",
    'button.jobs-apply-button[aria-label*="company website"]',
    'button.jobs-apply-button[role="link"]'
  ];
  function detectJobView() {
    if (queryDeep(`[data-sdui-screen="${JOB_DETAILS_SCREEN}"]`) || queryDeep(ABOUT_THE_JOB_SELECTOR) || queryDeep('[componentkey^="JobDetails_AboutTheJob_"]') || queryDeep('[componentkey^="JobDetails_"]')) {
      return "sdui";
    }
    return "legacy";
  }
  function getSduiJobDetailsRoot() {
    return queryDeep(`[data-sdui-screen="${JOB_DETAILS_SCREEN}"]`) || queryDeep('[componentkey^="JobDetails_"]')?.closest("[data-sdui-screen]") || queryDeep(ABOUT_THE_JOB_SELECTOR)?.closest("[data-sdui-screen]") || document.body;
  }
  function isEasyApplyControl(el) {
    const label = (el.getAttribute("aria-label") || el.textContent || "").toLowerCase();
    return label.includes("easy apply");
  }
  function isExternalApplyControl(el) {
    const label = (el.getAttribute("aria-label") || el.textContent || "").toLowerCase();
    if (isEasyApplyControl(el)) return false;
    if (label.includes("apply on company")) return true;
    if (label.includes("on company website")) return true;
    if (label === "apply" || label.startsWith("apply ")) return true;
    const href = hrefFromElement(el).toLowerCase();
    return href.includes("/safety/go") || href.includes("/externalapply") || href.includes("apply-link-offsite");
  }
  function hrefFromElement(el) {
    if (el instanceof HTMLAnchorElement) {
      return el.href || el.getAttribute("href") || "";
    }
    for (const attr of ["data-url", "data-href", "data-job-url", "data-apply-url"]) {
      const value = el.getAttribute(attr);
      if (value) return value;
    }
    const anchor = el.closest("a[href]");
    if (anchor) {
      return anchor.href || anchor.getAttribute("href") || "";
    }
    return el.getAttribute("href") || "";
  }
  function parseApplyUrlFromText(text) {
    if (!text) return "";
    const linkedInWrapped = text.match(
      /(?:safety\/go\/?\?url=|externalApply\/\d+\?url=)([^&"'\s<>]+)/i
    );
    if (linkedInWrapped?.[1]) {
      const wrapped = `https://www.linkedin.com/safety/go?url=${linkedInWrapped[1]}`;
      const decoded = tryDecodeExternalJobUrl(wrapped);
      if (decoded) return decoded;
    }
    const jsonMatch = text.match(
      /"(?:companyApplyUrl|applyUrl|externalApplyUrl)"\s*:\s*"([^"]+)"/i
    );
    if (jsonMatch?.[1]) {
      const decoded = tryDecodeExternalJobUrl(jsonMatch[1]) || tryDecodeExternalJobUrl(decodeURIComponent(jsonMatch[1]));
      if (decoded) return decoded;
    }
    return "";
  }
  function extractApplyUrlFromHiddenCode(root) {
    for (const selector of ["#applyUrl", "code#applyUrl", 'code[id="applyUrl"]']) {
      const codeEl = queryDeep(selector, root);
      if (!codeEl) continue;
      const fromCode = parseApplyUrlFromText(
        codeEl.textContent || codeEl.innerHTML || ""
      );
      if (fromCode) return fromCode;
    }
    return "";
  }
  function scanDocumentForEmbeddedApplyUrl(root) {
    const fromHiddenCode = extractApplyUrlFromHiddenCode(root);
    if (fromHiddenCode) return fromHiddenCode;
    for (const code of root.querySelectorAll("code")) {
      const fromCode = parseApplyUrlFromText(code.textContent || "");
      if (fromCode) return fromCode;
    }
    for (const script of root.querySelectorAll("script")) {
      const fromScript = parseApplyUrlFromText(script.textContent || "");
      if (fromScript) return fromScript;
    }
    return "";
  }
  function findLegacyOffsiteApplyButton(root) {
    for (const selector of LEGACY_OFFSITE_APPLY_BUTTON_SELECTORS) {
      const button = queryDeep(selector, root);
      if (button && isExternalApplyControl(button)) return button;
    }
    return null;
  }
  function hasLegacyOffsiteApplyUi(root) {
    return findLegacyOffsiteApplyButton(root) !== null || queryDeep(".jobs-offsite-apply-confirmation-banner", root) !== null;
  }
  function detectApplyMethod(root = document) {
    const legacyRoot = getLegacyJobDetailsRoot();
    if (legacyRoot && hasLegacyOffsiteApplyUi(legacyRoot)) {
      return "offsite";
    }
    if (queryDeep(".jobs-offsite-apply-confirmation-banner", root)) {
      return "offsite";
    }
    const easyApplySelectors = [
      'button[aria-label*="Easy Apply"]',
      'a[aria-label*="Easy Apply"]',
      '.jobs-apply-button[aria-label*="Easy Apply"]',
      'button.jobs-apply-button[aria-label*="Easy Apply"]'
    ];
    for (const selector of easyApplySelectors) {
      if (queryDeep(selector, root)) return "easy";
    }
    const sduiRoot = queryDeep(`[data-sdui-screen="${JOB_DETAILS_SCREEN}"]`) || queryDeep('[componentkey^="JobDetails_"]');
    if (sduiRoot) {
      if (queryDeep('a[aria-label*="Apply on company website"]', sduiRoot)) {
        return "offsite";
      }
      if (queryDeep('a[aria-label*="Easy Apply"], button[aria-label*="Easy Apply"]', sduiRoot)) {
        return "easy";
      }
    }
    if (findLegacyOffsiteApplyButton(document.body)) {
      return "offsite";
    }
    return "unknown";
  }
  async function fetchRealJobUrlFromExternalApply(jobId) {
    const endpoint = `https://www.linkedin.com/jobs/view/externalApply/${jobId}`;
    try {
      const manualResponse = await fetch(endpoint, {
        credentials: "include",
        redirect: "manual"
      });
      const location = manualResponse.headers.get("Location") || manualResponse.headers.get("location");
      if (location) {
        const decoded = tryDecodeExternalJobUrl(location) || (isExternalJobUrl2(location) ? location : "");
        if (decoded) return decoded;
      }
      if (manualResponse.type === "opaqueredirect") {
      } else if (manualResponse.ok) {
        const html = await manualResponse.text();
        const fromHtml = parseApplyUrlFromText(html);
        if (fromHtml) return fromHtml;
      }
    } catch {
    }
    try {
      const response = await fetch(endpoint, {
        credentials: "include",
        redirect: "follow"
      });
      if (response.url) {
        const decoded = tryDecodeExternalJobUrl(response.url);
        if (decoded) return decoded;
        if (isExternalJobUrl2(response.url)) return response.url;
      }
      if (response.ok) {
        const html = await response.text();
        const fromHtml = parseApplyUrlFromText(html);
        if (fromHtml) return fromHtml;
      }
    } catch {
      return "";
    }
    return "";
  }
  function tryDecodeExternalJobUrl(href) {
    const decoded = decodeLinkedInSafetyUrl2(href);
    if (decoded && isExternalJobUrl2(decoded)) return decoded;
    return "";
  }
  function collectRealJobUrlCandidates(root, selectors) {
    const seen = /* @__PURE__ */ new Set();
    const links = [];
    for (const selector of selectors) {
      for (const el of queryDeepAll(selector, root)) {
        if (seen.has(el)) continue;
        seen.add(el);
        links.push(el);
      }
    }
    return links;
  }
  function extractRealJobUrlFromSelectors(root, selectors, options = {}) {
    for (const link of collectRealJobUrlCandidates(root, selectors)) {
      if (isEasyApplyControl(link)) continue;
      if (options.requireExternalApply && !isExternalApplyControl(link)) continue;
      const decoded = tryDecodeExternalJobUrl(hrefFromElement(link));
      if (decoded) return decoded;
    }
    return "";
  }
  function extractRealJobUrlSdui() {
    const sduiRoot = getSduiJobDetailsRoot();
    const fromApplyButton = extractRealJobUrlFromSelectors(
      sduiRoot,
      SDUI_REAL_JOB_URL_SELECTORS.slice(0, 3),
      { requireExternalApply: true }
    );
    if (fromApplyButton) return fromApplyButton;
    const fromSduiRoot = extractRealJobUrlFromSelectors(
      sduiRoot,
      SDUI_REAL_JOB_URL_SELECTORS
    );
    if (fromSduiRoot) return fromSduiRoot;
    return extractRealJobUrlFromSelectors(document.body, SDUI_REAL_JOB_URL_SELECTORS, {
      requireExternalApply: true
    });
  }
  async function extractRealJobUrlLegacy(jobId) {
    const legacyRoot = getLegacyJobDetailsRoot() || document.body;
    const topCard = queryDeep(".job-details-jobs-unified-top-card__container") || queryDeep(".jobs-search__job-details--container") || legacyRoot;
    const fromEmbedded = scanDocumentForEmbeddedApplyUrl(topCard);
    if (fromEmbedded) return fromEmbedded;
    const fromTopCard = extractRealJobUrlFromSelectors(
      topCard,
      LEGACY_REAL_JOB_URL_SELECTORS
    );
    if (fromTopCard) return fromTopCard;
    const fromLegacyRoot = extractRealJobUrlFromSelectors(
      legacyRoot,
      LEGACY_REAL_JOB_URL_SELECTORS
    );
    if (fromLegacyRoot) return fromLegacyRoot;
    return extractRealJobUrlFromSelectors(
      document.body,
      LEGACY_REAL_JOB_URL_SELECTORS
    );
  }
  async function extractRealJobUrl(root, jobId, options = {}) {
    const allowFetch = options.allowVoyagerFetch !== false;
    let url = "";
    const legacyRoot = getLegacyJobDetailsRoot();
    if (legacyRoot && hasLegacyOffsiteApplyUi(legacyRoot)) {
      url = await extractRealJobUrlLegacy(jobId);
    } else if (detectJobView() === "sdui") {
      url = extractRealJobUrlSdui();
    } else {
      url = await extractRealJobUrlLegacy(jobId);
    }
    if (!url && jobId) {
      url = getCachedCompanyApplyUrl(jobId);
    }
    if (!url && jobId && allowFetch) {
      url = await fetchCompanyApplyUrlViaVoyager(jobId, { allowFetch: true });
    }
    if (!url && jobId && allowFetch) {
      const topCard = queryDeep(".job-details-jobs-unified-top-card__container") || queryDeep(".jobs-search__job-details--container") || legacyRoot || root;
      if (hasLegacyOffsiteApplyUi(topCard)) {
        url = await fetchRealJobUrlFromExternalApply(jobId);
        if (url) setCachedCompanyApplyUrl(jobId, url);
      }
    }
    return url;
  }
  var TOPCARD_TITLE_ANCHOR_SELECTOR = 'a[data-tracking-control-name="public_jobs_topcard-title"]';
  var TOPCARD_LOGO_ANCHOR_SELECTOR = 'a[data-tracking-control-name="public_jobs_topcard_logo"]';
  var TOPCARD_COMPANY_ANCHOR_SELECTOR = 'a[data-tracking-control-name="public_jobs_topcard-org-name"]';
  function anchorMatchesJobId(anchor, jobId) {
    if (!jobId) return true;
    const candidates = [
      anchor.getAttribute("data-job-id"),
      anchor.getAttribute("data-current-job-id"),
      anchor.getAttribute("href")
    ];
    const nested = anchor.querySelector("[data-job-id], [data-current-job-id]");
    if (nested) {
      candidates.push(
        nested.getAttribute("data-job-id"),
        nested.getAttribute("data-current-job-id")
      );
    }
    for (const raw of candidates) {
      if (!raw) continue;
      if (raw.includes(jobId)) return true;
    }
    return true;
  }
  function getLinkedInTopcardJobId() {
    const fromParam = new URL(window.location.href).searchParams.get("currentJobId");
    if (fromParam) return fromParam;
    const viewMatch = window.location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];
    return null;
  }
  function extractPostedAt(root) {
    const spans = queryDeepAll("span.tvm__text--positive", root);
    for (const span of spans) {
      let context = "";
      let node = span;
      for (let depth = 0; depth < 4 && node; depth++) {
        const text2 = cleanText(getDeepText(node));
        if (text2 && text2.toLowerCase().includes("ago")) {
          context = text2;
          break;
        }
        node = node.parentElement;
      }
      const text = context || cleanText(getDeepText(span));
      if (text) return text;
    }
    return "";
  }
  function extractJobTitle(root) {
    const unifiedTitle = queryDeepTextFromSelectors(
      LEGACY_UNIFIED_TOP_CARD_SELECTORS.title,
      root
    );
    if (unifiedTitle.length > 2 && unifiedTitle.length < 250) return unifiedTitle;
    const titleSelectors = [
      '[componentkey^="JobDetails_"] a[href*="/jobs/view/"]',
      'a[href*="/jobs/view/"]'
    ];
    for (const selector of titleSelectors) {
      const link = root.querySelector(selector);
      const title = cleanText(link?.textContent || "");
      if (title.length > 2 && title.length < 250) return title;
    }
    const topcardJobId = getLinkedInTopcardJobId();
    const titleAnchors = queryDeepAll(TOPCARD_TITLE_ANCHOR_SELECTOR, root);
    for (const anchor of titleAnchors) {
      if (topcardJobId && !anchorMatchesJobId(anchor, topcardJobId)) continue;
      const heading = anchor.querySelector("h2");
      const headingText = cleanText(heading?.textContent || "");
      if (headingText.length > 2 && headingText.length < 250) return headingText;
      const directText = cleanText(anchor.textContent || "");
      if (directText.length > 2 && directText.length < 250) return directText;
      const ariaLabel = anchor.getAttribute("aria-label") || "";
      if (ariaLabel.trim().length > 2 && ariaLabel.trim().length < 250) {
        return cleanText(ariaLabel);
      }
    }
    const legacyTitle = queryDeepText("[data-test-job-details-header] h1", root) || queryDeepText("h1", root);
    return cleanText(legacyTitle);
  }
  function extractCompanyName(root) {
    const topcardJobId = getLinkedInTopcardJobId();
    const orgAnchors = queryDeepAll(TOPCARD_COMPANY_ANCHOR_SELECTOR, root);
    for (const anchor of orgAnchors) {
      if (topcardJobId && !anchorMatchesJobId(anchor, topcardJobId)) continue;
      const name = cleanText(anchor.textContent || "");
      if (name) return name;
    }
    const logoAnchors = queryDeepAll(TOPCARD_LOGO_ANCHOR_SELECTOR, root);
    for (const anchor of logoAnchors) {
      if (topcardJobId && !anchorMatchesJobId(anchor, topcardJobId)) continue;
      const ariaLabel = anchor.getAttribute("aria-label");
      if (ariaLabel) {
        const cleaned = cleanText(ariaLabel);
        if (cleaned) return cleaned;
      }
      const img = anchor.querySelector("img");
      const alt = cleanText(img?.getAttribute("alt") || "");
      if (alt && !alt.toLowerCase().includes("logo")) return alt;
    }
    const unifiedCompany = queryDeepTextFromSelectors(
      LEGACY_UNIFIED_TOP_CARD_SELECTORS.company,
      root
    );
    if (unifiedCompany) return unifiedCompany;
    const ariaCompanies = queryDeepAll('[aria-label^="Company,"]', root);
    for (const el of ariaCompanies) {
      const match = el.getAttribute("aria-label")?.match(/Company,\s*(.+?)\.?$/);
      if (match?.[1]) {
        const cleaned = cleanText(match[1]);
        if (cleaned) return cleaned;
      }
    }
    const logoLinks = queryDeepAll('a[aria-label$=" logo"]', root);
    for (const link of logoLinks) {
      const fromAria = link.getAttribute("aria-label")?.replace(/\s+logo$/i, "").trim();
      if (fromAria) return cleanText(fromAria);
    }
    const companyLinks = queryDeepAll('a[href*="/company/"]', root);
    for (const link of companyLinks) {
      const href = link.getAttribute("href") || "";
      if (!href.includes("/company/")) continue;
      const name = cleanText(link.textContent || "");
      const lower = name.toLowerCase();
      if (name && name.length < 100 && !lower.includes("follow") && !lower.includes("show more") && !lower.includes("life/") && !lower.includes("insights")) {
        return name;
      }
    }
    return cleanText(queryDeepText(".topcard__org-name-link", root));
  }
  function extractCompanyLogoUrl(root) {
    const topcardJobId = getLinkedInTopcardJobId();
    const logoAnchors = queryDeepAll(TOPCARD_LOGO_ANCHOR_SELECTOR, root);
    for (const anchor of logoAnchors) {
      if (topcardJobId && !anchorMatchesJobId(anchor, topcardJobId)) continue;
      const img = anchor.querySelector("img");
      if (!img) continue;
      const src = img.currentSrc || img.src || img.getAttribute("src") || "";
      if (/^https?:\/\//.test(src)) return src;
    }
    const linkedinImages = queryDeepAll(
      'img[src*="media.licdn.com/dms/image"]',
      root
    );
    for (const img of linkedinImages) {
      const src = img.currentSrc || img.src || "";
      if (src.startsWith("http")) return src;
    }
    const genericLicdn = queryDeepAll(
      'img[src*="licdn.com"]',
      root
    );
    for (const img of genericLicdn) {
      const src = img.currentSrc || img.src || "";
      if (!src.startsWith("http")) continue;
      const alt = (img.alt || "").toLowerCase();
      if (alt && !alt.includes("company") && !alt.includes("logo") && !alt.includes("employer")) {
        continue;
      }
      return src;
    }
    const topCardLogo = queryDeep(
      '.job-details-jobs-unified-top-card__container img[src*="licdn.com"]',
      root
    );
    if (topCardLogo?.src?.startsWith("http")) return topCardLogo.src;
    const logoImages = root.querySelectorAll(
      'img[alt*="Company logo for"], img[alt$=" logo"], img[alt*="company logo"]'
    );
    for (const img of logoImages) {
      const src = img.currentSrc || img.src || "";
      if (src.startsWith("http")) return src;
    }
    const companyBlock = root.querySelector('[aria-label^="Company,"]');
    if (companyBlock) {
      const img = companyBlock.querySelector('img[src*="licdn.com"]');
      if (img?.src?.startsWith("http")) return img.src;
    }
    const aboutCompanyImg = queryDeep(
      '.jobs-company img[src*="licdn.com"]',
      root
    );
    if (aboutCompanyImg?.src?.startsWith("http")) return aboutCompanyImg.src;
    const svg = companyBlock?.querySelector("svg") || root.querySelector('figure svg[id*="company-accent"]');
    if (svg) {
      const svgString = new XMLSerializer().serializeToString(svg);
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
    }
    return "";
  }
  function extractWorkTypePreferences(root) {
    const container = queryDeep(".job-details-fit-level-preferences", root);
    if (!container) return [];
    return Array.from(
      container.querySelectorAll("button .tvm__text strong, button strong")
    ).map((el) => cleanText(el.textContent || "")).filter(Boolean);
  }
  function extractLocation(root) {
    for (const selector of LEGACY_UNIFIED_TOP_CARD_SELECTORS.location) {
      const container = queryDeep(selector, root);
      if (!container) continue;
      const emphasisSpans = container.querySelectorAll(".tvm__text--low-emphasis");
      for (const span of emphasisSpans) {
        const candidate = cleanText(span.textContent || "");
        if (!candidate || isLocationMetaNoise(candidate)) continue;
        const workTypes = extractWorkTypePreferences(root);
        if (workTypes.length) {
          return `${candidate} \xB7 ${workTypes.join(" \xB7 ")}`;
        }
        return candidate;
      }
      const legacyText = cleanText(getDeepText(container));
      const firstSegment = cleanText(legacyText.split("\xB7")[0] || legacyText);
      if (firstSegment && !isLocationMetaNoise(firstSegment)) {
        const workTypes = extractWorkTypePreferences(root);
        if (workTypes.length) {
          return `${firstSegment} \xB7 ${workTypes.join(" \xB7 ")}`;
        }
        return firstSegment;
      }
    }
    const metaParagraphs = root.querySelectorAll("p");
    for (const p of metaParagraphs) {
      const text = p.textContent || "";
      if (!text.includes("\xB7")) continue;
      const firstSpan = p.querySelector("span");
      const candidate = cleanText(firstSpan?.textContent || "");
      if (!candidate || isLocationMetaNoise(candidate)) continue;
      return candidate;
    }
    return "";
  }
  function extractJobDescription(root = document) {
    const aboutJob = queryDeep(ABOUT_THE_JOB_SELECTOR, root) || queryDeep('[componentkey^="JobDetails_AboutTheJob_"] [data-sdui-component*="aboutTheJob"]', root) || queryDeep('[data-sdui-component*="aboutTheJob"]', root);
    if (aboutJob) {
      const expandable = aboutJob.querySelector('[data-testid="expandable-text-box"]');
      if (expandable) {
        const text = cleanJobDescription(getDeepText(expandable));
        if (text.length > 50) return text;
      }
      const paragraphs = aboutJob.querySelectorAll("p");
      for (const p of paragraphs) {
        const text = cleanJobDescription(getDeepText(p));
        if (text.length > 100) return text;
      }
      const sectionText = cleanJobDescription(getDeepText(aboutJob));
      if (sectionText.length > 50) return sectionText;
    }
    const fallbackSelectors = [
      '[data-testid="expandable-text-box"]',
      ...LEGACY_UNIFIED_TOP_CARD_SELECTORS.description
    ];
    for (const selector of fallbackSelectors) {
      const el = queryDeep(selector, root);
      const text = el ? cleanJobDescription(getDeepText(el)) : "";
      if (text.length > 50) return text;
    }
    return "";
  }
  function extractSkillsFromText(text) {
    const skills = /* @__PURE__ */ new Set();
    const commonSkills = [
      "JavaScript",
      "TypeScript",
      "Python",
      "Java",
      "React",
      "Node.js",
      "Angular",
      "Vue",
      "SQL",
      "PostgreSQL",
      "MongoDB",
      "AWS",
      "Azure",
      "GCP",
      "Docker",
      "Kubernetes",
      "Git",
      "CI/CD",
      "Agile",
      "Scrum",
      "REST",
      "GraphQL",
      "HTML",
      "CSS",
      "C++",
      "C#",
      ".NET",
      "Go",
      "Rust",
      "Ruby",
      "PHP",
      "Machine Learning",
      "Data Analysis",
      "Project Management",
      "Leadership",
      "Communication",
      "Problem Solving",
      "Team Collaboration",
      "Excel",
      "Power BI",
      "Tableau",
      "Figma",
      "Jira",
      "Confluence",
      "Terraform",
      "Linux",
      "Redis",
      "Elasticsearch",
      "Kafka",
      "Spark",
      "Hadoop",
      "Spring",
      "Django",
      "Flask",
      "FastAPI",
      "NestJS",
      "Next.js"
    ];
    for (const skill of commonSkills) {
      const regex = new RegExp(`\\b${skill.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(text)) skills.add(skill);
    }
    const skillPatterns = [
      /(?:required|must have|proficien\w+ in|experience with|knowledge of)\s*:?\s*([^.!?\n]+)/gi,
      /(?:skills?|technologies?|tools?)\s*:?\s*([^.!?\n]+)/gi
    ];
    for (const pattern of skillPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        match[1].split(/[,;|•·]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 50).forEach((s) => skills.add(s));
      }
    }
    return Array.from(skills).slice(0, 20);
  }
  function isJobPage() {
    const href = window.location.href;
    const onJobUrl = href.includes("/jobs/view/") || href.includes("/jobs/collections/") || href.includes("/jobs/search-results/") || href.includes("currentJobId=") || /\/jobs\/[^/?#]+/.test(href);
    return onJobUrl || queryDeep(`[data-sdui-screen="${JOB_DETAILS_SCREEN}"]`) !== null || queryDeep(ABOUT_THE_JOB_SELECTOR) !== null || queryDeep('[componentkey^="JobDetails_AboutTheJob_"]') !== null || queryDeep(".jobs-unified-top-card") !== null || queryDeep(".job-details-jobs-unified-top-card") !== null || queryDeep(".jobs-details__main-content") !== null || queryDeep(".jobs-search__job-details") !== null || queryDeep("#job-details") !== null || queryDeep("[data-job-id]") !== null;
  }
  async function extractJob(options = {}) {
    if (!isJobPage()) return null;
    const root = getJobDetailsRoot();
    tryExpandJobDescription(root);
    const jobTitle = extractJobTitle(root);
    const companyName = extractCompanyName(root);
    const location = extractLocation(root);
    const companyLogoUrl = extractCompanyLogoUrl(root);
    const jobDescription = extractJobDescription(root);
    const postedAt = extractPostedAt(root);
    if (!jobTitle && !companyName && !jobDescription) return null;
    const hardSkills = extractSkillsFromText(jobDescription);
    const competencies = extractSkillsFromText(
      jobDescription.replace(/technical|hard/gi, "competency")
    ).filter((s) => !hardSkills.includes(s));
    const linkedInJobUrl = extractJobUrl(root);
    const linkedInJobId = extractJobId(root) || void 0;
    const applyMethod = detectApplyMethod(root);
    const realJobUrl = await extractRealJobUrl(
      root,
      linkedInJobId || extractJobId(root),
      options
    );
    return {
      companyName: companyName || "Unknown Company",
      jobTitle: jobTitle || "Unknown Position",
      jobDescription: jobDescription || "",
      hardSkills,
      competencies: competencies.slice(0, 10),
      location,
      jobUrl: linkedInJobUrl,
      linkedInJobUrl,
      linkedInJobId,
      realJobUrl: realJobUrl || void 0,
      companyLogoUrl: companyLogoUrl || void 0,
      applyMethod,
      postedAt: postedAt || void 0
    };
  }

  // src/content.ts
  var CONTENT_SCRIPT_FLAG = "__liJobScraperContentLoaded";
  var LAST_URL_KEY = "__liJobScraperLastUrl";
  function isExtensionRuntimeValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }
  function shouldInitialize() {
    const flag = window[CONTENT_SCRIPT_FLAG];
    if (!flag) return true;
    return !isExtensionRuntimeValid();
  }
  if (!shouldInitialize()) {
  } else {
    let jobPublishKey = function(job) {
      return job.linkedInJobId?.trim() || job.linkedInJobUrl?.trim() || job.jobUrl?.trim() || `${job.jobTitle}|${job.companyName}`;
    }, normalizeTitle = function(title) {
      const value = title?.trim() || "";
      if (!value || value.toLowerCase() === "unknown position") return "";
      return value;
    }, normalizeCompany = function(company) {
      const value = company?.trim() || "";
      if (!value || value.toLowerCase() === "unknown company") return "";
      return value;
    }, recordPublishedState = function(job, descriptionLength) {
      lastPublishedKey = jobPublishKey(job);
      lastPublishedDescriptionLength = descriptionLength;
      lastPublishedTitle = normalizeTitle(job.jobTitle);
      lastPublishedCompany = normalizeCompany(job.companyName);
    }, shouldPublishJob = function(job) {
      const key = jobPublishKey(job);
      const descriptionLength = job.jobDescription?.trim().length || 0;
      const title = normalizeTitle(job.jobTitle);
      const company = normalizeCompany(job.companyName);
      if (!key) {
        return descriptionLength > 0 || Boolean(title) || Boolean(company);
      }
      if (key !== lastPublishedKey) {
        recordPublishedState(job, descriptionLength);
        return true;
      }
      if (descriptionLength > lastPublishedDescriptionLength + 30) {
        recordPublishedState(job, descriptionLength);
        return true;
      }
      if (title && title !== lastPublishedTitle) {
        recordPublishedState(job, descriptionLength);
        return true;
      }
      if (company && company !== lastPublishedCompany) {
        recordPublishedState(job, descriptionLength);
        return true;
      }
      return false;
    }, notifyJobUpdate = function() {
      if (!isExtensionRuntimeValid()) {
        observer.disconnect();
        return;
      }
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = setTimeout(() => {
        if (!isExtensionRuntimeValid()) return;
        void extractJob({ allowVoyagerFetch: true }).then((job) => {
          if (!job || !shouldPublishJob(job)) return;
          chrome.runtime.sendMessage({ type: "JOB_DETECTED", job }).catch(() => {
          });
        });
      }, 500);
    }, getCurrentUrl = function() {
      return window.location.href;
    }, handleUrlChange = function() {
      const w = window;
      const currentUrl = getCurrentUrl();
      if (w[LAST_URL_KEY] === currentUrl) return;
      w[LAST_URL_KEY] = currentUrl;
      lastPublishedKey = "";
      lastPublishedDescriptionLength = 0;
      lastPublishedTitle = "";
      lastPublishedCompany = "";
      notifyJobUpdate();
    }, setupUrlChangeListener = function() {
      const w = window;
      w[LAST_URL_KEY] = getCurrentUrl();
      window.addEventListener("popstate", handleUrlChange);
      window.addEventListener("hashchange", handleUrlChange);
      const originalPushState = history.pushState.bind(history);
      history.pushState = function pushState(...args) {
        const result = originalPushState.apply(history, args);
        handleUrlChange();
        return result;
      };
      const originalReplaceState = history.replaceState.bind(history);
      history.replaceState = function replaceState(...args) {
        const result = originalReplaceState.apply(history, args);
        handleUrlChange();
        return result;
      };
    };
    window[CONTENT_SCRIPT_FLAG] = true;
    bindVoyagerJobPostingListener();
    let notifyTimer = null;
    let lastPublishedKey = "";
    let lastPublishedDescriptionLength = 0;
    let lastPublishedTitle = "";
    let lastPublishedCompany = "";
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "PING") {
        sendResponse({ ok: true });
        return true;
      }
      if (message.type === "EXTRACT_JOB") {
        void extractJob({ allowVoyagerFetch: true }).then((job) => sendResponse({ job }));
        return true;
      }
    });
    const observer = new MutationObserver(notifyJobUpdate);
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      setupUrlChangeListener();
      notifyJobUpdate();
    }
  }
})();
//# sourceMappingURL=content.js.map
