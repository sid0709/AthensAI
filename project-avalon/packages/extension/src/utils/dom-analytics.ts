/**
 * Platform-agnostic DOM analysis utilities.
 * Uses semantic HTML, ARIA, and structural relationships — never vendor class names.
 */

import type { ActionableTarget } from '@avalon/shared';

export function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const GENERIC_PLACEHOLDERS = new Set([
  'select...',
  'select',
  'choose...',
  'choose',
  'pick...',
  'pick',
  '',
]);

export function isGenericPlaceholder(text: string): boolean {
  return GENERIC_PLACEHOLDERS.has(text.trim().toLowerCase());
}

function isOpaqueIdentifier(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true;
  }
  if (value.length >= 24 && /^[0-9a-f_-]+$/i.test(value)) return true;
  return false;
}

function isHumanReadableChoiceToken(text: string): boolean {
  const value = text.trim();
  if (!value || isGenericPlaceholder(value) || isOpaqueIdentifier(value)) return false;
  return /[a-z]/i.test(value);
}

export function resolveLabelledByText(labelledBy: string | null): string {
  if (!labelledBy) return '';
  return labelledBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

export function elementText(el: Element): string {
  return ((el as HTMLElement).innerText ?? '').trim();
}

export function visibleText(el: Element): string {
  return elementText(el) || (el.textContent ?? '').trim();
}

export function isHiddenByStyle(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return true;
  if (parseFloat(style.opacity) === 0) return true;
  return false;
}

/** True when display/visibility hide the control (not opacity/size-only custom widgets). */
export function isStructurallyHidden(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden';
}

export function isChoiceInput(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
  );
}

/** Option label for a checkbox/radio — never the surrounding group question. */
export function getChoiceOptionLabel(input: HTMLInputElement): string {
  const id = input.id;
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    const text = label?.textContent?.trim().replace(/\*+/g, '').trim();
    if (text) return text;
  }

  const wrapping = input.closest('label');
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as Element;
    for (const control of clone.querySelectorAll('input, button, select, textarea')) {
      control.remove();
    }
    const text = visibleText(clone).replace(/\*+/g, '').trim();
    if (text) return text;
  }

  const name = input.getAttribute('name')?.trim();
  if (name && isHumanReadableChoiceToken(name)) return name;

  const value = input.getAttribute('value')?.trim();
  if (value && isHumanReadableChoiceToken(value)) return value;

  return '';
}

export function isAssociatedChoiceInput(input: HTMLInputElement): boolean {
  if (!isChoiceInput(input)) return false;
  if (input.getAttribute('aria-label')?.trim()) return true;
  if (input.getAttribute('aria-labelledby')?.trim()) return true;
  if (input.closest('label')) return true;
  if (input.id && document.querySelector(`label[for="${cssEscape(input.id)}"]`)) return true;
  const name = input.getAttribute('name')?.trim();
  if (name && isHumanReadableChoiceToken(name)) return true;
  const value = input.getAttribute('value')?.trim();
  if (value && isHumanReadableChoiceToken(value)) return true;
  return false;
}

/** Custom-styled choice control — native input is not the visible click target. */
export function isPointerDecoratedChoiceInput(input: HTMLInputElement): boolean {
  if (!isAssociatedChoiceInput(input)) return false;
  if (isStructurallyHidden(input)) return true;
  const rect = input.getBoundingClientRect();
  if (rect.width < 4 && rect.height < 4) return true;
  const style = window.getComputedStyle(input);
  if (parseFloat(style.opacity) === 0) return true;
  return false;
}

/** Element to receive a single physical click (label when input is decorated). */
export function resolvePointerTarget(element: Element): HTMLElement {
  if (element instanceof HTMLInputElement && isPointerDecoratedChoiceInput(element)) {
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label instanceof HTMLElement) return label;
    }
    const wrapping = element.closest('label');
    if (wrapping instanceof HTMLElement) return wrapping;
  }
  if (element instanceof HTMLLabelElement && element.htmlFor) {
    const linked = document.getElementById(element.htmlFor);
    if (linked instanceof HTMLElement) return linked;
  }
  return element as HTMLElement;
}

