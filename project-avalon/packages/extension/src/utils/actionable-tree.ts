import {
  findElementByTarget,
  findElementsByTarget,
  type ActionableGroup,
  type ActionableTarget,
  type ControlType,
  type FetchActionableTreeOptions,
  type OptionsSource,
  type PropertyFilter,
  type TargetSelector,
} from '@avalon/shared';
import {
  discoverCompoundPhoneFields,
  elementText,
  elementTextForGroupContent,
  fileWidgetLabel,
  findComboboxToggle,
  findComboboxWidgetRoot,
  findFieldRoot,
  findFileWidgetRoot,
  getAccessibleName,
  getChoiceOptionLabel,
  getFieldTitle,
  getComboboxInput,
  getGroupLabelFromElement,
  getSectionContextText,
  isComboboxInput,
  isDocumentRoot,
  isEffectivelyVisible,
  isFieldContainer,
  isFileUploadTriggerButton,
  isListboxInternalNoise,
  isScopeRoot,
  resolveActionableScope,
  seedPriority,
  stripEphemeralNodes,
  visibleText,
  type CompoundPhoneField,
} from './dom-analytics.js';
import {
  collectFocusProbeCandidates,
  probeDropdownsByFocus,
  staticComboboxOptions,
  type ProbedDropdownResult,
} from './dropdown-probe.js';

const SEED_SELECTOR =
  'a, button, input, textarea, select, [role="combobox"]:not([role="combobox"] [role="combobox"]), [contenteditable="true"][role="textbox"]';

const MAX_GROUP_CONTENT_LENGTH = 280;

interface FileUploadWidget {
  fileInput: HTMLInputElement;
  widgetRoot: Element;
  groupLabel: string | null;
  suppressedSeeds: Set<Element>;
}

