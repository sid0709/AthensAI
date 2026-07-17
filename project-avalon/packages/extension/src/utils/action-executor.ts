import type { ActionResult, RemoteAction } from '@avalon/shared';
import { findElementByTarget } from '@avalon/shared';
import { fetchActionableTree } from './actionable-tree';
import { clearHighlights, highlightElement } from './highlight';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchPointer(element: Element, type: string) {
  element.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
  );
}

function base64ToFile(name: string, mimeType: string, base64: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], name, { type: mimeType });
}

async function setInputFiles(
  input: HTMLInputElement,
  files: Array<{ name: string; mimeType: string; base64: string }>,
) {
  const dt = new DataTransfer();
  for (const file of files) {
    dt.items.add(base64ToFile(file.name, file.mimeType, file.base64));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function executeRemoteAction(action: RemoteAction): Promise<ActionResult> {
  try {
    const data = await runAction(action);
    return { actionId: action.id, success: true, data };
  } catch (error) {
    return {
      actionId: action?.id ?? '',
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runAction(action: RemoteAction): Promise<unknown> {
  const payload = action.payload ?? {};

  switch (action.action) {
    case 'wait':
      await sleep(Number(payload.ms ?? 500));
      return { waitedMs: Number(payload.ms ?? 500) };

    case 'scroll_by':
      window.scrollBy(Number(payload.x ?? 0), Number(payload.y ?? 400));
      return { scrolled: true };

    case 'execute_script': {
      const source = String(payload.source ?? 'true');
      // eslint-disable-next-line no-new-func
      const fn = new Function(source);
      return fn();
    }

    case 'clear_highlight':
      clearHighlights();
      return { cleared: true };

    case 'fetch_actionable_tree':
      return {
        tree: await fetchActionableTree(document.body, {
          probeComboboxes: payload.probeComboboxes === true,
          probeTimeoutMs:
            payload.probeTimeoutMs != null ? Number(payload.probeTimeoutMs) : 350,
        }),
      };

    default: {
      if (!action.target) {
        throw new Error(`Action "${action.action}" requires a target`);
      }
      const element = findElementByTarget(document, action.target);
      if (!element) {
        throw new Error(`No element matched target ${JSON.stringify(action.target)}`);
      }

      switch (action.action) {
        case 'click':
          (element as HTMLElement).click();
          return { clicked: true };

        case 'double_click':
          dispatchPointer(element, 'dblclick');
          return { doubleClicked: true };

        case 'right_click':
          dispatchPointer(element, 'contextmenu');
          return { rightClicked: true };

        case 'type': {
          const input = element as HTMLInputElement | HTMLTextAreaElement;
          input.focus();
          input.value = String(payload.text ?? '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { typed: input.value };
        }

        case 'clear': {
          const input = element as HTMLInputElement | HTMLTextAreaElement;
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { cleared: true };
        }

        case 'set_focus':
          (element as HTMLElement).focus();
          return { focused: true };

        case 'blur':
          (element as HTMLElement).blur();
          return { blurred: true };

        case 'file_upload': {
          const input = element as HTMLInputElement;
          if (input.type !== 'file') {
            throw new Error('Target is not a file input');
          }
          const files = payload.files as Array<{ name: string; mimeType: string; base64: string }>;
          if (!Array.isArray(files) || files.length === 0) {
            throw new Error('payload.files must be a non-empty array');
          }
          await setInputFiles(input, files);
          return { uploaded: files.map((f) => f.name) };
        }

        case 'scroll_into_view':
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { scrolledIntoView: true };

        case 'hover':
          dispatchPointer(element, 'mouseover');
          dispatchPointer(element, 'mouseenter');
          return { hovered: true };

        case 'highlight': {
          const durationMs = payload.durationMs != null ? Number(payload.durationMs) : undefined;
          return highlightElement(element, durationMs);
        }

        case 'select_option': {
          const select = element as HTMLSelectElement;
          const value = String(payload.value ?? payload.text ?? '');
          select.value = value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { value: select.value };
        }

        case 'key_press': {
          const key = String(payload.key ?? 'Enter');
          (element as HTMLElement).focus();
          element.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          );
          element.dispatchEvent(
            new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }),
          );
          return { key };
        }

        case 'get_text':
          return { text: (element.textContent ?? '').trim() };

        case 'get_attribute': {
          const name = String(payload.name ?? 'id');
          return { name, value: element.getAttribute(name) };
        }

        case 'set_attribute': {
          const name = String(payload.name ?? 'data-avalon');
          const value = String(payload.value ?? '');
          element.setAttribute(name, value);
          return { name, value };
        }

        default:
          throw new Error(`Unsupported page action: ${action.action}`);
      }
    }
  }
}