/** Element to focus for keyboard input (always the control, not its label). */
export function resolveInputTarget(element: Element): HTMLElement {
  if (element instanceof HTMLLabelElement && element.htmlFor) {
    const linked = document.getElementById(element.htmlFor);
    if (linked instanceof HTMLElement) return linked;
  }
  return element as HTMLElement;
}

export function isEffectivelyVisible(el: Element, alwaysInclude?: boolean): boolean {
  if (alwaysInclude) return true;
  if (el instanceof HTMLInputElement) {
    if (el.type === 'hidden') return false;
    if (el.type === 'file') return !isStructurallyHidden(el);
    if (isAssociatedChoiceInput(el)) return !isStructurallyHidden(el);
    if (isChoiceInput(el)) {
      if (isStructurallyHidden(el)) return false;
      if (isAssociatedChoiceInput(el) || el.closest('label')) return true;
      // No <label for>/wrapping <label> (e.g. MUI ListItem: the opacity-0 input
      // overlays a styled box and its caption lives in a sibling element). It's
      // still a real control if it occupies space AND is keyboard-reachable.
      // A tabindex="-1" choice input is typically a hidden state proxy sitting
      // behind custom buttons (Yes/No) — exclude it so the buttons win.
      if (el.getAttribute('tabindex') === '-1') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
  }
  if (isHiddenByStyle(el)) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/** Remove dropdown/listbox content from a clone before reading group copy. */
export function stripEphemeralNodes(clone: Element): void {
  for (const node of clone.querySelectorAll(
    '[role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [aria-live="polite"], [aria-live="assertive"], template, script, style',
  )) {
    node.remove();
  }
}

export function elementTextForGroupContent(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  stripEphemeralNodes(clone);
  return elementText(clone);
}

function normalizeContextWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function subtractChildTextFromParent(parentText: string, childTexts: string[]): string {
  let content = parentText;
  for (const childText of [...childTexts].sort((a, b) => b.length - a.length)) {
    if (!childText) continue;
    content = content.split(childText).join(' ');
  }
  return normalizeContextWhitespace(
    content
      .replace(/\d+ of \d+\.\d+ results available\.?/gi, '')
      .replace(/Use Up and Down to choose options[^.]*\.?/gi, '')
      .replace(/press Enter to select[^.]*\.?/gi, '')
      .replace(/press Escape to[^.]*\.?/gi, ''),
  );
}

const GENERIC_CONTEXT_LABELS = new Set([
  'your answer',
  'select...',
  'select',
  'choose...',
  'choose',
  'pick...',
  'pick',
  '',
]);

/** Walk up the DOM to find the nearest meaningful question / section copy for a control. */
export function getSectionContextText(el: Element, extraStrip: string[] = []): string {
  const strip = ['Your answer', ...extraStrip];
  let best = '';
  let current: Element | null = el.parentElement;

  while (current && current !== document.body) {
    const parentText = elementTextForGroupContent(current);
    if (parentText) {
      const content = subtractChildTextFromParent(parentText, strip);
      if (
        content &&
        !GENERIC_CONTEXT_LABELS.has(content.toLowerCase()) &&
        content.length > best.length
      ) {
        best = content;
        if (content.length >= 24 && content.length <= 320 && (content.includes('*') || content.includes('?'))) {
          return best.length > 280 ? `${best.slice(0, 280).trim()}…` : best;
        }
      }
    }
    current = current.parentElement;
  }

  return best.length > 280 ? `${best.slice(0, 280).trim()}…` : best;
}

export function findFieldRoot(el: Element): Element | null {
  const fieldset = el.closest('fieldset');
  if (fieldset) return fieldset;

  const group = el.closest('[role="group"]');
  if (group) return group;

  let current: Element | null = el.parentElement;
  while (current && current !== document.body) {
    if (getFieldTitle(current)) return current;
    current = current.parentElement;
  }

  return null;
}

export function getDirectFieldTitle(container: Element): string {
  const legend = container.querySelector(':scope > legend, legend');
  if (legend?.textContent?.trim()) {
    return legend.textContent.trim().replace(/\*+/g, '').trim();
  }

  const labelledBy = resolveLabelledByText(container.getAttribute('aria-labelledby'));
  if (labelledBy) return labelledBy.replace(/\*+/g, '').trim();

  for (const label of container.querySelectorAll(':scope > label')) {
    const text = label.textContent?.trim().replace(/\*+/g, '').trim();
    if (!text || isGenericPlaceholder(text)) continue;
    const wrappedControls = label.querySelectorAll('input, textarea, select, button');
    if (wrappedControls.length === 1 && label.contains(wrappedControls[0]!)) continue;
    return text;
  }

  return '';
}

export function getFieldTitle(container: Element): string {
  const direct = getDirectFieldTitle(container);
  if (direct) return direct;

  for (const control of container.querySelectorAll('input, textarea, select, button')) {
    const id = control.id;
    if (!id) continue;
    const label = container.querySelector(`label[for="${cssEscape(id)}"]`);
    const text = label?.textContent?.trim().replace(/\*+/g, '').trim();
    if (text && !isGenericPlaceholder(text)) return text;
  }

  const label = container.querySelector(
    ':scope > label, label[for], [role="group"] > label',
  );
  const labelText = label?.textContent?.trim().replace(/\*+/g, '').trim();
  if (labelText && !isGenericPlaceholder(labelText)) return labelText;

  return '';
}

export function getAccessibleName(el: Element): string {
  if (el instanceof HTMLInputElement && isChoiceInput(el)) {
    const option = getChoiceOptionLabel(el);
    if (option) return option;
  }

  const labelledBy = resolveLabelledByText(el.getAttribute('aria-labelledby'));
  if (labelledBy) return labelledBy;

  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel && !isGenericPlaceholder(ariaLabel)) return ariaLabel;

  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
    const labelText = label?.textContent?.trim().replace(/\*+/g, '').trim();
    if (labelText) return labelText;
  }

  // A control wrapped in a <label> takes its accessible name from that label
  // (HTML label association). Without this, fields with only a wrapping label
  // fall through to the field-root title and inherit a neighbouring section's
  // heading instead of their own question.
  const wrappingLabel = el.closest('label');
  if (wrappingLabel) {
    const labelText = wrappingLabel.textContent?.trim().replace(/\*+/g, '').trim();
    if (labelText && !isGenericPlaceholder(labelText)) return labelText;
  }

  const fieldRoot = findFieldRoot(el);
  if (fieldRoot) {
    const fieldTitle = getFieldTitle(fieldRoot);
    if (fieldTitle) return fieldTitle;
  }

  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder && !isGenericPlaceholder(placeholder)) return placeholder;

  return '';
}