interface WidgetOverrides {
  childUnitBySeed: Map<Element, Element>;
  targetLabelBySeed: Map<Element, string>;
  parentBySeed: Map<Element, Element>;
  suppressedSeeds: Set<Element>;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isGenericPlaceholder(text: string): boolean {
  return ['select...', 'select', 'choose...', 'choose', 'pick...', 'pick', ''].includes(
    text.trim().toLowerCase(),
  );
}

function discoverFileUploadWidgets(root: Element): FileUploadWidget[] {
  const widgets: FileUploadWidget[] = [];

  for (const fileInput of root.querySelectorAll('input[type="file"]')) {
    const input = fileInput as HTMLInputElement;
    const widgetRoot = findFileWidgetRoot(input);
    const groupLabel = fileWidgetLabel(input, widgetRoot);
    const suppressedSeeds = new Set<Element>();

    for (const btn of widgetRoot.querySelectorAll('button')) {
      if (isFileUploadTriggerButton(btn)) {
        suppressedSeeds.add(btn);
      }
    }

    widgets.push({ fileInput: input, widgetRoot, groupLabel, suppressedSeeds });
  }

  return widgets;
}

function buttonSharesFileInputField(btn: Element): boolean {
  let current: Element | null = btn.parentElement;
  while (current && current !== document.body) {
    const fileInput = current.querySelector('input[type="file"]');
    if (fileInput && isFileUploadTriggerButton(btn)) return true;
    if (isFieldContainer(current)) break;
    current = current.parentElement;
  }
  return false;
}

function buildPhoneOverrides(phoneFields: CompoundPhoneField[]): Pick<
  WidgetOverrides,
  'childUnitBySeed' | 'targetLabelBySeed' | 'parentBySeed' | 'suppressedSeeds'
> {
  const childUnitBySeed = new Map<Element, Element>();
  const targetLabelBySeed = new Map<Element, string>();
  const parentBySeed = new Map<Element, Element>();
  const suppressedSeeds = new Set<Element>();

  for (const widget of phoneFields) {
    const countrySeed = widget.countryCombobox ?? widget.countryToggle;
    if (countrySeed) {
      const countryUnit = widget.countryCombobox
        ? findComboboxWidgetRoot(widget.countryCombobox)
        : widget.widgetRoot;
      childUnitBySeed.set(countrySeed, countryUnit);
      parentBySeed.set(countrySeed, widget.widgetRoot);
      const countryLabel =
        (widget.countryCombobox && getAccessibleName(widget.countryCombobox)) ||
        getFieldTitle(widget.widgetRoot);
      if (countryLabel) targetLabelBySeed.set(countrySeed, countryLabel);
    }

    if (widget.telInput) {
      childUnitBySeed.set(widget.telInput, widget.telInput);
      parentBySeed.set(widget.telInput, widget.widgetRoot);
      const phoneLabel = getAccessibleName(widget.telInput);
      if (phoneLabel) targetLabelBySeed.set(widget.telInput, phoneLabel);
    }

    if (widget.countryToggle && widget.countryCombobox) {
      childUnitBySeed.set(widget.countryToggle, findComboboxWidgetRoot(widget.countryCombobox));
      parentBySeed.set(widget.countryToggle, widget.widgetRoot);
    }

    for (const el of widget.suppressedSeeds) {
      suppressedSeeds.add(el);
    }
  }

  return { childUnitBySeed, targetLabelBySeed, parentBySeed, suppressedSeeds };
}

function buildComboboxOverrides(seeds: Element[]): Pick<
  WidgetOverrides,
  'parentBySeed' | 'targetLabelBySeed' | 'suppressedSeeds'
> {
  const parentBySeed = new Map<Element, Element>();
  const targetLabelBySeed = new Map<Element, string>();
  const suppressedSeeds = new Set<Element>();

  for (const seed of seeds) {
    const combobox = getComboboxInput(seed);
    if (!combobox || isListboxInternalNoise(combobox)) continue;

    const widgetRoot = findComboboxWidgetRoot(combobox);
    const fieldRoot = findFieldRoot(widgetRoot) ?? widgetRoot;
    if (fieldRoot) parentBySeed.set(combobox, fieldRoot);

    const label = getAccessibleName(combobox);
    if (label) targetLabelBySeed.set(combobox, label);

    const toggle = findComboboxToggle(combobox);
    if (toggle) suppressedSeeds.add(toggle);
  }

  return { parentBySeed, targetLabelBySeed, suppressedSeeds };
}

function isRenderedSeed(el: Element, fileInputs: Set<Element>): boolean {
  if (isListboxInternalNoise(el)) return false;
  return isEffectivelyVisible(el, fileInputs.has(el));
}

function isUnlabeledClickable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== 'a' && tag !== 'button') return false;
  const ownLabel =
    elementText(el) ||
    visibleText(el) ||
    el.getAttribute('aria-label')?.trim() ||
    el.getAttribute('title')?.trim() ||
    el.getAttribute('value')?.trim();
  return !ownLabel;
}

function isEditorChrome(el: Element): boolean {
  if (el.tagName !== 'BUTTON') return false;
  if (el.closest('[contenteditable="true"]')) return true;
  // Rich-text formatting toolbars (bold/italic/list/link) sit beside the editable
  // in the same field block, not inside it. Detect by the editor's semantics
  // (a contenteditable textbox in the same field), never by toolbar class names.
  const fieldRoot = findFieldRoot(el);
  return Boolean(fieldRoot?.querySelector('[contenteditable="true"][role="textbox"]'));
}

function seedHasOwnLabel(seed: Element): string {
  if (getComboboxInput(seed)) return '';
  const tag = seed.tagName.toLowerCase();
  if (tag === 'a' || tag === 'button') {
    return (
      elementText(seed) ||
      visibleText(seed) ||
      seed.getAttribute('aria-label')?.trim() ||
      seed.getAttribute('title')?.trim() ||
      ''
    );
  }
  if (tag === 'textarea' || tag === 'select') {
    const name = getAccessibleName(seed);
    if (name && !isGenericPlaceholder(name)) return name;
  }
  if (tag === 'input') {
    const type = (seed as HTMLInputElement).type;
    if (type !== 'checkbox' && type !== 'radio' && type !== 'hidden' && type !== 'file') {
      const name = getAccessibleName(seed);
      if (name && !isGenericPlaceholder(name)) return name;
    }
    if (type === 'checkbox' || type === 'radio') {
      const section = getSectionContextText(seed);
      if (section) return section;
      return elementText(seed);
    }
    if (type === 'hidden' || type === 'file') {
      return elementText(seed);
    }
  }
  if (seed.getAttribute('contenteditable') === 'true') {
    const section = getSectionContextText(seed);
    if (section) return section;
  }
  return elementText(seed) || visibleText(seed);
}

