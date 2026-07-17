import { resolvePointerTarget } from './dom-analytics.js';
import {
  setNativeInputValue,
  typeComboboxText,
  waitForComboboxOptions,
} from './combobox-input.js';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Activate an element the way a real pointer would. A bare `element.click()`
 * only fires a `click` event — custom controls (segmented Yes/No toggles,
 * option pills) commonly drive their state from `pointerdown`/`mousedown`, so a
 * lone synthetic click no-ops on them. We replay the full gesture, then call the
 * native `.click()` last so the element's default activation behavior (e.g. a
 * real checkbox toggling) still runs exactly once. Option handlers set a value
 * idempotently, so firing both down and click cannot double-toggle them.
 */
function dispatchActivation(el: HTMLElement): void {
  el.focus?.();
  const view = el.ownerDocument?.defaultView ?? window;
  const opts = { bubbles: true, cancelable: true, view } as const;
  const PointerEventCtor =
    typeof view.PointerEvent === 'function' ? view.PointerEvent : null;
  const firePointer = (type: string) => {
    if (PointerEventCtor) {
      el.dispatchEvent(new PointerEventCtor(type, { ...opts, pointerType: 'mouse' }));
    }
  };
  firePointer('pointerover');
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  firePointer('pointerdown');
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  firePointer('pointerup');
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

function findByContext(contextText: string): Element | null {
  const needle = normalizeText(contextText);
  if (!needle) return null;

  const matches: Element[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    const text = normalizeText((node as HTMLElement).innerText ?? '');
    if (text.includes(needle)) matches.push(node);
    node = walker.nextNode() as Element | null;
  }

  matches.sort(
    (a, b) =>
      normalizeText((a as HTMLElement).innerText).length -
      normalizeText((b as HTMLElement).innerText).length,
  );
  return matches[0] ?? null;
}

function findField(contextText: string): Element | null {
  let node = findByContext(contextText);
  if (!node) return null;
  const hasControl = (el: Element) =>
    Boolean(
      el.querySelector(
        'input, textarea, select, [contenteditable="true"][role="textbox"], [role="combobox"]',
      ),
    );
  if (hasControl(node)) return node;
  let current: Element | null = node.parentElement;
  while (current && current !== document.body) {
    if (hasControl(current)) return current;
    current = current.parentElement;
  }
  return node;
}

export interface InjectionHelpers {
  findByContext(contextText: string): Element | null;
  findField(contextText: string): Element | null;
  click(el: Element): void;
  clickText(root: Element, label: string): Element;
  setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void;
  setRichText(el: HTMLElement, value: string): void;
  setChecked(input: HTMLInputElement, checked: boolean): void;
  selectOption(select: HTMLSelectElement, labelOrValue: string): void;
  typeCombobox(
    input: HTMLInputElement,
    text: string,
    options?: { delayMs?: number; optionsTimeoutMs?: number },
  ): Promise<boolean>;
  wait(ms: number): Promise<void>;
  q(selector: string, root?: Element): Element | null;
  qa(selector: string, root?: Element): Element[];
  text(el: Element): string;
}

export function createInjectionHelpers(): InjectionHelpers {
  return {
    findByContext,
    findField,
    click(el: Element) {
      dispatchActivation(resolvePointerTarget(el));
    },
    clickText(root: Element, label: string) {
      const needle = normalizeText(label);
      const hit =
        [...root.querySelectorAll('button, [role="button"], label, [role="option"], li, div, span')].find(
          (el) => normalizeText((el as HTMLElement).innerText ?? el.textContent ?? '') === needle,
        ) ?? null;
      if (!hit) throw new Error(`Option not found: ${label}`);
      dispatchActivation(resolvePointerTarget(hit));
      return hit;
    },
    setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
      if (!el) throw new Error('Input not found');
      setNativeInputValue(el, value);
    },
    setRichText(el: HTMLElement, value: string) {
      if (!el) throw new Error('Rich text editor not found');
      el.focus();
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      } else {
        setNativeInputValue(el as HTMLInputElement, value);
      }
    },
    setChecked(input: HTMLInputElement, checked: boolean) {
      if (input.checked === checked) return;
      resolvePointerTarget(input).click();
    },
    selectOption(select: HTMLSelectElement, labelOrValue: string) {
      const needle = labelOrValue.trim().toLowerCase();
      const option = Array.from(select.options).find(
        (o) =>
          o.value.trim().toLowerCase() === needle ||
          o.label.trim().toLowerCase() === needle ||
          o.textContent?.trim().toLowerCase() === needle,
      );
      if (!option) throw new Error(`Option not found: ${labelOrValue}`);
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async typeCombobox(input, text, options = {}) {
      await typeComboboxText(input, text, options.delayMs ?? 35);
      return waitForComboboxOptions(input, options.optionsTimeoutMs ?? 4000);
    },
    wait(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    q(selector: string, root?: Element) {
      return (root ?? document).querySelector(selector);
    },
    qa(selector: string, root?: Element) {
      return Array.from((root ?? document).querySelectorAll(selector));
    },
    text(el: Element) {
      return normalizeText((el as HTMLElement).innerText ?? el.textContent ?? '');
    },
  };
}
