import type { ActionableTarget, FetchActionableTreeOptions, OptionsSource } from '@avalon/shared';
import {
  findComboboxToggle,
  findListboxForInput,
  isAsyncAutocompleteInput,
  isEffectivelyVisible,
  isListboxInternalNoise,
  isVisibleListbox,
  optionsFromListbox,
  type CompoundPhoneField,
} from './dom-analytics.js';
import {
  harvestVisibleOptions,
  setNativeInputValue,
  waitForComboboxOptions,
} from './combobox-input.js';

export interface ProbedDropdownResult {
  options: ActionableTarget['options'];
  source: OptionsSource;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const AUTOCOMPLETE_PROBE_STRINGS = ['New York', 'San Francisco', 'London', 'a'];

export function staticComboboxOptions(input: HTMLInputElement): ProbedDropdownResult | null {
  const listbox = findListboxForInput(input);
  if (!listbox) return null;
  const options = optionsFromListbox(listbox);
  if (options.length === 0) return null;
  return { options, source: 'static-listbox' };
}

function harvestOptionsForInput(input: HTMLInputElement): ActionableTarget['options'] {
  const labels = harvestVisibleOptions(input);
  if (labels.length === 0) return [];
  return labels.map((label) => ({ value: label, label }));
}

function fireMouseSequence(el: HTMLElement): void {
  if (typeof PointerEvent !== 'undefined') {
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    return;
  }
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
}

function typeInputCharByChar(input: HTMLInputElement, text: string): void {
  setNativeInputValue(input, '');
  for (const ch of text) {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }),
    );
    setNativeInputValue(input, input.value + ch);
    input.dispatchEvent(
      new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }),
    );
  }
}

function dispatchEscape(): void {
  const init = { key: 'Escape', bubbles: true, cancelable: true };
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', init));
  document.body.dispatchEvent(new KeyboardEvent('keydown', init));
}

export function closeDropdown(): void {
  dispatchEscape();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

export function waitForDropdownWithObserver(
  input: HTMLInputElement,
  timeoutMs: number,
  checkFn: () => ActionableTarget['options'],
): Promise<ActionableTarget['options']> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (options: ActionableTarget['options']) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(options);
    };

    const observer = new MutationObserver(() => {
      const options = checkFn();
      if (options.length > 0) finish(options);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'class', 'style', 'aria-hidden', 'hidden'],
    });

    const timer = setTimeout(() => finish(checkFn()), timeoutMs);

    void checkFn();
  });
}

async function triggerDropdownOpen(input: HTMLInputElement): Promise<void> {
  input.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  closeDropdown();

  input.focus();
  input.click();

  const toggle = findComboboxToggle(input);
  if (toggle) {
    fireMouseSequence(toggle);
    toggle.click();
  } else {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
  }
}

async function probeInputByFocus(
  input: HTMLInputElement,
  timeoutMs: number,
): Promise<ProbedDropdownResult | null> {
  const staticResult = staticComboboxOptions(input);
  if (staticResult) return staticResult;

  await triggerDropdownOpen(input);
  let options = await waitForDropdownWithObserver(input, Math.min(180, timeoutMs), () =>
    harvestOptionsForInput(input),
  );

  if (options.length === 0) {
    const autocompleteTimeout = Math.max(timeoutMs, 1200);
    const probeStrings = isAsyncAutocompleteInput(input)
      ? AUTOCOMPLETE_PROBE_STRINGS
      : ['a'];

    for (const text of probeStrings) {
      typeInputCharByChar(input, text);
      options = await waitForDropdownWithObserver(input, autocompleteTimeout, () =>
        harvestOptionsForInput(input),
      );
      if (options.length > 0) break;
      setNativeInputValue(input, '');
    }
  }

  if (input.value) {
    setNativeInputValue(input, '');
  }
  closeDropdown();

  if (options.length === 0) return null;
  return { options, source: 'probed' };
}