function resolveChildUnit(seed: Element, root: Element, overrides: WidgetOverrides): Element {
  const override = overrides.childUnitBySeed.get(seed);
  if (override) return override;

  const combobox = getComboboxInput(seed);
  if (combobox) return findComboboxWidgetRoot(combobox);

  if (seedHasOwnLabel(seed)) return seed;

  let current: Element | null = seed.parentElement;
  while (current && current !== root) {
    if (visibleText(current)) return current;
    current = current.parentElement;
  }
  return seed;
}

function isAlternateUploadAction(seed: Element): boolean {
  return seed.tagName === 'BUTTON' && !isFileUploadTriggerButton(seed);
}

function dedupeSmallestUnits(
  children: Element[],
  childToSeed: Map<Element, Element>,
  scope: Element,
): Element[] {
  const unique = [...new Set(children)];
  return unique.filter((child) => {
    const childSeed = childToSeed.get(child);
    if (!childSeed) return true;

    for (const other of unique) {
      if (other === child || !child.contains(other)) continue;
      const otherSeed = childToSeed.get(other);
      if (!otherSeed) continue;
      if (
        otherSeed instanceof HTMLInputElement &&
        otherSeed.type === 'file' &&
        isAlternateUploadAction(childSeed)
      ) {
        continue;
      }
      if (seedPriority(otherSeed) >= seedPriority(childSeed)) return false;
    }

    for (const other of unique) {
      if (other === child || !other.contains(child)) continue;
      const otherSeed = childToSeed.get(other);
      if (!otherSeed) continue;
      if (
        otherSeed instanceof HTMLInputElement &&
        otherSeed.type === 'file' &&
        isAlternateUploadAction(childSeed)
      ) {
        continue;
      }
      // Body-orphan Dropzone file inputs must not swallow unrelated form fields.
      if (
        other === scope &&
        otherSeed instanceof HTMLInputElement &&
        otherSeed.type === 'file' &&
        childSeed !== otherSeed &&
        !otherSeed.contains(childSeed)
      ) {
        continue;
      }
      if (seedPriority(otherSeed) > seedPriority(childSeed)) return false;
    }

    return true;
  });
}

function leftoverText(node: Element, childSet: Set<Element>): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let textNode: Text | null;

  while ((textNode = walker.nextNode() as Text | null)) {
    let parent = textNode.parentElement;
    let insideChild = false;
    while (parent && parent !== node) {
      if (childSet.has(parent)) {
        insideChild = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!insideChild) {
      const trimmed = (textNode.textContent ?? '').trim();
      if (trimmed) parts.push(trimmed);
    }
  }

  return normalizeWhitespace(parts.join(' '));
}

function subtractChildText(parentText: string, childTexts: string[]): string {
  let content = parentText;
  for (const childText of [...childTexts].sort((a, b) => b.length - a.length)) {
    if (!childText) continue;
    content = content.split(childText).join(' ');
  }
  return normalizeWhitespace(
    content
      .replace(/\d+ of \d+\.\d+ results available\.?/gi, '')
      .replace(/Use Up and Down to choose options[^.]*\.?/gi, '')
      .replace(/press Enter to select[^.]*\.?/gi, '')
      .replace(/press Escape to[^.]*\.?/gi, ''),
  );
}

function isViableLeftoverParent(el: Element, childSet: Set<Element>): boolean {
  if (el.tagName === 'FORM') return false;
  const text = leftoverText(el, childSet);
  return Boolean(text) && text.length <= MAX_GROUP_CONTENT_LENGTH;
}

function isControlChromeCopy(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return true;
  if (lower.includes('accepted file types')) return true;
  if (/^attach(\s|$)/i.test(lower)) return true;
  if (lower === 'upload file' || lower === 'browse' || lower === 'choose file') return true;
  return false;
}

