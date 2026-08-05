/**
 * Self-contained page serialize for chrome.scripting.executeScript({ func }).
 * Must not close over imports — Chrome only serializes this function body.
 *
 * Adapted from Project Oak serializer + Copy-for-Analyze formatting.
 * Does not stamp data-oak-id on the live page.
 */

export type OakInjectSerializeResult = {
  url: string;
  title: string;
  formTree: string;
  nodeCount: number;
  error?: string;
};

export function injectSerializePage(): OakInjectSerializeResult {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
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
  const DETAIL_TAGS = new Set([
    "a",
    "button",
    "fieldset",
    "form",
    "input",
    "label",
    "li",
    "option",
    "select",
    "textarea",
  ]);
  const DETAIL_ATTR_KEYS = [
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
  ] as const;

  const MAX_DEPTH = 32;
  const MAX_CHILDREN = 120;
  const MAX_TEXT = 120;

  type DomNode = {
    nodeId: number;
    tag: string;
    id?: string;
    classes?: string[];
    attrs?: Record<string, string>;
    text?: string;
    childCount: number;
    children: DomNode[];
  };

  type PureNode = {
    tag: string;
    id: number;
    text?: string;
    detail?: string;
    children: PureNode[];
  };

  let oakIdCounter = 0;

  const empty = (error: string): OakInjectSerializeResult => ({
    url: location.href,
    title: document.title || "",
    formTree: "",
    nodeCount: 0,
    error,
  });

  try {
    const tn = (el: Element) => el.tagName.toUpperCase();

    const getChildren = (el: Element): Element[] => {
      if (el.tagName === "IFRAME") {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument;
          if (doc?.documentElement) return [doc.documentElement];
        } catch {
          // Cross-origin iframe.
        }
        return [];
      }
      return Array.from((el.shadowRoot || el).children);
    };

    const getChildNodes = (el: Element): Node[] => {
      if (el.tagName === "IFRAME") return [];
      return Array.from((el.shadowRoot || el).childNodes);
    };

    const isInteractive = (el: Element): boolean => {
      if (INTERACTIVE_TAGS.has(tn(el))) return true;
      if (el.getAttribute("role") === "button" || el.getAttribute("role") === "link") return true;
      if (el.hasAttribute("onclick")) return true;
      if (el instanceof HTMLElement && el.isContentEditable) return true;
      const tabIndex = el.getAttribute("tabindex");
      if (tabIndex !== null && tabIndex !== "-1") return true;
      return false;
    };

    const isHeadNoise = (el: Element): boolean => {
      if (!HEAD_NOISE_TAGS.has(tn(el))) return false;
      let parent = el.parentElement;
      while (parent) {
        if (tn(parent) === "HEAD") return true;
        if (tn(parent) === "BODY" || tn(parent) === "HTML") return false;
        parent = parent.parentElement;
      }
      return false;
    };

    const shouldOmitElement = (el: Element): boolean => {
      if (SKIP_TAGS.has(tn(el))) return true;
      if (MEDIA_TAGS.has(tn(el))) return true;
      if (isHeadNoise(el)) return true;
      return false;
    };

    const getDirectText = (el: Element): string | undefined => {
      let text = "";
      for (const node of getChildNodes(el)) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += `${node.textContent || ""} `;
        }
      }
      text = text.replace(/\s+/g, " ").trim();
      return text.length > 0 ? text.slice(0, MAX_TEXT) : undefined;
    };

    const isFlattenableWrapper = (el: Element): boolean => {
      if (!FLATTENABLE_TAGS.has(tn(el))) return false;
      if (isInteractive(el)) return false;
      if (getDirectText(el) !== undefined) return false;
      if (el.hasAttribute("role")) return false;
      for (const attr of el.getAttributeNames()) {
        if (attr.startsWith("aria-")) return false;
      }
      return true;
    };

    const serializeNode = (el: Element, depth: number): DomNode[] => {
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
    };

    const serializeDom = (): DomNode => {
      oakIdCounter = 0;
      const candidates = [document.body, document.documentElement].filter(
        (el): el is HTMLElement => el != null,
      );
      for (const candidate of candidates) {
        const nodes = serializeNode(candidate, 0);
        if (nodes.length > 0) return nodes[0]!;
      }
      throw new Error("Root element was completely pruned");
    };

    const formatDetailValue = (value: string): string =>
      (/\s/.test(value) ? JSON.stringify(value) : value);

    const toPureNode = (node: DomNode): PureNode => {
      const pure: PureNode = {
        tag: node.tag,
        id: node.nodeId,
        children: node.children.map(toPureNode),
      };
      if (node.text) pure.text = node.text;
      if (DETAIL_TAGS.has(node.tag) && (node.attrs || node.id)) {
        const parts: string[] = [];
        if (node.id) parts.push(`domId=${node.id}`);
        for (const key of DETAIL_ATTR_KEYS) {
          const value = node.attrs?.[key];
          if (value) parts.push(`${key}=${formatDetailValue(value)}`);
        }
        if (parts.length > 0) pure.detail = parts.join(" ");
      }
      return pure;
    };

    const formatPureNodeLine = (pure: PureNode): string => {
      const detailPart = pure.detail ? ` ${pure.detail}` : "";
      const textPart = pure.text ? ` "${pure.text}"` : "";
      return `${pure.tag}[${pure.id}]${detailPart}${textPart}`;
    };

    const formatPureTreePreview = (pure: PureNode, depth = 0): string => {
      const indent = "  ".repeat(depth);
      const lines = [`${indent}${formatPureNodeLine(pure)}`];
      for (const child of pure.children) {
        lines.push(formatPureTreePreview(child, depth + 1));
      }
      return lines.join("\n");
    };

    const tree = serializeDom();
    const pure = toPureNode(tree);
    const formTree = [
      `# DOM Tree — ${document.title || "Untitled"}`,
      `URL: ${location.href}`,
      `Fetched: ${new Date().toISOString()}`,
      "",
      formatPureTreePreview(pure),
      "",
    ].join("\n");

    return {
      url: location.href,
      title: document.title || "",
      formTree,
      nodeCount: oakIdCounter,
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "serialize failed");
  }
}