async function probeCountryToggleByFocus(
  toggle: HTMLElement,
  widgetRoot: Element,
  timeoutMs: number,
): Promise<ProbedDropdownResult | null> {
  toggle.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  closeDropdown();
  fireMouseSequence(toggle);
  toggle.click();

  const options = await waitForDropdownWithObserver(toggle as unknown as HTMLInputElement, timeoutMs, () => {
    const listbox = widgetRoot.querySelector('[role="listbox"]') ?? document.querySelector('[role="listbox"]');
    return listbox && isVisibleListbox(listbox) ? optionsFromListbox(listbox) : [];
  });

  if (toggle.getAttribute('aria-expanded') === 'true') {
    toggle.click();
  }
  closeDropdown();

  if (options.length === 0) return null;
  return { options, source: 'probed' };
}

/**
 * True when an input advertises, via portable semantics, that it holds a
 * short code rather than a searchable combobox — e.g. one-time-code / OTP
 * boxes. Typing a probe character into these corrupts the field and never
 * opens a listbox, so they must be excluded from focus probing. All signals
 * are standard HTML/ARIA, not vendor classes.
 */
function isNonComboboxCodeInput(input: HTMLInputElement): boolean {
  // Explicit combobox affordances always qualify for probing, even if short.
  if (
    input.getAttribute('role') === 'combobox' ||
    input.getAttribute('aria-autocomplete') === 'list' ||
    input.getAttribute('aria-haspopup') === 'listbox' ||
    input.hasAttribute('aria-controls')
  ) {
    return false;
  }
  const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase();
  if (autocomplete === 'one-time-code') return true;
  // Single/double-character boxes (OTP digit cells) can never be comboboxes.
  if (input.maxLength > 0 && input.maxLength <= 2) return true;
  return false;
}

export function collectFocusProbeCandidates(
  scope: Element,
  skipElements: Set<Element> = new Set(),
): HTMLInputElement[] {
  const candidates: HTMLInputElement[] = [];
  const seen = new Set<Element>();

  for (const el of scope.querySelectorAll(
    'input:not([type]), input[type="text"], input[type="search"], input[role="combobox"], textarea',
  )) {
    if (!(el instanceof HTMLInputElement)) continue;
    if (skipElements.has(el) || seen.has(el)) continue;
    if (isListboxInternalNoise(el)) continue;
    if (isNonComboboxCodeInput(el)) continue;
    if (!isEffectivelyVisible(el)) continue;
    seen.add(el);
    candidates.push(el);
  }

  return candidates;
}

function cacheResult(
  cache: Map<Element, ProbedDropdownResult>,
  seed: Element,
  result: ProbedDropdownResult,
): void {
  cache.set(seed, result);
}

export async function probeDropdownsByFocus(
  candidates: HTMLInputElement[],
  phoneFields: CompoundPhoneField[],
  fetchOptions: FetchActionableTreeOptions = {},
): Promise<Map<Element, ProbedDropdownResult>> {
  const cache = new Map<Element, ProbedDropdownResult>();
  if (fetchOptions.probeComboboxes === false) return cache;

  const timeout = fetchOptions.probeTimeoutMs ?? 350;
  const phoneComboboxes = new Set(
    phoneFields.flatMap((w) => (w.countryCombobox ? [w.countryCombobox] : [])),
  );

  for (const widget of phoneFields) {
    let result: ProbedDropdownResult | null = null;
    if (widget.countryCombobox) {
      result = await probeInputByFocus(widget.countryCombobox, timeout);
    }
    if ((!result || !result.options?.length) && widget.countryToggle) {
      result = await probeCountryToggleByFocus(
        widget.countryToggle,
        widget.widgetRoot,
        timeout,
      );
    }
    if (result?.options?.length) {
      const seed = widget.countryCombobox ?? widget.countryToggle!;
      cacheResult(cache, seed, result);
      if (widget.countryCombobox) cacheResult(cache, widget.countryCombobox, result);
      if (widget.countryToggle) cacheResult(cache, widget.countryToggle, result);
    }
    closeDropdown();
    await sleep(30);
  }

  for (const input of candidates) {
    if (cache.has(input) || phoneComboboxes.has(input)) continue;
    const result = await probeInputByFocus(input, timeout);
    if (result?.options?.length) {
      cache.set(input, result);
    }
    closeDropdown();
    await sleep(30);
  }

  closeDropdown();
  return cache;
}