export function isFieldContainer(el: Element): boolean {
  if (el.tagName === 'FIELDSET') return true;
  if (el.getAttribute('role') === 'group') {
    if (el.hasAttribute('aria-labelledby') || el.querySelector(':scope > legend, legend')) return true;
  }
  if (getDirectFieldTitle(el)) return true;
  if (getGroupLabelFromElement(el)) return true;
  return false;
}

export function getGroupLabelFromElement(group: Element): string | null {
  const labelledBy = group.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = resolveLabelledByText(labelledBy);
    if (text) return text;
  }
  const legend = group.querySelector('legend');
  if (legend?.textContent?.trim()) return legend.textContent.trim();
  const title = getDirectFieldTitle(group);
  return title || null;
}

export function findComboboxWidgetRoot(input: Element): Element {
  let current: Element | null = input.parentElement;
  while (current && current !== document.body) {
    if (current.tagName === 'FIELDSET' || current.getAttribute('role') === 'group') return current;
    if (getFieldTitle(current)) return current;
    current = current.parentElement;
  }
  return input.parentElement ?? input;
}

export function isComboboxInput(el: Element): el is HTMLInputElement {
  if (el.getAttribute('role') === 'combobox') return true;
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    if (input.getAttribute('aria-haspopup') === 'listbox') return true;
    if (input.getAttribute('aria-haspopup') === 'true' && input.getAttribute('aria-autocomplete') === 'list') {
      return true;
    }
    if (input.getAttribute('aria-autocomplete') === 'list') return true;
  }
  return false;
}