function getGroupContent(parent: Element, childSet: Set<Element>, scope: Element): string {
  if (isScopeRoot(parent, scope)) return '';

  if (isFieldContainer(parent)) {
    const title = getFieldTitle(parent);
    const childrenInParent = [...childSet].filter((child) => parent.contains(child));
    const parentText = elementTextForGroupContent(parent) || visibleText(parent);
    const childTexts = childrenInParent
      .map((child) => elementText(child) || visibleText(child))
      .filter((text) => text && !isGenericPlaceholder(text));
    const subtracted = subtractChildText(parentText, childTexts);
    if (subtracted && subtracted !== title && !isControlChromeCopy(subtracted)) {
      return subtracted.length > MAX_GROUP_CONTENT_LENGTH
        ? `${subtracted.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}…`
        : subtracted;
    }
    if (title) return title;
  }

  if (parent.getAttribute('role') === 'group') {
    const ariaLabel = getGroupLabelFromElement(parent);
    if (ariaLabel) return ariaLabel;
  }

  const childrenInParent = [...childSet].filter((child) => parent.contains(child));
  const parentText = elementTextForGroupContent(parent) || visibleText(parent);
  const childTexts = childrenInParent
    .map((child) => elementText(child) || visibleText(child))
    .filter((text) => text && !isGenericPlaceholder(text));
  const subtracted = subtractChildText(parentText, childTexts);
  let content = subtracted || leftoverText(parent, childSet);

  if (!content) {
    const title = getFieldTitle(parent);
    if (title) content = title;
  }

  if (content.length > MAX_GROUP_CONTENT_LENGTH) {
    const title = getFieldTitle(parent);
    if (title && title.length <= MAX_GROUP_CONTENT_LENGTH) return title;
    return `${content.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}…`;
  }

  return content;
}

/**
 * Section headings and instructions often live in the DOM *between* two field
 * groups, so they belong to no group's own innerText (parent − children) and are
 * silently lost. Example:
 *
 *   <group>…</group>
 *   <p>Show us 1–3 things you've built…</p>   ← orphan, owned by no group
 *   <group2><textarea/></group2>
 *
 * We attach each orphan text block to the NEXT group in document order so its
 * context reaches the AI. Purely structural — no vendor or label matching.
 */
function collectSectionTextByGroup(scope: Element, groupParents: Element[]): Map<Element, string> {
  const result = new Map<Element, string>();
  if (groupParents.length === 0) return result;

  const groupSet = new Set(groupParents);
  const ordered = [...groupParents].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const current = node;
    node = walker.nextNode() as Text | null;

    const text = (current.textContent ?? '').trim();
    const host = current.parentElement;
    if (!text || !host) continue;
    if (host.tagName === 'SCRIPT' || host.tagName === 'STYLE') continue;

    // Skip text already owned by a group, or transient dropdown/listbox noise.
    let owned = false;
    for (let p: Element | null = host; p && p !== scope; p = p.parentElement) {
      if (groupSet.has(p) || isListboxInternalNoise(p)) {
        owned = true;
        break;
      }
    }
    if (owned) continue;

    const target = ordered.find(
      (gp) => current.compareDocumentPosition(gp) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (!target) continue;

    const prev = result.get(target);
    result.set(target, prev ? `${prev} ${text}` : text);
  }

  return result;
}

function clamp(text: string): string {
  return text.length > MAX_GROUP_CONTENT_LENGTH
    ? `${text.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}…`
    : text;
}

/** Prepend the lost between-group section text to a group's own content. */
function mergeSectionContext(lead: string | undefined, base: string): string {
  const leadText = normalizeWhitespace(lead ?? '');
  if (!leadText) return base;
  if (!base) return clamp(leadText);
  if (base.includes(leadText)) return clamp(base);
  if (leadText.includes(base)) return clamp(leadText);
  return clamp(`${leadText} ${base}`);
}

