import { findElementByTarget, type TargetSelector } from '@avalon/shared';
import {
  findListboxForInput,
  getComboboxInput,
  isVisibleListbox,
  optionsFromListbox,
  resolveInputTarget,
} from './dom-analytics.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** React-controlled inputs need native setter + InputEvent, not .value = alone. */
export function setNativeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // The value setter lives on the element's own prototype — using the wrong one
  // (e.g. the HTMLInputElement setter on a <textarea>) throws "Illegal invocation".
  const proto =
    input.tagName === 'TEXTAREA' && typeof HTMLTextAreaElement !== 'undefined'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(input, value);
  const view = input.ownerDocument.defaultView;
  if (view && typeof view.InputEvent !== 'undefined') {
    input.dispatchEvent(
      new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
    );
  } else if (view) {
    input.dispatchEvent(new view.Event('input', { bubbles: true }));
  }
}

export function resolveComboboxInput(target: TargetSelector): HTMLInputElement | null {
  const matched = findElementByTarget(document, target);
  if (!matched) return null;
  const element = resolveInputTarget(matched);
  if (element instanceof HTMLInputElement) {
    if (getComboboxInput(element) || element.getAttribute('role') === 'combobox') {
      return element;
    }
    return element;
  }
  const nested = getComboboxInput(element);
  return nested;
}

export function harvestVisibleOptions(input: HTMLInputElement): string[] {
  const listbox = findListboxForInput(input);
  if (!listbox || !isVisibleListbox(listbox)) return [];
  return optionsFromListbox(listbox).map((o) => o.label).filter(Boolean);
}

export function waitForComboboxOptions(
  input: HTMLInputElement,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(ready);
    };

    const check = (): boolean => harvestVisibleOptions(input).length > 0;

    const observer = new MutationObserver(() => {
      if (check()) finish(true);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'class', 'style', 'aria-hidden', 'hidden'],
    });

    const timer = setTimeout(() => finish(check()), timeoutMs);
    if (check()) finish(true);
  });
}

/** Type into autocomplete combobox with keyboard + input events (works with React). */
export async function typeComboboxText(
  input: HTMLInputElement,
  text: string,
  delayMs = 35,
): Promise<void> {
  input.focus();
  setNativeInputValue(input, '');

  for (const ch of text) {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }),
    );
    setNativeInputValue(input, input.value + ch);
    input.dispatchEvent(
      new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }),
    );
    await sleep(delayMs + Math.floor(Math.random() * Math.max(8, delayMs * 0.35)));
  }
}

export async function applyComboboxTyping(
  target: TargetSelector,
  text: string,
  delayMs: number,
  optionsTimeoutMs: number,
): Promise<{ optionsLoaded: boolean; value: string }> {
  const input = resolveComboboxInput(target);
  if (!input) {
    throw new Error('Combobox input not found');
  }

  input.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
  await typeComboboxText(input, text, delayMs);
  const optionsLoaded = await waitForComboboxOptions(input, optionsTimeoutMs);
  return { optionsLoaded, value: input.value.trim() };
}

export function readComboboxValue(target: TargetSelector): string {
  const input = resolveComboboxInput(target);
  return input?.value.trim() ?? '';
}