export function getComboboxInput(el: Element): HTMLInputElement | null {
  if (el instanceof HTMLInputElement && isComboboxInput(el)) return el;
  if (el.getAttribute('role') === 'combobox' && el.tagName !== 'INPUT') {
    return el.querySelector('input[role="combobox"], input[aria-autocomplete="list"]');
  }
  return null;
}

export function isDocumentRoot(el: Element): boolean {
  return el === document.body || el === document.documentElement;
}

export function findFileWidgetRoot(fileInput: Element): Element {
  const candidates: Element[] = [];
  let current: Element | null = fileInput.parentElement;

  while (current && !isDocumentRoot(current)) {
    const filesInCurrent = current.querySelectorAll('input[type="file"]');
    if (filesInCurrent.length === 1 && filesInCurrent[0] === fileInput) {
      candidates.push(current);
    }
    current = current.parentElement;
  }

  const groupLabeled = candidates.find(
    (el) => el.getAttribute('role') === 'group' && el.hasAttribute('aria-labelledby'),
  );
  if (groupLabeled) return groupLabeled;

  const titled = candidates.filter(
    (el) => getDirectFieldTitle(el) || getGroupLabelFromElement(el),
  );
  if (titled.length > 0) {
    return titled.sort((a, b) => visibleText(a).length - visibleText(b).length)[0]!;
  }

  if (candidates.length > 0) {
    return candidates.sort((a, b) => visibleText(a).length - visibleText(b).length)[0]!;
  }

  const label = fileInput.closest('label');
  if (label) return label;
  const parent = fileInput.parentElement;
  if (parent && !isDocumentRoot(parent)) return parent;
  return fileInput;
}

export function fileWidgetLabel(fileInput: HTMLInputElement, widgetRoot?: Element): string | null {
  const root = widgetRoot ?? findFileWidgetRoot(fileInput);
  const fromGroup = getGroupLabelFromElement(root);
  if (fromGroup) return fromGroup;

  const title = getFieldTitle(root);
  if (title) return title;

  const ariaLabel = fileInput.getAttribute('aria-label')?.trim();
  if (ariaLabel && ariaLabel !== 'undefined') return ariaLabel.replace(/\*+/g, '').trim();

  if (fileInput.id) {
    const label = document.querySelector(`label[for="${cssEscape(fileInput.id)}"]`);
    const text = label?.textContent?.trim().replace(/\*+/g, '').trim();
    if (text) return text;
  }

  const rootText = visibleText(root);
  const head = rootText.split(/\b(Click here|Click or drag|Upload file|Drag file)\b/i)[0]?.trim();
  if (head && head.length >= 3 && head.length <= 80) return head.replace(/\*+/g, '').trim();
  const lines = rootText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const titledLine = lines.find((line) => line.length <= 80 && line.includes('*'));
  if (titledLine) return titledLine.replace(/\*+/g, '').trim();
  const firstLine = lines.find(Boolean);
  if (firstLine && firstLine.length <= 120) return firstLine.replace(/\*+/g, '').trim();

  return getAccessibleName(fileInput) || null;
}

export function isFileUploadTriggerButton(btn: Element): boolean {
  // Language-based affordance for "pick a local file" (per Guide.md this is an
  // allowed text signal). "enter manually"/"paste" describe the alternative
  // (type instead of upload), so they disqualify — no vendor/service names.
  const text = visibleText(btn).toLowerCase();
  const aria = (btn.getAttribute('aria-label') ?? '').toLowerCase();

  if (text.includes('enter manually') || text.includes('paste') || text.includes('manual')) {
    return false;
  }

  if (aria.includes('upload') || aria.includes('attach') || aria.includes('browse')) return true;

  return (
    text === 'attach' ||
    text.includes('upload') ||
    text === 'choose file' ||
    text === 'browse'
  );
}