function getFieldContextText(
  parent: Element,
  childUnit: Element,
  scope: Element,
  seed: Element,
  siblingChildUnits: Element[],
): string {
  if (isScopeRoot(parent, scope)) {
    return (
      getAccessibleName(seed) ||
      getSectionContextText(seed) ||
      (elementText(childUnit) || visibleText(childUnit)).replace(/\*+/g, '').trim()
    );
  }

  const parentText = elementTextForGroupContent(parent) || visibleText(parent);
  const siblingTexts = siblingChildUnits
    .filter((child) => parent.contains(child))
    .map((child) => elementTextForGroupContent(child) || visibleText(child))
    .filter((text) => text && !isGenericPlaceholder(text));
  let content = subtractChildText(parentText, siblingTexts);

  if (!content || isControlChromeCopy(content)) {
    const title = getFieldTitle(parent);
    if (title) content = title;
  }

  const accessible = getAccessibleName(seed);
  if (
    !content ||
    isControlChromeCopy(content) ||
    content.toLowerCase() === 'your answer' ||
    (accessible && content === accessible && siblingTexts.length > 1)
  ) {
    const section = getSectionContextText(seed);
    if (section) content = section;
  }

  if (!content && accessible) content = accessible;

  if (!content) content = leftoverText(parent, new Set(siblingChildUnits));

  if (content.length > MAX_GROUP_CONTENT_LENGTH) {
    return `${content.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}…`;
  }
  return content;
}

function findParent(
  child: Element,
  childSet: Set<Element>,
  root: Element,
  overrides: WidgetOverrides,
  seed: Element,
): Element {
  const combobox = getComboboxInput(seed);
  const overrideParent = overrides.parentBySeed.get(combobox ?? seed);
  if (overrideParent) return overrideParent;

  let current: Element | null = child.parentElement;
  let leftoverParent: Element | null = null;
  while (current && current !== root) {
    if (isFieldContainer(current)) return current;
    if (!leftoverParent && isViableLeftoverParent(current, childSet)) {
      leftoverParent = current;
    }
    current = current.parentElement;
  }

  const fieldContainer = findFieldRoot(child);
  if (fieldContainer && fieldContainer !== root) return fieldContainer;

  if (leftoverParent && leftoverParent !== root) return leftoverParent;

  const parent = child.parentElement;
  if (parent && parent !== root) return parent;

  return child;
}

function stripChildrenHtml(parent: Element, childSet: Set<Element>): string {
  const clone = parent.cloneNode(true) as Element;
  stripEphemeralNodes(clone);
  for (const child of childSet) {
    if (!parent.contains(child)) continue;
    for (const el of [...clone.querySelectorAll('*')]) {
      if (el.outerHTML === child.outerHTML || visibleText(el) === visibleText(child)) {
        el.remove();
      }
    }
  }
  return clone.innerHTML.trim();
}

function deriveControlType(
  seed: Element,
  countryComboboxSeeds: Set<Element>,
  probedOptions: Map<Element, ProbedDropdownResult>,
): ControlType {
  if (
    seed.getAttribute('contenteditable') === 'true' &&
    seed.getAttribute('role') === 'textbox'
  ) {
    return 'textarea';
  }
  if (countryComboboxSeeds.has(seed)) return 'combobox';
  if (probedOptions.has(seed)) return 'combobox';
  const combobox = getComboboxInput(seed);
  if (combobox) return 'combobox';
  const tag = seed.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'input') {
    const type = (seed as HTMLInputElement).type || 'text';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'file') return 'file';
    return 'text';
  }
  return 'button';
}

function deriveTargetLabel(
  childUnit: Element,
  seed: Element,
  overrides: WidgetOverrides,
): string {
  const combobox = getComboboxInput(seed);
  const override = overrides.targetLabelBySeed.get(combobox ?? seed);
  if (override) return override;

  if (combobox || seed.tagName === 'SELECT') {
    const name = getAccessibleName(combobox ?? seed);
    if (name) return name;
  }

  if (seed.tagName === 'SELECT') {
    const select = seed as HTMLSelectElement;
    return select.name || elementText(childUnit) || 'select';
  }

  if (seed.getAttribute('contenteditable') === 'true') {
    const section = getSectionContextText(seed);
    if (section) return section.length > 100 ? `${section.slice(0, 100).trim()}…` : section;
  }

  if (seed.tagName === 'INPUT') {
    const input = seed as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') {
      const option = getChoiceOptionLabel(input);
      if (option) return option;
      const section = getSectionContextText(seed);
      if (section) return section.length > 120 ? `${section.slice(0, 120).trim()}…` : section;
    }
    if (input.type === 'file') {
      const label = fileWidgetLabel(input);
      if (label) return label;
    }
  }

  const text = elementText(childUnit) || visibleText(childUnit);
  if (!isGenericPlaceholder(text)) return text;
  return getAccessibleName(seed) || text;
}

