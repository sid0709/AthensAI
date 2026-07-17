"use strict";
var AvalonActionable = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/utils/actionable-tree.ts
  var actionable_tree_exports = {};
  __export(actionable_tree_exports, {
    buildControlSelector: () => buildControlSelector,
    fetchActionableTree: () => fetchActionableTree
  });

  // ../shared/dist/matcher.js
  var REGEX_SPECIAL = /[.*+^${}()|[\]\\]/g;
  function patternToRegex(pattern, flags = "i") {
    let regexSource = "";
    for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i];
      if (char === "?") {
        regexSource += ".*";
      } else {
        regexSource += char.replace(REGEX_SPECIAL, "\\$&");
      }
    }
    return new RegExp(`^${regexSource}$`, flags);
  }
  function matchesPattern(value, pattern) {
    return patternToRegex(pattern).test(value);
  }
  function readAttributeValue(element, attribute) {
    if (attribute === "class") {
      return element.className;
    }
    if (attribute === "text" || attribute === "innerText") {
      return (element.textContent ?? "").trim();
    }
    if (attribute === "tag") {
      return element.tagName.toLowerCase();
    }
    return element.getAttribute(attribute) ?? "";
  }
  function elementMatchesProperties(element, properties) {
    return properties.every(({ attribute, pattern }) => matchesPattern(readAttributeValue(element, attribute), pattern));
  }
  function findElementsByTarget(root, target) {
    const tag = target.tag.toLowerCase();
    const candidates = root.querySelectorAll(tag);
    return Array.from(candidates).filter((el) => elementMatchesProperties(el, target.properties));
  }
  function findElementByTarget(root, target) {
    const matches = findElementsByTarget(root, target);
    const index = target.index ?? 0;
    return matches[index] ?? null;
  }

  // src/utils/dom-analytics.ts
  function cssEscape(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  var GENERIC_PLACEHOLDERS = /* @__PURE__ */ new Set([
    "select...",
    "select",
    "choose...",
    "choose",
    "pick...",
    "pick",
    ""
  ]);
  function isGenericPlaceholder(text) {
    return GENERIC_PLACEHOLDERS.has(text.trim().toLowerCase());
  }
  function isOpaqueIdentifier(text) {
    const value = text.trim();
    if (!value) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return true;
    }
    if (value.length >= 24 && /^[0-9a-f_-]+$/i.test(value)) return true;
    return false;
  }
  function isHumanReadableChoiceToken(text) {
    const value = text.trim();
    if (!value || isGenericPlaceholder(value) || isOpaqueIdentifier(value)) return false;
    return /[a-z]/i.test(value);
  }
  function resolveLabelledByText(labelledBy) {
    if (!labelledBy) return "";
    return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
  }
  function elementText(el) {
    return (el.innerText ?? "").trim();
  }
  function visibleText(el) {
    return elementText(el) || (el.textContent ?? "").trim();
  }
  function isHiddenByStyle(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (parseFloat(style.opacity) === 0) return true;
    return false;
  }
  function isStructurallyHidden(el) {
    const style = window.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden";
  }
  function isChoiceInput(el) {
    return el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  }
  function getChoiceOptionLabel(input) {
    const id = input.id;
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      const text = label?.textContent?.trim().replace(/\*+/g, "").trim();
      if (text) return text;
    }
    const wrapping = input.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      for (const control of clone.querySelectorAll("input, button, select, textarea")) {
        control.remove();
      }
      const text = visibleText(clone).replace(/\*+/g, "").trim();
      if (text) return text;
    }
    const name = input.getAttribute("name")?.trim();
    if (name && isHumanReadableChoiceToken(name)) return name;
    const value = input.getAttribute("value")?.trim();
    if (value && isHumanReadableChoiceToken(value)) return value;
    return "";
  }
  function isAssociatedChoiceInput(input) {
    if (!isChoiceInput(input)) return false;
    if (input.getAttribute("aria-label")?.trim()) return true;
    if (input.getAttribute("aria-labelledby")?.trim()) return true;
    if (input.closest("label")) return true;
    if (input.id && document.querySelector(`label[for="${cssEscape(input.id)}"]`)) return true;
    const name = input.getAttribute("name")?.trim();
    if (name && isHumanReadableChoiceToken(name)) return true;
    const value = input.getAttribute("value")?.trim();
    if (value && isHumanReadableChoiceToken(value)) return true;
    return false;
  }
  function isEffectivelyVisible(el, alwaysInclude) {
    if (alwaysInclude) return true;
    if (el instanceof HTMLInputElement) {
      if (el.type === "hidden") return false;
      if (el.type === "file") return !isStructurallyHidden(el);
      if (isAssociatedChoiceInput(el)) return !isStructurallyHidden(el);
      if (isChoiceInput(el)) {
        if (isStructurallyHidden(el)) return false;
        if (isAssociatedChoiceInput(el) || el.closest("label")) return true;
        if (el.getAttribute("tabindex") === "-1") return false;
        const rect2 = el.getBoundingClientRect();
        return rect2.width > 0 && rect2.height > 0;
      }
    }
    if (isHiddenByStyle(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }
  function stripEphemeralNodes(clone) {
    for (const node of clone.querySelectorAll(
      '[role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [aria-live="polite"], [aria-live="assertive"], template, script, style'
    )) {
      node.remove();
    }
  }
  function elementTextForGroupContent(el) {
    const clone = el.cloneNode(true);
    stripEphemeralNodes(clone);
    return elementText(clone);
  }
  function normalizeContextWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function subtractChildTextFromParent(parentText, childTexts) {
    let content = parentText;
    for (const childText of [...childTexts].sort((a, b) => b.length - a.length)) {
      if (!childText) continue;
      content = content.split(childText).join(" ");
    }
    return normalizeContextWhitespace(
      content.replace(/\d+ of \d+\.\d+ results available\.?/gi, "").replace(/Use Up and Down to choose options[^.]*\.?/gi, "").replace(/press Enter to select[^.]*\.?/gi, "").replace(/press Escape to[^.]*\.?/gi, "")
    );
  }
  var GENERIC_CONTEXT_LABELS = /* @__PURE__ */ new Set([
    "your answer",
    "select...",
    "select",
    "choose...",
    "choose",
    "pick...",
    "pick",
    ""
  ]);
  function getSectionContextText(el, extraStrip = []) {
    const strip = ["Your answer", ...extraStrip];
    let best = "";
    let current = el.parentElement;
    while (current && current !== document.body) {
      const parentText = elementTextForGroupContent(current);
      if (parentText) {
        const content = subtractChildTextFromParent(parentText, strip);
        if (content && !GENERIC_CONTEXT_LABELS.has(content.toLowerCase()) && content.length > best.length) {
          best = content;
          if (content.length >= 24 && content.length <= 320 && (content.includes("*") || content.includes("?"))) {
            return best.length > 280 ? `${best.slice(0, 280).trim()}\u2026` : best;
          }
        }
      }
      current = current.parentElement;
    }
    return best.length > 280 ? `${best.slice(0, 280).trim()}\u2026` : best;
  }
  function findFieldRoot(el) {
    const fieldset = el.closest("fieldset");
    if (fieldset) return fieldset;
    const group = el.closest('[role="group"]');
    if (group) return group;
    let current = el.parentElement;
    while (current && current !== document.body) {
      if (getFieldTitle(current)) return current;
      current = current.parentElement;
    }
    return null;
  }
  function getDirectFieldTitle(container) {
    const legend = container.querySelector(":scope > legend, legend");
    if (legend?.textContent?.trim()) {
      return legend.textContent.trim().replace(/\*+/g, "").trim();
    }
    const labelledBy = resolveLabelledByText(container.getAttribute("aria-labelledby"));
    if (labelledBy) return labelledBy.replace(/\*+/g, "").trim();
    for (const label of container.querySelectorAll(":scope > label")) {
      const text = label.textContent?.trim().replace(/\*+/g, "").trim();
      if (!text || isGenericPlaceholder(text)) continue;
      const wrappedControls = label.querySelectorAll("input, textarea, select, button");
      if (wrappedControls.length === 1 && label.contains(wrappedControls[0])) continue;
      return text;
    }
    return "";
  }
  function getFieldTitle(container) {
    const direct = getDirectFieldTitle(container);
    if (direct) return direct;
    for (const control of container.querySelectorAll("input, textarea, select, button")) {
      const id = control.id;
      if (!id) continue;
      const label2 = container.querySelector(`label[for="${cssEscape(id)}"]`);
      const text = label2?.textContent?.trim().replace(/\*+/g, "").trim();
      if (text && !isGenericPlaceholder(text)) return text;
    }
    const label = container.querySelector(
      ':scope > label, label[for], [role="group"] > label'
    );
    const labelText = label?.textContent?.trim().replace(/\*+/g, "").trim();
    if (labelText && !isGenericPlaceholder(labelText)) return labelText;
    return "";
  }
  function getAccessibleName(el) {
    if (el instanceof HTMLInputElement && isChoiceInput(el)) {
      const option = getChoiceOptionLabel(el);
      if (option) return option;
    }
    const labelledBy = resolveLabelledByText(el.getAttribute("aria-labelledby"));
    if (labelledBy) return labelledBy;
    const ariaLabel = el.getAttribute("aria-label")?.trim();
    if (ariaLabel && !isGenericPlaceholder(ariaLabel)) return ariaLabel;
    const id = el.id;
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      const labelText = label?.textContent?.trim().replace(/\*+/g, "").trim();
      if (labelText) return labelText;
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
      const labelText = wrappingLabel.textContent?.trim().replace(/\*+/g, "").trim();
      if (labelText && !isGenericPlaceholder(labelText)) return labelText;
    }
    const fieldRoot = findFieldRoot(el);
    if (fieldRoot) {
      const fieldTitle = getFieldTitle(fieldRoot);
      if (fieldTitle) return fieldTitle;
    }
    const placeholder = el.getAttribute("placeholder")?.trim();
    if (placeholder && !isGenericPlaceholder(placeholder)) return placeholder;
    return "";
  }
  function isFieldContainer(el) {
    if (el.tagName === "FIELDSET") return true;
    if (el.getAttribute("role") === "group") {
      if (el.hasAttribute("aria-labelledby") || el.querySelector(":scope > legend, legend")) return true;
    }
    if (getDirectFieldTitle(el)) return true;
    if (getGroupLabelFromElement(el)) return true;
    return false;
  }
  function getGroupLabelFromElement(group) {
    const labelledBy = group.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = resolveLabelledByText(labelledBy);
      if (text) return text;
    }
    const legend = group.querySelector("legend");
    if (legend?.textContent?.trim()) return legend.textContent.trim();
    const title = getDirectFieldTitle(group);
    return title || null;
  }
  function findComboboxWidgetRoot(input) {
    let current = input.parentElement;
    while (current && current !== document.body) {
      if (current.tagName === "FIELDSET" || current.getAttribute("role") === "group") return current;
      if (getFieldTitle(current)) return current;
      current = current.parentElement;
    }
    return input.parentElement ?? input;
  }
  function isComboboxInput(el) {
    if (el.getAttribute("role") === "combobox") return true;
    if (el.tagName === "INPUT") {
      const input = el;
      if (input.getAttribute("aria-haspopup") === "listbox") return true;
      if (input.getAttribute("aria-haspopup") === "true" && input.getAttribute("aria-autocomplete") === "list") {
        return true;
      }
      if (input.getAttribute("aria-autocomplete") === "list") return true;
    }
    return false;
  }
  function getComboboxInput(el) {
    if (el instanceof HTMLInputElement && isComboboxInput(el)) return el;
    if (el.getAttribute("role") === "combobox" && el.tagName !== "INPUT") {
      return el.querySelector('input[role="combobox"], input[aria-autocomplete="list"]');
    }
    return null;
  }
  function isDocumentRoot(el) {
    return el === document.body || el === document.documentElement;
  }
  function findFileWidgetRoot(fileInput) {
    const candidates = [];
    let current = fileInput.parentElement;
    while (current && !isDocumentRoot(current)) {
      const filesInCurrent = current.querySelectorAll('input[type="file"]');
      if (filesInCurrent.length === 1 && filesInCurrent[0] === fileInput) {
        candidates.push(current);
      }
      current = current.parentElement;
    }
    const groupLabeled = candidates.find(
      (el) => el.getAttribute("role") === "group" && el.hasAttribute("aria-labelledby")
    );
    if (groupLabeled) return groupLabeled;
    const titled = candidates.filter(
      (el) => getDirectFieldTitle(el) || getGroupLabelFromElement(el)
    );
    if (titled.length > 0) {
      return titled.sort((a, b) => visibleText(a).length - visibleText(b).length)[0];
    }
    if (candidates.length > 0) {
      return candidates.sort((a, b) => visibleText(a).length - visibleText(b).length)[0];
    }
    const label = fileInput.closest("label");
    if (label) return label;
    const parent = fileInput.parentElement;
    if (parent && !isDocumentRoot(parent)) return parent;
    return fileInput;
  }
  function fileWidgetLabel(fileInput, widgetRoot) {
    const root = widgetRoot ?? findFileWidgetRoot(fileInput);
    const fromGroup = getGroupLabelFromElement(root);
    if (fromGroup) return fromGroup;
    const title = getFieldTitle(root);
    if (title) return title;
    const ariaLabel = fileInput.getAttribute("aria-label")?.trim();
    if (ariaLabel && ariaLabel !== "undefined") return ariaLabel.replace(/\*+/g, "").trim();
    if (fileInput.id) {
      const label = document.querySelector(`label[for="${cssEscape(fileInput.id)}"]`);
      const text = label?.textContent?.trim().replace(/\*+/g, "").trim();
      if (text) return text;
    }
    const rootText = visibleText(root);
    const head = rootText.split(/\b(Click here|Click or drag|Upload file|Drag file)\b/i)[0]?.trim();
    if (head && head.length >= 3 && head.length <= 80) return head.replace(/\*+/g, "").trim();
    const lines = rootText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const titledLine = lines.find((line) => line.length <= 80 && line.includes("*"));
    if (titledLine) return titledLine.replace(/\*+/g, "").trim();
    const firstLine = lines.find(Boolean);
    if (firstLine && firstLine.length <= 120) return firstLine.replace(/\*+/g, "").trim();
    return getAccessibleName(fileInput) || null;
  }
  function isFileUploadTriggerButton(btn) {
    const text = visibleText(btn).toLowerCase();
    const aria = (btn.getAttribute("aria-label") ?? "").toLowerCase();
    if (text.includes("enter manually") || text.includes("paste") || text.includes("manual")) {
      return false;
    }
    if (aria.includes("upload") || aria.includes("attach") || aria.includes("browse")) return true;
    return text === "attach" || text.includes("upload") || text === "choose file" || text === "browse";
  }
  function resolveActionableScope(root) {
    const forms = Array.from(root.querySelectorAll("form")).filter(
      (form) => form.querySelector('input, textarea, select, [contenteditable="true"][role="textbox"]')
    );
    if (forms.length === 0) {
      const main2 = root.querySelector("main");
      return main2 instanceof Element ? main2 : root;
    }
    if (forms.length === 1) return forms[0];
    let ancestor = forms[0];
    while (ancestor && ancestor !== root && ancestor !== document.body) {
      if (forms.every((form) => ancestor.contains(form))) break;
      ancestor = ancestor.parentElement;
    }
    if (ancestor && ancestor !== root && ancestor !== document.body) {
      return ancestor;
    }
    const main = root.querySelector("main");
    return main instanceof Element ? main : root;
  }
  function isScopeRoot(parent, scope) {
    if (parent === scope) return true;
    if (parent.tagName === "BODY" || parent.tagName === "HTML") return true;
    if (parent.tagName === "FORM") return true;
    return false;
  }
  function isListboxInternalNoise(el) {
    if (el.getAttribute("role") === "option") return true;
    const listbox = el.closest('[role="listbox"], [role="menu"]');
    if (!listbox) return false;
    if (el.getAttribute("role") === "combobox") return false;
    if (el instanceof HTMLInputElement && isComboboxInput(el)) return false;
    return true;
  }
  function findCountryToggle(container) {
    for (const btn of container.querySelectorAll("button")) {
      const haspopup = btn.getAttribute("aria-haspopup");
      if (btn.hasAttribute("aria-expanded") || haspopup !== null && haspopup !== "false") {
        return btn;
      }
    }
    return null;
  }
  function discoverCompoundPhoneFields(root) {
    const widgets = [];
    const seen = /* @__PURE__ */ new Set();
    const containers = root.querySelectorAll('fieldset, [role="group"]');
    for (const container of containers) {
      const tel = container.querySelector('input[type="tel"]');
      const comboboxes = [
        ...container.querySelectorAll('input[role="combobox"], input[aria-autocomplete="list"]')
      ].filter(
        (el) => el instanceof HTMLInputElement && el !== tel && el.type !== "tel"
      );
      if (!tel && comboboxes.length === 0) continue;
      if (seen.has(container)) continue;
      seen.add(container);
      const countryCombobox = comboboxes[0] ?? null;
      const suppressedSeeds = /* @__PURE__ */ new Set();
      for (const btn of container.querySelectorAll("button")) {
        if (btn === findCountryToggle(container)) suppressedSeeds.add(btn);
        if (btn.getAttribute("aria-label")?.match(/toggle|flyout|select country/i)) {
          suppressedSeeds.add(btn);
        }
      }
      for (const input of container.querySelectorAll("input")) {
        if (input === tel || input === countryCombobox) continue;
        if (input instanceof HTMLInputElement && input.type === "search") suppressedSeeds.add(input);
        if (input instanceof HTMLInputElement && isComboboxInput(input) && input !== countryCombobox && tel) {
          suppressedSeeds.add(input);
        }
      }
      widgets.push({
        widgetRoot: container,
        telInput: tel,
        countryCombobox,
        countryToggle: findCountryToggle(container),
        suppressedSeeds
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
        suppressedSeeds: /* @__PURE__ */ new Set()
      });
    }
    return widgets;
  }
  function listboxBelongsToInput(input, listbox) {
    const controls = input.getAttribute("aria-controls");
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
  function isVisibleListbox(listbox) {
    if (listbox.getAttribute("aria-hidden") === "true") return false;
    if (isHiddenByStyle(listbox)) return false;
    const rect = listbox.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function optionsFromListbox(listbox) {
    return Array.from(listbox.querySelectorAll('[role="option"]')).map((opt) => {
      const label = (opt.textContent ?? "").trim();
      return { value: label, label };
    });
  }
  function findListboxForInput(input) {
    const controlsId = input.getAttribute("aria-controls");
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
  function findComboboxToggle(input) {
    const widget = findComboboxWidgetRoot(input);
    for (const btn of widget.querySelectorAll("button")) {
      const label = (btn.getAttribute("aria-label") ?? "").toLowerCase();
      if (label.includes("toggle") || label.includes("open") || label.includes("flyout")) {
        return btn;
      }
    }
    const popupId = input.getAttribute("aria-controls");
    if (popupId) {
      const popup = document.getElementById(popupId);
      const toggle = popup?.previousElementSibling;
      if (toggle instanceof HTMLElement && toggle.tagName === "BUTTON") return toggle;
    }
    return null;
  }
  function isAsyncAutocompleteInput(input) {
    return input.getAttribute("aria-autocomplete") === "list";
  }
  function seedPriority(seed) {
    if (seed instanceof HTMLInputElement && seed.type === "file") return 100;
    if (seed.tagName === "INPUT" || seed.tagName === "TEXTAREA" || seed.tagName === "SELECT") return 80;
    if (seed.tagName === "BUTTON") return 20;
    return 50;
  }

  // src/utils/combobox-input.ts
  function setNativeInputValue(input, value) {
    const proto = input.tagName === "TEXTAREA" && typeof HTMLTextAreaElement !== "undefined" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    descriptor?.set?.call(input, value);
    const view = input.ownerDocument.defaultView;
    if (view && typeof view.InputEvent !== "undefined") {
      input.dispatchEvent(
        new view.InputEvent("input", { bubbles: true, inputType: "insertText", data: value })
      );
    } else if (view) {
      input.dispatchEvent(new view.Event("input", { bubbles: true }));
    }
  }
  function harvestVisibleOptions(input) {
    const listbox = findListboxForInput(input);
    if (!listbox || !isVisibleListbox(listbox)) return [];
    return optionsFromListbox(listbox).map((o) => o.label).filter(Boolean);
  }

  // src/utils/dropdown-probe.ts
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  var AUTOCOMPLETE_PROBE_STRINGS = ["New York", "San Francisco", "London", "a"];
  function staticComboboxOptions(input) {
    const listbox = findListboxForInput(input);
    if (!listbox) return null;
    const options = optionsFromListbox(listbox);
    if (options.length === 0) return null;
    return { options, source: "static-listbox" };
  }
  function harvestOptionsForInput(input) {
    const labels = harvestVisibleOptions(input);
    if (labels.length === 0) return [];
    return labels.map((label) => ({ value: label, label }));
  }
  function fireMouseSequence(el) {
    if (typeof PointerEvent !== "undefined") {
      const init = {
        bubbles: true,
        cancelable: true,
        view: window,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      };
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      return;
    }
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  }
  function typeInputCharByChar(input, text) {
    setNativeInputValue(input, "");
    for (const ch of text) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true })
      );
      setNativeInputValue(input, input.value + ch);
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: ch, bubbles: true, cancelable: true })
      );
    }
  }
  function dispatchEscape() {
    const init = { key: "Escape", bubbles: true, cancelable: true };
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", init));
    document.body.dispatchEvent(new KeyboardEvent("keydown", init));
  }
  function closeDropdown() {
    dispatchEscape();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }
  function waitForDropdownWithObserver(input, timeoutMs, checkFn) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (options) => {
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
        attributeFilter: ["aria-expanded", "class", "style", "aria-hidden", "hidden"]
      });
      const timer = setTimeout(() => finish(checkFn()), timeoutMs);
      void checkFn();
    });
  }
  async function triggerDropdownOpen(input) {
    input.scrollIntoView?.({ block: "center", behavior: "instant" });
    closeDropdown();
    input.focus();
    input.click();
    const toggle = findComboboxToggle(input);
    if (toggle) {
      fireMouseSequence(toggle);
      toggle.click();
    } else {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
      );
    }
  }
  async function probeInputByFocus(input, timeoutMs) {
    const staticResult = staticComboboxOptions(input);
    if (staticResult) return staticResult;
    await triggerDropdownOpen(input);
    let options = await waitForDropdownWithObserver(
      input,
      Math.min(180, timeoutMs),
      () => harvestOptionsForInput(input)
    );
    if (options.length === 0) {
      const autocompleteTimeout = Math.max(timeoutMs, 1200);
      const probeStrings = isAsyncAutocompleteInput(input) ? AUTOCOMPLETE_PROBE_STRINGS : ["a"];
      for (const text of probeStrings) {
        typeInputCharByChar(input, text);
        options = await waitForDropdownWithObserver(
          input,
          autocompleteTimeout,
          () => harvestOptionsForInput(input)
        );
        if (options.length > 0) break;
        setNativeInputValue(input, "");
      }
    }
    if (input.value) {
      setNativeInputValue(input, "");
    }
    closeDropdown();
    if (options.length === 0) return null;
    return { options, source: "probed" };
  }
  async function probeCountryToggleByFocus(toggle, widgetRoot, timeoutMs) {
    toggle.scrollIntoView?.({ block: "center", behavior: "instant" });
    closeDropdown();
    fireMouseSequence(toggle);
    toggle.click();
    const options = await waitForDropdownWithObserver(toggle, timeoutMs, () => {
      const listbox = widgetRoot.querySelector('[role="listbox"]') ?? document.querySelector('[role="listbox"]');
      return listbox && isVisibleListbox(listbox) ? optionsFromListbox(listbox) : [];
    });
    if (toggle.getAttribute("aria-expanded") === "true") {
      toggle.click();
    }
    closeDropdown();
    if (options.length === 0) return null;
    return { options, source: "probed" };
  }
  function isNonComboboxCodeInput(input) {
    if (input.getAttribute("role") === "combobox" || input.getAttribute("aria-autocomplete") === "list" || input.getAttribute("aria-haspopup") === "listbox" || input.hasAttribute("aria-controls")) {
      return false;
    }
    const autocomplete = (input.getAttribute("autocomplete") ?? "").toLowerCase();
    if (autocomplete === "one-time-code") return true;
    if (input.maxLength > 0 && input.maxLength <= 2) return true;
    return false;
  }
  function collectFocusProbeCandidates(scope, skipElements = /* @__PURE__ */ new Set()) {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    for (const el of scope.querySelectorAll(
      'input:not([type]), input[type="text"], input[type="search"], input[role="combobox"], textarea'
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
  function cacheResult(cache, seed, result) {
    cache.set(seed, result);
  }
  async function probeDropdownsByFocus(candidates, phoneFields, fetchOptions = {}) {
    const cache = /* @__PURE__ */ new Map();
    if (fetchOptions.probeComboboxes === false) return cache;
    const timeout = fetchOptions.probeTimeoutMs ?? 350;
    const phoneComboboxes = new Set(
      phoneFields.flatMap((w) => w.countryCombobox ? [w.countryCombobox] : [])
    );
    for (const widget of phoneFields) {
      let result = null;
      if (widget.countryCombobox) {
        result = await probeInputByFocus(widget.countryCombobox, timeout);
      }
      if ((!result || !result.options?.length) && widget.countryToggle) {
        result = await probeCountryToggleByFocus(
          widget.countryToggle,
          widget.widgetRoot,
          timeout
        );
      }
      if (result?.options?.length) {
        const seed = widget.countryCombobox ?? widget.countryToggle;
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

  // src/utils/actionable-tree.ts
  var SEED_SELECTOR = 'a, button, input, textarea, select, [role="combobox"]:not([role="combobox"] [role="combobox"]), [contenteditable="true"][role="textbox"]';
  var MAX_GROUP_CONTENT_LENGTH = 280;
  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function isGenericPlaceholder2(text) {
    return ["select...", "select", "choose...", "choose", "pick...", "pick", ""].includes(
      text.trim().toLowerCase()
    );
  }
  function discoverFileUploadWidgets(root) {
    const widgets = [];
    for (const fileInput of root.querySelectorAll('input[type="file"]')) {
      const input = fileInput;
      const widgetRoot = findFileWidgetRoot(input);
      const groupLabel = fileWidgetLabel(input, widgetRoot);
      const suppressedSeeds = /* @__PURE__ */ new Set();
      for (const btn of widgetRoot.querySelectorAll("button")) {
        if (isFileUploadTriggerButton(btn)) {
          suppressedSeeds.add(btn);
        }
      }
      widgets.push({ fileInput: input, widgetRoot, groupLabel, suppressedSeeds });
    }
    return widgets;
  }
  function buttonSharesFileInputField(btn) {
    let current = btn.parentElement;
    while (current && current !== document.body) {
      const fileInput = current.querySelector('input[type="file"]');
      if (fileInput && isFileUploadTriggerButton(btn)) return true;
      if (isFieldContainer(current)) break;
      current = current.parentElement;
    }
    return false;
  }
  function buildPhoneOverrides(phoneFields) {
    const childUnitBySeed = /* @__PURE__ */ new Map();
    const targetLabelBySeed = /* @__PURE__ */ new Map();
    const parentBySeed = /* @__PURE__ */ new Map();
    const suppressedSeeds = /* @__PURE__ */ new Set();
    for (const widget of phoneFields) {
      const countrySeed = widget.countryCombobox ?? widget.countryToggle;
      if (countrySeed) {
        const countryUnit = widget.countryCombobox ? findComboboxWidgetRoot(widget.countryCombobox) : widget.widgetRoot;
        childUnitBySeed.set(countrySeed, countryUnit);
        parentBySeed.set(countrySeed, widget.widgetRoot);
        const countryLabel = widget.countryCombobox && getAccessibleName(widget.countryCombobox) || getFieldTitle(widget.widgetRoot);
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
  function buildComboboxOverrides(seeds) {
    const parentBySeed = /* @__PURE__ */ new Map();
    const targetLabelBySeed = /* @__PURE__ */ new Map();
    const suppressedSeeds = /* @__PURE__ */ new Set();
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
  function isRenderedSeed(el, fileInputs) {
    if (isListboxInternalNoise(el)) return false;
    return isEffectivelyVisible(el, fileInputs.has(el));
  }
  function isUnlabeledClickable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag !== "a" && tag !== "button") return false;
    const ownLabel = elementText(el) || visibleText(el) || el.getAttribute("aria-label")?.trim() || el.getAttribute("title")?.trim() || el.getAttribute("value")?.trim();
    return !ownLabel;
  }
  function isEditorChrome(el) {
    if (el.tagName !== "BUTTON") return false;
    if (el.closest('[contenteditable="true"]')) return true;
    const fieldRoot = findFieldRoot(el);
    return Boolean(fieldRoot?.querySelector('[contenteditable="true"][role="textbox"]'));
  }
  var SUBMIT_LIKE_TEXT = /^(submit|apply|send|finish|complete)\b|\b(application|now)$/i;
  function isSubmitButton(el) {
    if (el.tagName !== "BUTTON") return false;
    if (el.getAttribute("type") === "submit") return true;
    const label = normalizeWhitespace(
      elementText(el) || el.getAttribute("aria-label") || el.getAttribute("value") || ""
    );
    return Boolean(label) && SUBMIT_LIKE_TEXT.test(label);
  }
  function seedHasOwnLabel(seed) {
    if (getComboboxInput(seed)) return "";
    const tag = seed.tagName.toLowerCase();
    if (tag === "a" || tag === "button") {
      return elementText(seed) || visibleText(seed) || seed.getAttribute("aria-label")?.trim() || seed.getAttribute("title")?.trim() || "";
    }
    if (tag === "textarea" || tag === "select") {
      const name = getAccessibleName(seed);
      if (name && !isGenericPlaceholder2(name)) return name;
    }
    if (tag === "input") {
      const type = seed.type;
      if (type !== "checkbox" && type !== "radio" && type !== "hidden" && type !== "file") {
        const name = getAccessibleName(seed);
        if (name && !isGenericPlaceholder2(name)) return name;
      }
      if (type === "checkbox" || type === "radio") {
        const section = getSectionContextText(seed);
        if (section) return section;
        return elementText(seed);
      }
      if (type === "hidden" || type === "file") {
        return elementText(seed);
      }
    }
    if (seed.getAttribute("contenteditable") === "true") {
      const section = getSectionContextText(seed);
      if (section) return section;
    }
    return elementText(seed) || visibleText(seed);
  }
  function resolveChildUnit(seed, root, overrides) {
    const override = overrides.childUnitBySeed.get(seed);
    if (override) return override;
    const combobox = getComboboxInput(seed);
    if (combobox) return findComboboxWidgetRoot(combobox);
    if (seedHasOwnLabel(seed)) return seed;
    let current = seed.parentElement;
    while (current && current !== root) {
      if (visibleText(current)) return current;
      current = current.parentElement;
    }
    return seed;
  }
  function isAlternateUploadAction(seed) {
    return seed.tagName === "BUTTON" && !isFileUploadTriggerButton(seed);
  }
  function dedupeSmallestUnits(children, childToSeed, scope) {
    const unique = [...new Set(children)];
    return unique.filter((child) => {
      const childSeed = childToSeed.get(child);
      if (!childSeed) return true;
      for (const other of unique) {
        if (other === child || !child.contains(other)) continue;
        const otherSeed = childToSeed.get(other);
        if (!otherSeed) continue;
        if (otherSeed instanceof HTMLInputElement && otherSeed.type === "file" && isAlternateUploadAction(childSeed)) {
          continue;
        }
        if (seedPriority(otherSeed) >= seedPriority(childSeed)) return false;
      }
      for (const other of unique) {
        if (other === child || !other.contains(child)) continue;
        const otherSeed = childToSeed.get(other);
        if (!otherSeed) continue;
        if (otherSeed instanceof HTMLInputElement && otherSeed.type === "file" && isAlternateUploadAction(childSeed)) {
          continue;
        }
        if (other === scope && otherSeed instanceof HTMLInputElement && otherSeed.type === "file" && childSeed !== otherSeed && !otherSeed.contains(childSeed)) {
          continue;
        }
        if (seedPriority(otherSeed) > seedPriority(childSeed)) return false;
      }
      return true;
    });
  }
  function leftoverText(node, childSet) {
    const parts = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode;
    while (textNode = walker.nextNode()) {
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
        const trimmed = (textNode.textContent ?? "").trim();
        if (trimmed) parts.push(trimmed);
      }
    }
    return normalizeWhitespace(parts.join(" "));
  }
  function subtractChildText(parentText, childTexts) {
    let content = parentText;
    for (const childText of [...childTexts].sort((a, b) => b.length - a.length)) {
      if (!childText) continue;
      content = content.split(childText).join(" ");
    }
    return normalizeWhitespace(
      content.replace(/\d+ of \d+\.\d+ results available\.?/gi, "").replace(/Use Up and Down to choose options[^.]*\.?/gi, "").replace(/press Enter to select[^.]*\.?/gi, "").replace(/press Escape to[^.]*\.?/gi, "")
    );
  }
  function isViableLeftoverParent(el, childSet) {
    if (el.tagName === "FORM") return false;
    const text = leftoverText(el, childSet);
    return Boolean(text) && text.length <= MAX_GROUP_CONTENT_LENGTH;
  }
  function isControlChromeCopy(text) {
    const lower = text.toLowerCase().trim();
    if (!lower) return true;
    if (lower.includes("accepted file types")) return true;
    if (/^attach(\s|$)/i.test(lower)) return true;
    if (lower === "upload file" || lower === "browse" || lower === "choose file") return true;
    return false;
  }
  function getGroupContent(parent, childSet, scope) {
    if (isScopeRoot(parent, scope)) return "";
    if (isFieldContainer(parent)) {
      const title = getFieldTitle(parent);
      const childrenInParent2 = [...childSet].filter((child) => parent.contains(child));
      const parentText2 = elementTextForGroupContent(parent) || visibleText(parent);
      const childTexts2 = childrenInParent2.map((child) => elementText(child) || visibleText(child)).filter((text) => text && !isGenericPlaceholder2(text));
      const subtracted2 = subtractChildText(parentText2, childTexts2);
      if (subtracted2 && subtracted2 !== title && !isControlChromeCopy(subtracted2)) {
        return subtracted2.length > MAX_GROUP_CONTENT_LENGTH ? `${subtracted2.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}\u2026` : subtracted2;
      }
      if (title) return title;
    }
    if (parent.getAttribute("role") === "group") {
      const ariaLabel = getGroupLabelFromElement(parent);
      if (ariaLabel) return ariaLabel;
    }
    const childrenInParent = [...childSet].filter((child) => parent.contains(child));
    const parentText = elementTextForGroupContent(parent) || visibleText(parent);
    const childTexts = childrenInParent.map((child) => elementText(child) || visibleText(child)).filter((text) => text && !isGenericPlaceholder2(text));
    const subtracted = subtractChildText(parentText, childTexts);
    let content = subtracted || leftoverText(parent, childSet);
    if (!content) {
      const title = getFieldTitle(parent);
      if (title) content = title;
    }
    if (content.length > MAX_GROUP_CONTENT_LENGTH) {
      const title = getFieldTitle(parent);
      if (title && title.length <= MAX_GROUP_CONTENT_LENGTH) return title;
      return `${content.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}\u2026`;
    }
    return content;
  }
  function collectSectionTextByGroup(scope, groupParents) {
    const result = /* @__PURE__ */ new Map();
    if (groupParents.length === 0) return result;
    const groupSet = new Set(groupParents);
    const ordered = [...groupParents].sort(
      (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const current = node;
      node = walker.nextNode();
      const text = (current.textContent ?? "").trim();
      const host = current.parentElement;
      if (!text || !host) continue;
      if (host.tagName === "SCRIPT" || host.tagName === "STYLE") continue;
      let owned = false;
      for (let p = host; p && p !== scope; p = p.parentElement) {
        if (groupSet.has(p) || isListboxInternalNoise(p)) {
          owned = true;
          break;
        }
      }
      if (owned) continue;
      const target = ordered.find(
        (gp) => current.compareDocumentPosition(gp) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (!target) continue;
      const prev = result.get(target);
      result.set(target, prev ? `${prev} ${text}` : text);
    }
    return result;
  }
  function clamp(text) {
    return text.length > MAX_GROUP_CONTENT_LENGTH ? `${text.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}\u2026` : text;
  }
  function mergeSectionContext(lead, base) {
    const leadText = normalizeWhitespace(lead ?? "");
    if (!leadText) return base;
    if (!base) return clamp(leadText);
    if (base.includes(leadText)) return clamp(base);
    if (leadText.includes(base)) return clamp(leadText);
    return clamp(`${leadText} ${base}`);
  }
  function getFieldContextText(parent, childUnit, scope, seed, siblingChildUnits) {
    if (isScopeRoot(parent, scope)) {
      return getAccessibleName(seed) || getSectionContextText(seed) || (elementText(childUnit) || visibleText(childUnit)).replace(/\*+/g, "").trim();
    }
    const parentText = elementTextForGroupContent(parent) || visibleText(parent);
    const siblingTexts = siblingChildUnits.filter((child) => parent.contains(child)).map((child) => elementTextForGroupContent(child) || visibleText(child)).filter((text) => text && !isGenericPlaceholder2(text));
    let content = subtractChildText(parentText, siblingTexts);
    if (!content || isControlChromeCopy(content)) {
      const title = getFieldTitle(parent);
      if (title) content = title;
    }
    const accessible = getAccessibleName(seed);
    if (!content || isControlChromeCopy(content) || content.toLowerCase() === "your answer" || accessible && content === accessible && siblingTexts.length > 1) {
      const section = getSectionContextText(seed);
      if (section) content = section;
    }
    if (!content && accessible) content = accessible;
    if (!content) content = leftoverText(parent, new Set(siblingChildUnits));
    if (content.length > MAX_GROUP_CONTENT_LENGTH) {
      return `${content.slice(0, MAX_GROUP_CONTENT_LENGTH).trim()}\u2026`;
    }
    return content;
  }
  function findParent(child, childSet, root, overrides, seed) {
    const combobox = getComboboxInput(seed);
    const overrideParent = overrides.parentBySeed.get(combobox ?? seed);
    if (overrideParent) return overrideParent;
    let current = child.parentElement;
    let leftoverParent = null;
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
  function stripChildrenHtml(parent, childSet) {
    const clone = parent.cloneNode(true);
    stripEphemeralNodes(clone);
    for (const child of childSet) {
      if (!parent.contains(child)) continue;
      for (const el of [...clone.querySelectorAll("*")]) {
        if (el.outerHTML === child.outerHTML || visibleText(el) === visibleText(child)) {
          el.remove();
        }
      }
    }
    return clone.innerHTML.trim();
  }
  function deriveControlType(seed, countryComboboxSeeds, probedOptions) {
    if (seed.getAttribute("contenteditable") === "true" && seed.getAttribute("role") === "textbox") {
      return "textarea";
    }
    if (countryComboboxSeeds.has(seed)) return "combobox";
    if (probedOptions.has(seed)) return "combobox";
    const combobox = getComboboxInput(seed);
    if (combobox) return "combobox";
    const tag = seed.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "input") {
      const type = seed.type || "text";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "file") return "file";
      return "text";
    }
    return "button";
  }
  function deriveTargetLabel(childUnit, seed, overrides) {
    const combobox = getComboboxInput(seed);
    const override = overrides.targetLabelBySeed.get(combobox ?? seed);
    if (override) return override;
    if (combobox || seed.tagName === "SELECT") {
      const name = getAccessibleName(combobox ?? seed);
      if (name) return name;
    }
    if (seed.tagName === "SELECT") {
      const select = seed;
      return select.name || elementText(childUnit) || "select";
    }
    if (seed.getAttribute("contenteditable") === "true") {
      const section = getSectionContextText(seed);
      if (section) return section.length > 100 ? `${section.slice(0, 100).trim()}\u2026` : section;
    }
    if (seed.tagName === "INPUT") {
      const input = seed;
      if (input.type === "checkbox" || input.type === "radio") {
        const option = getChoiceOptionLabel(input);
        if (option) return option;
        const section = getSectionContextText(seed);
        if (section) return section.length > 120 ? `${section.slice(0, 120).trim()}\u2026` : section;
      }
      if (input.type === "file") {
        const label = fileWidgetLabel(input);
        if (label) return label;
      }
    }
    const text = elementText(childUnit) || visibleText(childUnit);
    if (!isGenericPlaceholder2(text)) return text;
    return getAccessibleName(seed) || text;
  }
  function nativeSelectOptions(seed) {
    if (seed.tagName !== "SELECT") return void 0;
    return Array.from(seed.options).map((o) => ({
      value: o.value,
      label: o.text.trim()
    }));
  }
  function buildPropertyCandidates(seed) {
    const lists = [];
    const tag = seed.tagName.toLowerCase();
    const id = seed.id;
    if (id) lists.push([{ attribute: "id", pattern: id }]);
    const name = seed.getAttribute("name");
    const type = seed.tagName === "INPUT" ? seed.type : null;
    const role = seed.getAttribute("role");
    const base = [];
    if (name) base.push({ attribute: "name", pattern: name });
    if (type) base.push({ attribute: "type", pattern: type });
    if (role) base.push({ attribute: "role", pattern: role });
    const labelText = (elementText(seed) || visibleText(seed)).replace(/\*+/g, "").trim();
    if (labelText && labelText.length <= 100 && (tag === "button" || tag === "a")) {
      lists.push([{ attribute: "text", pattern: labelText }]);
      if (base.length) lists.push([{ attribute: "text", pattern: labelText }, ...base]);
    }
    for (const attr of Array.from(seed.attributes)) {
      if (attr.name.startsWith("data-")) {
        lists.push([...base, { attribute: attr.name, pattern: attr.value }]);
      }
    }
    const className = seed.className?.trim();
    if (className) {
      const tokens = className.split(/\s+/).filter(Boolean);
      if (tokens[0]) lists.push([...base, { attribute: "class", pattern: `?${tokens[0]}?` }]);
      lists.push([...base, { attribute: "class", pattern: className }]);
    }
    if (base.length) lists.push([...base]);
    lists.push([]);
    return lists;
  }
  function buildControlSelector(root, seed) {
    const tag = seed.tagName.toLowerCase();
    for (const properties of buildPropertyCandidates(seed)) {
      const matches = findElementsByTarget(root, { tag, properties });
      const idx2 = matches.indexOf(seed);
      if (idx2 < 0) continue;
      const selector = {
        tag,
        properties,
        ...matches.length > 1 ? { index: idx2 } : {}
      };
      if (findElementByTarget(root, selector) === seed) return selector;
      const withIndex = { tag, properties, index: idx2 };
      if (findElementByTarget(root, withIndex) === seed) return withIndex;
    }
    const all = findElementsByTarget(root, { tag, properties: [] });
    const idx = all.indexOf(seed);
    return { tag, properties: [], index: idx >= 0 ? idx : 0 };
  }
  function buildWidgetOverrides(fileWidgets, phoneFields, seeds) {
    const childUnitBySeed = /* @__PURE__ */ new Map();
    const targetLabelBySeed = /* @__PURE__ */ new Map();
    const parentBySeed = /* @__PURE__ */ new Map();
    const suppressedSeeds = /* @__PURE__ */ new Set();
    for (const widget of fileWidgets) {
      const { fileInput, widgetRoot, groupLabel, suppressedSeeds: widgetSuppressed } = widget;
      const fieldRoot = findFieldRoot(fileInput);
      let childUnit = fieldRoot && widgetRoot.contains(fieldRoot) ? fieldRoot : widgetRoot;
      if (isDocumentRoot(childUnit)) childUnit = fileInput;
      let parent = widgetRoot;
      if (isDocumentRoot(parent)) parent = fileInput;
      childUnitBySeed.set(fileInput, childUnit);
      parentBySeed.set(fileInput, parent);
      if (groupLabel) targetLabelBySeed.set(fileInput, groupLabel);
      for (const el of widgetSuppressed) suppressedSeeds.add(el);
      if (!isDocumentRoot(widgetRoot)) {
        for (const btn of widgetRoot.querySelectorAll("button")) {
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
  function collectSeeds(root, overrides) {
    const fileInputs = /* @__PURE__ */ new Set();
    for (const widget of discoverFileUploadWidgets(root)) {
      fileInputs.add(widget.fileInput);
    }
    const raw = Array.from(root.querySelectorAll(SEED_SELECTOR)).filter((el) => {
      if (isEditorChrome(el)) return false;
      if (isSubmitButton(el)) return false;
      if (el.getAttribute("role") === "combobox" && el.tagName !== "INPUT") {
        const input = getComboboxInput(el);
        return input ? isRenderedSeed(input, fileInputs) : false;
      }
      if (isUnlabeledClickable(el)) return false;
      return isRenderedSeed(el, fileInputs);
    });
    const seeds = [];
    const seenFileWidgets = /* @__PURE__ */ new Set();
    const seenCombobox = /* @__PURE__ */ new Set();
    for (const el of raw) {
      if (overrides.suppressedSeeds.has(el)) continue;
      const combobox = getComboboxInput(el);
      if (combobox) {
        if (seenCombobox.has(combobox)) continue;
        seenCombobox.add(combobox);
        seeds.push(combobox);
        continue;
      }
      if (el.tagName === "INPUT" && el.type === "file") {
        if (seenFileWidgets.has(el)) continue;
        seenFileWidgets.add(el);
        seeds.push(el);
        continue;
      }
      if (el.tagName === "BUTTON" && buttonSharesFileInputField(el)) continue;
      seeds.push(el);
    }
    for (const input of fileInputs) {
      if (!seeds.includes(input)) seeds.push(input);
    }
    for (const widget of discoverCompoundPhoneFields(root)) {
      if (widget.telInput && !seeds.includes(widget.telInput)) seeds.push(widget.telInput);
    }
    return seeds;
  }
  function buildChildToSeed(seeds, root, overrides) {
    const map = /* @__PURE__ */ new Map();
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
  async function buildTargetEntry(pageRoot, scope, parent, childUnit, seed, siblingChildUnits, overrides, fetchOptions, probedComboboxes, countryComboboxSeeds) {
    const actionSeed = getComboboxInput(seed) ?? seed;
    const cached = probedComboboxes.get(actionSeed) ?? probedComboboxes.get(seed);
    const controlType = deriveControlType(actionSeed, countryComboboxSeeds, probedComboboxes);
    let options;
    let optionsSource;
    if (actionSeed.tagName === "SELECT") {
      options = nativeSelectOptions(actionSeed);
      optionsSource = options?.length ? "native" : void 0;
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
      ...options?.length ? { options, optionsSource } : {}
    };
  }
  async function fetchActionableTree(root = document.body, fetchOptions = {}) {
    const pageRoot = "body" in root && root.body instanceof Element ? root.body : root;
    const scope = resolveActionableScope(pageRoot);
    const fileWidgets = discoverFileUploadWidgets(scope);
    const phoneFields = discoverCompoundPhoneFields(scope);
    const countryComboboxSeeds = new Set(
      phoneFields.flatMap((w) => w.countryCombobox ? [w.countryCombobox] : w.countryToggle ? [w.countryToggle] : [])
    );
    const preliminarySeeds = collectSeeds(scope, {
      childUnitBySeed: /* @__PURE__ */ new Map(),
      targetLabelBySeed: /* @__PURE__ */ new Map(),
      parentBySeed: /* @__PURE__ */ new Map(),
      suppressedSeeds: /* @__PURE__ */ new Set([
        ...fileWidgets.flatMap((w) => [...w.suppressedSeeds]),
        ...phoneFields.flatMap((w) => [...w.suppressedSeeds])
      ])
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
    const parentToChildren = /* @__PURE__ */ new Map();
    const parentOrder = [];
    for (const child of childUnits) {
      const seed = childToSeed.get(child) ?? child;
      const parent = findParent(child, childSet, scope, overrides, seed);
      if (!parentToChildren.has(parent)) {
        parentToChildren.set(parent, []);
        parentOrder.push(parent);
      }
      parentToChildren.get(parent).push(child);
    }
    const probedComboboxes = await probeDropdownsByFocus(
      collectFocusProbeCandidates(scope),
      phoneFields,
      fetchOptions
    );
    const sectionTextByGroup = collectSectionTextByGroup(scope, parentOrder);
    const groups = [];
    for (const parent of parentOrder) {
      const children = parentToChildren.get(parent) ?? [];
      const childEntries = [];
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
            countryComboboxSeeds
          )
        );
      }
      groups.push({
        content: mergeSectionContext(sectionTextByGroup.get(parent), getGroupContent(parent, childSet, scope)),
        contentHtml: stripChildrenHtml(parent, childSet),
        children: childEntries
      });
    }
    return groups;
  }
  return __toCommonJS(actionable_tree_exports);
})();
globalThis.AvalonActionable = AvalonActionable;