export function resolveActionableScope(root: Element): Element {
  const forms = Array.from(root.querySelectorAll('form')).filter(
    (form) => form.querySelector('input, textarea, select, [contenteditable="true"][role="textbox"]'),
  );

  if (forms.length === 0) {
    const main = root.querySelector('main');
    return main instanceof Element ? main : root;
  }

  if (forms.length === 1) return forms[0]!;

  let ancestor: Element | null = forms[0]!;
  while (ancestor && ancestor !== root && ancestor !== document.body) {
    if (forms.every((form) => ancestor!.contains(form))) break;
    ancestor = ancestor.parentElement;
  }

  if (ancestor && ancestor !== root && ancestor !== document.body) {
    return ancestor;
  }

  const main = root.querySelector('main');
  return main instanceof Element ? main : root;
}

export function isScopeRoot(parent: Element, scope: Element): boolean {
  if (parent === scope) return true;
  if (parent.tagName === 'BODY' || parent.tagName === 'HTML') return true;
  if (parent.tagName === 'FORM') return true;
  return false;
}

/** Seeds that live inside an open listbox/menu are not actionable form fields. */
export function isListboxInternalNoise(el: Element): boolean {
  if (el.getAttribute('role') === 'option') return true;
  const listbox = el.closest('[role="listbox"], [role="menu"]');
  if (!listbox) return false;
  if (el.getAttribute('role') === 'combobox') return false;
  if (el instanceof HTMLInputElement && isComboboxInput(el)) return false;
  return true;
}

export interface CompoundPhoneField {
  widgetRoot: Element;
  telInput: HTMLInputElement | null;
  countryCombobox: HTMLInputElement | null;
  countryToggle: HTMLElement | null;
  suppressedSeeds: Set<Element>;
}

function findCountryToggle(container: Element): HTMLElement | null {
  // The country/dial-code selector in a phone field is a button that opens a
  // popup — detect it by ARIA role semantics, not vendor/impl label keywords.
  for (const btn of container.querySelectorAll('button')) {
    const haspopup = btn.getAttribute('aria-haspopup');
    if (btn.hasAttribute('aria-expanded') || (haspopup !== null && haspopup !== 'false')) {
      return btn as HTMLElement;
    }
  }
  return null;
}

export function discoverCompoundPhoneFields(root: Element): CompoundPhoneField[] {
  const widgets: CompoundPhoneField[] = [];
  const seen = new Set<Element>();

  const containers = root.querySelectorAll('fieldset, [role="group"]');
  for (const container of containers) {
    const tel = container.querySelector('input[type="tel"]') as HTMLInputElement | null;
    const comboboxes = [
      ...container.querySelectorAll('input[role="combobox"], input[aria-autocomplete="list"]'),
    ].filter(
      (el): el is HTMLInputElement =>
        el instanceof HTMLInputElement && el !== tel && el.type !== 'tel',
    );

    if (!tel && comboboxes.length === 0) continue;
    if (seen.has(container)) continue;
    seen.add(container);

    const countryCombobox = comboboxes[0] ?? null;
    const suppressedSeeds = new Set<Element>();

    for (const btn of container.querySelectorAll('button')) {
      if (btn === findCountryToggle(container)) suppressedSeeds.add(btn);
      if (btn.getAttribute('aria-label')?.match(/toggle|flyout|select country/i)) {
        suppressedSeeds.add(btn);
      }
    }

    for (const input of container.querySelectorAll('input')) {
      if (input === tel || input === countryCombobox) continue;
      if (input instanceof HTMLInputElement && input.type === 'search') suppressedSeeds.add(input);
      if (
        input instanceof HTMLInputElement &&
        isComboboxInput(input) &&
        input !== countryCombobox &&
        tel
      ) {
        suppressedSeeds.add(input);
      }
    }

    widgets.push({
      widgetRoot: container,
      telInput: tel,
      countryCombobox,
      countryToggle: findCountryToggle(container),
      suppressedSeeds,
    });
  }

  for (const tel of root.querySelectorAll('input[type="tel"]')) {
    if (!(tel instanceof HTMLInputElement)) continue;
    if ([...seen].some((w) => w.contains(tel))) continue;
    const widgetRoot = findFieldRoot(tel) ?? tel.parentElement;
    if (!widgetRoot || seen.has(widgetRoot)) continue;
    seen.add(widgetRoot);
    widgets.push({
      widgetRoot,
      telInput: tel,
      countryCombobox: null,
      countryToggle: null,
      suppressedSeeds: new Set(),
    });
  }

  return widgets;
}