function nativeSelectOptions(seed: Element): ActionableTarget['options'] | undefined {
  if (seed.tagName !== 'SELECT') return undefined;
  return Array.from((seed as HTMLSelectElement).options).map((o) => ({
    value: o.value,
    label: o.text.trim(),
  }));
}

function buildPropertyCandidates(seed: Element): PropertyFilter[][] {
  const lists: PropertyFilter[][] = [];
  const tag = seed.tagName.toLowerCase();

  const id = seed.id;
  if (id) lists.push([{ attribute: 'id', pattern: id }]);

  const name = seed.getAttribute('name');
  const type = seed.tagName === 'INPUT' ? (seed as HTMLInputElement).type : null;
  const role = seed.getAttribute('role');
  const base: PropertyFilter[] = [];
  if (name) base.push({ attribute: 'name', pattern: name });
  if (type) base.push({ attribute: 'type', pattern: type });
  if (role) base.push({ attribute: 'role', pattern: role });

  const labelText = (elementText(seed) || visibleText(seed)).replace(/\*+/g, '').trim();
  if (labelText && labelText.length <= 100 && (tag === 'button' || tag === 'a')) {
    lists.push([{ attribute: 'text', pattern: labelText }]);
    if (base.length) lists.push([{ attribute: 'text', pattern: labelText }, ...base]);
  }

  for (const attr of Array.from(seed.attributes)) {
    if (attr.name.startsWith('data-')) {
      lists.push([...base, { attribute: attr.name, pattern: attr.value }]);
    }
  }

  const className = (seed as HTMLElement).className?.trim();
  if (className) {
    const tokens = className.split(/\s+/).filter(Boolean);
    if (tokens[0]) lists.push([...base, { attribute: 'class', pattern: `?${tokens[0]}?` }]);
    lists.push([...base, { attribute: 'class', pattern: className }]);
  }

  if (base.length) lists.push([...base]);
  lists.push([]);

  return lists;
}

export function buildControlSelector(root: ParentNode, seed: Element): TargetSelector {
  const tag = seed.tagName.toLowerCase();

  for (const properties of buildPropertyCandidates(seed)) {
    const matches = findElementsByTarget(root, { tag, properties });
    const idx = matches.indexOf(seed);
    if (idx < 0) continue;

    const selector: TargetSelector = {
      tag,
      properties,
      ...(matches.length > 1 ? { index: idx } : {}),
    };
    if (findElementByTarget(root, selector) === seed) return selector;

    const withIndex: TargetSelector = { tag, properties, index: idx };
    if (findElementByTarget(root, withIndex) === seed) return withIndex;
  }

  const all = findElementsByTarget(root, { tag, properties: [] });
  const idx = all.indexOf(seed);
  return { tag, properties: [], index: idx >= 0 ? idx : 0 };
}

function buildWidgetOverrides(
  fileWidgets: FileUploadWidget[],
  phoneFields: CompoundPhoneField[],
  seeds: Element[],
): WidgetOverrides {
  const childUnitBySeed = new Map<Element, Element>();
  const targetLabelBySeed = new Map<Element, string>();
  const parentBySeed = new Map<Element, Element>();
  const suppressedSeeds = new Set<Element>();

  for (const widget of fileWidgets) {
    const { fileInput, widgetRoot, groupLabel, suppressedSeeds: widgetSuppressed } = widget;
    const fieldRoot = findFieldRoot(fileInput);
    let childUnit =
      fieldRoot && widgetRoot.contains(fieldRoot) ? fieldRoot : widgetRoot;
    if (isDocumentRoot(childUnit)) childUnit = fileInput;
    let parent = widgetRoot;
    if (isDocumentRoot(parent)) parent = fileInput;
    childUnitBySeed.set(fileInput, childUnit);
    parentBySeed.set(fileInput, parent);
    if (groupLabel) targetLabelBySeed.set(fileInput, groupLabel);
    for (const el of widgetSuppressed) suppressedSeeds.add(el);
    if (!isDocumentRoot(widgetRoot)) {
      for (const btn of widgetRoot.querySelectorAll('button')) {
        if (widgetSuppressed.has(btn)) continue;
        parentBySeed.set(btn, widgetRoot);
      }
    }
  }

  const phoneOverrides = buildPhoneOverrides(phoneFields);
  for (const [k, v] of phoneOverrides.childUnitBySeed) childUnitBySeed.set(k, v);
  for (const [k, v] of phoneOverrides.targetLabelBySeed) targetLabelBySeed.set(k, v);
  for (const [k, v] of phoneOverrides.parentBySeed) parentBySeed.set(k, v);
  for (const el of phoneOverrides.suppressedSeeds) suppressedSeeds.add(el);

  const comboboxOverrides = buildComboboxOverrides(seeds);
  for (const [seed, parent] of comboboxOverrides.parentBySeed) parentBySeed.set(seed, parent);
  for (const [seed, label] of comboboxOverrides.targetLabelBySeed) targetLabelBySeed.set(seed, label);
  for (const el of comboboxOverrides.suppressedSeeds) suppressedSeeds.add(el);

  return { childUnitBySeed, targetLabelBySeed, parentBySeed, suppressedSeeds };
}

