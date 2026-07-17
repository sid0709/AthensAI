(function () {
  if (window.__bidMonitorHookInjected) return;

  try {
    if (!chrome.runtime?.id) return;
  } catch {
    return;
  }

  window.__bidMonitorHookInjected = true;

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/page-hook.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head || document).appendChild(script);
})();
