(() => {
  // src/sidebar-host.ts
  var HOST_ID = "li-job-scraper-host";
  var PAGE_STYLE_ID = "li-job-scraper-page-styles";
  var HOST_FLAG = "__liJobScraperSidebarHostLoaded";
  var SIDEBAR_WIDTH = "30vw";
  var SIDEBAR_OPEN_CLASS = "li-job-scraper-sidebar-open";
  function isExtensionRuntimeValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }
  function shouldInitializeHost() {
    const flag = window[HOST_FLAG];
    if (!flag) return true;
    return !isExtensionRuntimeValid();
  }
  function tearDownHost() {
    document.getElementById(HOST_ID)?.remove();
    document.documentElement.classList.remove(SIDEBAR_OPEN_CLASS);
    ui = null;
    isOpen = false;
  }
  function ensurePageStyles() {
    if (document.getElementById(PAGE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    style.textContent = `
    html.${SIDEBAR_OPEN_CLASS} body {
      margin-left: ${SIDEBAR_WIDTH} !important;
      transition: margin-left 0.25s ease;
    }
  `;
    document.documentElement.appendChild(style);
  }
  function reloadSidebarIframe() {
    if (!ui || !isExtensionRuntimeValid()) return;
    const nextSrc = `${chrome.runtime.getURL("sidebar.html")}?t=${Date.now()}`;
    ui.iframe.src = nextSrc;
  }
  function createHost() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
    :host {
      all: initial;
    }

    .toggle-btn {
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 14px;
      border: none;
      border-radius: 999px;
      background: #0f766e;
      color: #fff;
      font: 600 12px/1 Inter, -apple-system, BlinkMacSystemFont, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(15, 118, 110, 0.35);
      transition: left 0.25s ease, background 0.15s ease, transform 0.15s ease;
    }

    .toggle-btn:hover {
      background: #0d9488;
      transform: translateY(-1px);
    }

    .toggle-btn.open {
      left: calc(${SIDEBAR_WIDTH} + 10px);
      background: #334155;
    }

    .toggle-btn.stale {
      background: #b45309;
    }

    .toggle-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
      flex-shrink: 0;
    }

    .panel {
      position: fixed;
      top: 0;
      left: 0;
      width: ${SIDEBAR_WIDTH};
      height: 100vh;
      z-index: 2147483646;
      background: #f8fafc;
      border-right: 1px solid #e2e8f0;
      box-shadow: 8px 0 24px rgba(15, 23, 42, 0.12);
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      display: flex;
      flex-direction: column;
    }

    .panel.open {
      transform: translateX(0);
    }

    .panel iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: #f8fafc;
    }
  `;
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "li-job-scraper-toggle";
    toggleBtn.className = "toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.title = "Toggle LI Job Scraper";
    toggleBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 114.126 0 2.063 2.063 0 01-2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
    <span>LI Job Scraper</span>
  `;
    const panel = document.createElement("div");
    panel.id = "li-job-scraper-panel";
    panel.className = "panel";
    const iframe = document.createElement("iframe");
    iframe.id = "li-job-scraper-iframe";
    iframe.src = chrome.runtime.getURL("sidebar.html");
    iframe.title = "LI Job Scraper";
    panel.appendChild(iframe);
    shadow.appendChild(style);
    shadow.appendChild(toggleBtn);
    shadow.appendChild(panel);
    return { toggleBtn, panel, iframe };
  }
  var isOpen = false;
  var ui = null;
  function setSidebarOpen(open) {
    if (!ui) ui = createHost();
    ensurePageStyles();
    isOpen = open;
    ui.panel.classList.toggle("open", open);
    ui.toggleBtn.classList.toggle("open", open);
    document.documentElement.classList.toggle(SIDEBAR_OPEN_CLASS, open);
  }
  function toggleSidebar() {
    if (!isExtensionRuntimeValid()) {
      ui?.toggleBtn.classList.add("stale");
      ui?.toggleBtn.setAttribute(
        "title",
        "LI Job Scraper was updated. Refresh this LinkedIn page to continue."
      );
      return;
    }
    ui?.toggleBtn.classList.remove("stale");
    ui?.toggleBtn.setAttribute("title", "Toggle LI Job Scraper");
    setSidebarOpen(!isOpen);
  }
  function mountSidebarHost() {
    if (!isExtensionRuntimeValid()) return;
    if (ui) return;
    ui = createHost();
    ui.toggleBtn.addEventListener("click", toggleSidebar);
  }
  function initializeSidebarHost() {
    if (!shouldInitializeHost()) {
      return;
    }
    tearDownHost();
    window[HOST_FLAG] = true;
    mountSidebarHost();
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "TOGGLE_SIDEBAR") {
      if (!isExtensionRuntimeValid()) {
        sendResponse({ open: false, stale: true });
        return true;
      }
      mountSidebarHost();
      toggleSidebar();
      sendResponse({ open: isOpen });
      return true;
    }
    if (message.type === "OPEN_SIDEBAR") {
      if (!isExtensionRuntimeValid()) {
        sendResponse({ open: false, stale: true });
        return true;
      }
      mountSidebarHost();
      setSidebarOpen(true);
      sendResponse({ open: true });
      return true;
    }
    if (message.type === "CLOSE_SIDEBAR") {
      setSidebarOpen(false);
      sendResponse({ open: false });
      return true;
    }
    if (message.type === "GET_SIDEBAR_STATE") {
      sendResponse({ open: isOpen });
      return true;
    }
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "LI_JOB_SCRAPER_RELOAD_SIDEBAR") {
      return;
    }
    if (!isExtensionRuntimeValid()) {
      ui?.toggleBtn.classList.add("stale");
      window.location.reload();
      return;
    }
    reloadSidebarIframe();
  });
  initializeSidebarHost();
})();
//# sourceMappingURL=sidebar-host.js.map