function collectSeeds(root: ParentNode, overrides: WidgetOverrides): Element[] {
  const fileInputs = new Set<Element>();
  for (const widget of discoverFileUploadWidgets(root as Element)) {
    fileInputs.add(widget.fileInput);
  }

  const raw = Array.from(root.querySelectorAll(SEED_SELECTOR)).filter((el) => {
    if (isEditorChrome(el)) return false;
    if (el.getAttribute('role') === 'combobox' && el.tagName !== 'INPUT') {
      const input = getComboboxInput(el);
      return input ? isRenderedSeed(input, fileInputs) : false;
    }
    if (isUnlabeledClickable(el)) return false;
    return isRenderedSeed(el, fileInputs);
  });

  const seeds: Element[] = [];
  const seenFileWidgets = new Set<HTMLInputElement>();
  const seenCombobox = new Set<HTMLInputElement>();

  for (const el of raw) {
    if (overrides.suppressedSeeds.has(el)) continue;

    const combobox = getComboboxInput(el);
    if (combobox) {
      if (seenCombobox.has(combobox)) continue;
      seenCombobox.add(combobox);
      seeds.push(combobox);
      continue;
    }

    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
      if (seenFileWidgets.has(el as HTMLInputElement)) continue;
      seenFileWidgets.add(el as HTMLInputElement);
      seeds.push(el);
      continue;
    }

    if (el.tagName === 'BUTTON' && buttonSharesFileInputField(el)) continue;

    seeds.push(el);
  }

  for (const input of fileInputs) {
    if (!seeds.includes(input)) seeds.push(input);
  }

  for (const widget of discoverCompoundPhoneFields(root as Element)) {
    if (widget.telInput && !seeds.includes(widget.telInput)) seeds.push(widget.telInput);
  }

  return seeds;
}

function buildChildToSeed(
  seeds: Element[],
  root: Element,
  overrides: WidgetOverrides,
): Map<Element, Element> {
  const map = new Map<Element, Element>();
  for (const seed of seeds) {
    const child = resolveChildUnit(seed, root, overrides);
    const existing = map.get(child);
    if (!existing) {
      map.set(child, seed);
      continue;
    }
    if (seedPriority(seed) > seedPriority(existing)) {
      map.set(child, seed);
    }
  }
  return map;
}