export function listboxBelongsToInput(input: HTMLInputElement, listbox: Element): boolean {
  const controls = input.getAttribute('aria-controls');
  if (controls && listbox.id === controls) return true;

  const widget = findComboboxWidgetRoot(input);
  if (!widget.contains(listbox)) return false;

  const telInWidget = widget.querySelector('input[type="tel"]');
  if (telInWidget && telInWidget !== input && !controls) {
    const listboxInTelSubtree = telInWidget.closest('[role="group"], fieldset')?.contains(listbox);
    if (listboxInTelSubtree && !widget.querySelector(`input[aria-controls="${listbox.id}"]`)) {
      return false;
    }
  }

  return true;
}

export function isVisibleListbox(listbox: Element): boolean {
  if (listbox.getAttribute('aria-hidden') === 'true') return false;
  if (isHiddenByStyle(listbox)) return false;
  const rect = listbox.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function optionsFromListbox(listbox: Element): ActionableTarget['options'] {
  return Array.from(listbox.querySelectorAll('[role="option"]')).map((opt) => {
    const label = (opt.textContent ?? '').trim();
    return { value: label, label };
  });
}

export function findListboxForInput(input: HTMLInputElement): Element | null {
  const controlsId = input.getAttribute('aria-controls');
  if (controlsId) {
    const listbox = document.getElementById(controlsId);
    if (listbox && listboxBelongsToInput(input, listbox)) return listbox;
  }

  const widget = findComboboxWidgetRoot(input);
  const inWidget = widget.querySelector('[role="listbox"]');
  if (inWidget && listboxBelongsToInput(input, inWidget)) return inWidget;

  for (const listbox of document.querySelectorAll('[role="listbox"]')) {
    if (!isVisibleListbox(listbox)) continue;
    if (listboxBelongsToInput(input, listbox)) return listbox;
  }

  return null;
}

export function findComboboxToggle(input: HTMLInputElement): HTMLElement | null {
  const widget = findComboboxWidgetRoot(input);
  for (const btn of widget.querySelectorAll('button')) {
    const label = (btn.getAttribute('aria-label') ?? '').toLowerCase();
    if (label.includes('toggle') || label.includes('open') || label.includes('flyout')) {
      return btn as HTMLElement;
    }
  }
  const popupId = input.getAttribute('aria-controls');
  if (popupId) {
    const popup = document.getElementById(popupId);
    const toggle = popup?.previousElementSibling;
    if (toggle instanceof HTMLElement && toggle.tagName === 'BUTTON') return toggle;
  }
  return null;
}

export function isAsyncAutocompleteInput(input: HTMLInputElement): boolean {
  return input.getAttribute('aria-autocomplete') === 'list';
}

export function seedPriority(seed: Element): number {
  if (seed instanceof HTMLInputElement && seed.type === 'file') return 100;
  if (seed.tagName === 'INPUT' || seed.tagName === 'TEXTAREA' || seed.tagName === 'SELECT') return 80;
  if (seed.tagName === 'BUTTON') return 20;
  return 50;
}
