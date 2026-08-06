/**
 * Interactive DOM serializer adapted from Project Oak.
 * Lens delta: does not stamp data-oak-id on the live page (Ask AI does not fill by id).
 */

import type { DomNode } from "./types";

export const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
const MEDIA_TAGS = new Set(["SVG", "IMG", "IMAGE", "PICTURE", "CANVAS", "VIDEO", "AUDIO"]);
const HEAD_NOISE_TAGS = new Set(["LINK", "META", "BASE", "TITLE"]);

const INTERACTIVE_TAGS = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "LABEL",
  "SUMMARY",
  "OPTION",
  "OPTGROUP",
  "FIELDSET",
  "FORM",
]);

const FLATTENABLE_TAGS = new Set([
  "DIV",
  "SPAN",
  "SECTION",
  "MAIN",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "NAV",
]);

const MAX_DEPTH = 32;
const MAX_CHILDREN = 120;
const MAX_TEXT = 120;

let oakIdCounter = 0;

function tn(el: Element): string {
  return el.tagName.toUpperCase();
}

function getChildren(el: Element): Element[] {
  if (el.tagName === "IFRAME") {
    try {
      const doc = (el as HTMLIFrameElement).contentDocument;
      if (doc?.documentElement) return [doc.documentElement];
    } catch {
      // Cross-origin iframes throw; caller may serialize those frames separately.
    }
    return [];
  }
  return Array.from((el.shadowRoot || el).children);
}

function getChildNodes(el: Element): Node[] {
  if (el.tagName === "IFRAME") return [];
  return Array.from((el.shadowRoot || el).childNodes);
}

export function serializeDom(root?: Element): DomNode {
  oakIdCounter = 0;

  const candidates = [root, document.body, document.documentElement].filter(
    (el): el is Element => el != null,
  );

  for (const candidate of candidates) {
    const nodes = serializeNode(candidate, 0);
    if (nodes.length > 0) return nodes[0]!;
  }

  throw new Error("Root element was completely pruned");
}

function isInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(tn(el))) return true;
  if (el.getAttribute("role") === "button" || el.getAttribute("role") === "link") return true;
  if (el.hasAttribute("onclick")) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const tabIndex = el.getAttribute("tabindex");
  if (tabIndex !== null && tabIndex !== "-1") return true;
  return false;
}

function isHeadNoise(el: Element): boolean {
  if (!HEAD_NOISE_TAGS.has(tn(el))) return false;
  let parent = el.parentElement;
  while (parent) {
    if (tn(parent) === "HEAD") return true;
    if (tn(parent) === "BODY" || tn(parent) === "HTML") return false;
    parent = parent.parentElement;
  }
  return false;
}

function shouldOmitElement(el: Element): boolean {
  if (SKIP_TAGS.has(tn(el))) return true;
  if (MEDIA_TAGS.has(tn(el))) return true;
  if (isHeadNoise(el)) return true;
  return false;
}

export function getDirectText(el: Element): string | undefined {
  let text = "";
  for (const node of getChildNodes(el)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += `${node.textContent || ""} `;
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, MAX_TEXT) : undefined;
}

function isFlattenableWrapper(el: Element): boolean {
  if (!FLATTENABLE_TAGS.has(tn(el))) return false;
  if (isInteractive(el)) return false;
  if (getDirectText(el) !== undefined) return false;
  if (el.hasAttribute("role")) return false;
  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith("aria-")) return false;
  }
  return true;
}

function serializeNode(el: Element, depth: number): DomNode[] {
  if (shouldOmitElement(el)) return [];

  const tag = el.tagName.toLowerCase();
  const flatten = isFlattenableWrapper(el);

  const rawChildEls = getChildren(el).filter((c) => !shouldOmitElement(c));
  const processedChildren: DomNode[] = [];
  const nextDepth = flatten ? depth : depth + 1;

  if (nextDepth < MAX_DEPTH) {
    for (const child of rawChildEls.slice(0, MAX_CHILDREN)) {
      processedChildren.push(...serializeNode(child, nextDepth));
    }
  }

  if (flatten) return processedChildren;

  const nodeId = ++oakIdCounter;
  // Intentionally do not stamp data-oak-id (Ask AI capture only).

  const classes = el.classList?.length ? Array.from(el.classList).slice(0, 3) : undefined;
  const attrs: Record<string, string> = {};

  for (const attr of [
    "href",
    "src",
    "for",
    "type",
    "role",
    "name",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "aria-required",
    "aria-invalid",
    "aria-checked",
    "autocomplete",
    "placeholder",
    "value",
    "data-automation-id",
    "data-fkit-id",
    "selected",
    "checked",
  ]) {
    const val = el.getAttribute(attr);
    if (val) attrs[attr] = val.slice(0, 120);
  }

  if ((tag === "input" || tag === "textarea") && "value" in el) {
    const val = (el as HTMLInputElement).value;
    if (val) attrs.value = String(val).slice(0, 120);
  }

  const text = getDirectText(el);

  if (!text && processedChildren.length === 0 && !isInteractive(el) && tag !== "iframe") {
    return [];
  }

  return [
    {
      nodeId,
      tag,
      id: el.id || undefined,
      classes,
      attrs: Object.keys(attrs).length ? attrs : undefined,
      text,
      childCount: rawChildEls.length,
      children: processedChildren,
    },
  ];
}