async function buildTargetEntry(
  pageRoot: Element,
  scope: Element,
  parent: Element,
  childUnit: Element,
  seed: Element,
  siblingChildUnits: Element[],
  overrides: WidgetOverrides,
  fetchOptions: FetchActionableTreeOptions,
  probedComboboxes: Map<Element, ProbedDropdownResult>,
  countryComboboxSeeds: Set<Element>,
): Promise<ActionableTarget> {
  const actionSeed = getComboboxInput(seed) ?? seed;
  const cached = probedComboboxes.get(actionSeed) ?? probedComboboxes.get(seed);
  const controlType = deriveControlType(actionSeed, countryComboboxSeeds, probedComboboxes);
  let options: ActionableTarget['options'] | undefined;
  let optionsSource: OptionsSource | undefined;

  if (actionSeed.tagName === 'SELECT') {
    options = nativeSelectOptions(actionSeed);
    optionsSource = options?.length ? 'native' : undefined;
  } else if (cached) {
    options = cached.options;
    optionsSource = cached.source;
  } else if (isComboboxInput(actionSeed) && fetchOptions.probeComboboxes === false) {
    const staticResult = staticComboboxOptions(actionSeed);
    if (staticResult) {
      options = staticResult.options;
      optionsSource = staticResult.source;
    }
  } else if (isComboboxInput(actionSeed)) {
    const staticResult = staticComboboxOptions(actionSeed);
    if (staticResult) {
      options = staticResult.options;
      optionsSource = staticResult.source;
    }
  }

  return {
    target: deriveTargetLabel(childUnit, actionSeed, overrides),
    targetHtml: childUnit.outerHTML,
    contextText: getFieldContextText(parent, childUnit, scope, actionSeed, siblingChildUnits),
    control: buildControlSelector(pageRoot, actionSeed),
    controlType,
    ...(options?.length ? { options, optionsSource } : {}),
  };
}

export async function fetchActionableTree(
  root: ParentNode = document.body,
  fetchOptions: FetchActionableTreeOptions = {},
): Promise<ActionableGroup[]> {
  const pageRoot =
    'body' in root && root.body instanceof Element ? root.body : (root as Element);
  const scope = resolveActionableScope(pageRoot);

  const fileWidgets = discoverFileUploadWidgets(scope);
  const phoneFields = discoverCompoundPhoneFields(scope);
  const countryComboboxSeeds = new Set(
    phoneFields.flatMap((w) => (w.countryCombobox ? [w.countryCombobox] : w.countryToggle ? [w.countryToggle] : [])),
  );

  const preliminarySeeds = collectSeeds(scope, {
    childUnitBySeed: new Map(),
    targetLabelBySeed: new Map(),
    parentBySeed: new Map(),
    suppressedSeeds: new Set([
      ...fileWidgets.flatMap((w) => [...w.suppressedSeeds]),
      ...phoneFields.flatMap((w) => [...w.suppressedSeeds]),
    ]),
  });

  const overrides = buildWidgetOverrides(fileWidgets, phoneFields, preliminarySeeds);
  const seeds = collectSeeds(scope, overrides);

  for (const widget of phoneFields) {
    const countrySeed = widget.countryCombobox ?? widget.countryToggle;
    if (countrySeed && !seeds.includes(countrySeed)) seeds.push(countrySeed);
  }

  const childToSeed = buildChildToSeed(seeds, scope, overrides);
  const childUnits = dedupeSmallestUnits([...childToSeed.keys()], childToSeed, scope);
  const childSet = new Set(childUnits);

  const parentToChildren = new Map<Element, Element[]>();
  const parentOrder: Element[] = [];

  for (const child of childUnits) {
    const seed = childToSeed.get(child) ?? child;
    const parent = findParent(child, childSet, scope, overrides, seed);
    if (!parentToChildren.has(parent)) {
      parentToChildren.set(parent, []);
      parentOrder.push(parent);
    }
    parentToChildren.get(parent)!.push(child);
  }

  const probedComboboxes = await probeDropdownsByFocus(
    collectFocusProbeCandidates(scope),
    phoneFields,
    fetchOptions,
  );

  const sectionTextByGroup = collectSectionTextByGroup(scope, parentOrder);

  const groups: ActionableGroup[] = [];
  for (const parent of parentOrder) {
    const children = parentToChildren.get(parent) ?? [];
    const childEntries: ActionableTarget[] = [];
    for (const childUnit of children) {
      const seed = childToSeed.get(childUnit) ?? childUnit;
      childEntries.push(
        await buildTargetEntry(
          pageRoot,
          scope,
          parent,
          childUnit,
          seed,
          children,
          overrides,
          fetchOptions,
          probedComboboxes,
          countryComboboxSeeds,
        ),
      );
    }
    groups.push({
      content: mergeSectionContext(sectionTextByGroup.get(parent), getGroupContent(parent, childSet, scope)),
      contentHtml: stripChildrenHtml(parent, childSet),
      children: childEntries,
    });
  }

  return groups;
}
