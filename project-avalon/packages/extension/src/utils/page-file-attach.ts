import { FILE_TARGET_ATTR } from './injection-plan-runner';

const CHUNK_SIZE = 48_000;
const DONE_EVENT = 'avalon-attach-done';
const CHUNK_EVENT = 'avalon-b64-chunk';
const FINISH_EVENT = 'avalon-b64-finish';
const MSG_FROM_CONTENT = 'avalon-content-script';
const MSG_FROM_PAGE = 'avalon-page-script';
const ATTACH_TIMEOUT_MS = 90_000;

/** Inject a one-shot script that runs in the page's JS world (not the isolated content world). */
function injectPageScript(source: string): void {
  const script = document.createElement('script');
  script.textContent = source;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

/** Install the page-world listener (postMessage — CustomEvents do not cross isolated worlds). */
function ensurePageAttachListener(): void {
  const flag = 'data-avalon-page-attach-ready';
  if (document.documentElement.getAttribute(flag)) return;
  document.documentElement.setAttribute(flag, '1');

  injectPageScript(`(function(){
    if (window.__avalonPageAttachReady) return;
    window.__avalonPageAttachReady = true;
    var chunks = [];
    window.addEventListener('message', function(e) {
      var d = e.data;
      if (!d || d.source !== '${MSG_FROM_CONTENT}') return;
      if (d.type === '${CHUNK_EVENT}') {
        chunks.push(d.chunk || '');
        return;
      }
      if (d.type !== '${FINISH_EVENT}') return;
      var attr = d.attr || '${FILE_TARGET_ATTR}';
      var name = d.name || 'resume.pdf';
      var mime = d.mime || 'application/pdf';
      var attached = 0;
      var errors = [];
      try {
        var b64 = chunks.join('');
        chunks = [];
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var file = new File([bytes], name, { type: mime });
        var nodes = document.querySelectorAll('[' + attr + ']');
        nodes.forEach(function(node) {
          var input = node;
          try {
            var dt = new DataTransfer();
            dt.items.add(file);
            var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
            if (desc && desc.set) desc.set.call(input, dt.files);
            else input.files = dt.files;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (input.files && input.files.length > 0) attached += 1;
            else errors.push('files empty after assign: ' + (input.id || input.name || 'input'));
          } catch (err) {
            errors.push(String(err));
          }
          input.removeAttribute(attr);
        });
        window.postMessage({
          source: '${MSG_FROM_PAGE}',
          type: '${DONE_EVENT}',
          detail: { attached: attached, found: nodes.length, errors: errors }
        }, '*');
      } catch (err) {
        window.postMessage({
          source: '${MSG_FROM_PAGE}',
          type: '${DONE_EVENT}',
          detail: { attached: 0, found: 0, errors: [String(err)] }
        }, '*');
      }
    });
  })();`);
}

/**
 * Assign a PDF to every input tagged with FILE_TARGET_ATTR using the page's own
 * JS context (required for React uploaders that ignore extension-world assigns).
 */
export function attachTaggedFilesInPageContext(
  base64: string,
  name: string,
  mime: string,
): Promise<{ attached: number; found: number; errors: string[] }> {
  ensurePageAttachListener();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onPageMessage);
      reject(new Error('Résumé attach timed out — page script did not respond'));
    }, ATTACH_TIMEOUT_MS);

    const onPageMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        detail?: { attached?: number; found?: number; errors?: string[] };
      };
      if (data?.source !== MSG_FROM_PAGE || data.type !== DONE_EVENT) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onPageMessage);
      resolve({
        attached: data.detail?.attached ?? 0,
        found: data.detail?.found ?? 0,
        errors: data.detail?.errors ?? [],
      });
    };

    window.addEventListener('message', onPageMessage);

    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      window.postMessage(
        {
          source: MSG_FROM_CONTENT,
          type: CHUNK_EVENT,
          chunk: base64.slice(i, i + CHUNK_SIZE),
        },
        '*',
      );
    }

    window.postMessage(
      {
        source: MSG_FROM_CONTENT,
        type: FINISH_EVENT,
        attr: FILE_TARGET_ATTR,
        name,
        mime,
      },
      '*',
    );
  });
}
