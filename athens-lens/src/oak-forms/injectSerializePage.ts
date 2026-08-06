/**
 * Self-contained page serialize for chrome.scripting.executeScript({ func }).
 * Must not close over imports — Chrome only serializes this function body.
 *
 * Adapted from Project Oak serializer. Emits a compact actionable-field list
 * (not a full DOM dump) so Ask AI prompts stay small and fast.
 * Does not stamp data-oak-id on the live page.
 */

export type OakInjectSerializeResult = {
  url: string;
  title: string;
  /** Compact actionable field list for UI + Ask AI. */
  formTree: string;
  nodeCount: number;
  fieldCount: number;
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

  const MAX_DEPTH = 32;
  const MAX_CHILDREN = 120;
  const MAX_TEXT = 160;
  const MAX_OPTIONS = 12;
  const MAX_FIELDS = 80;
  const MAX_FORM_TREE_CHARS = 12_000;

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

  type ActionableField = {
    kind: string;
    label: string;
    name?: string;
    required?: boolean;
    options?: string[];
  };

  let oakIdCounter = 0;

  const empty = (error: string): OakInjectSerializeResult => ({
    url: location.href,
    title: document.title || "",
    formTree: "",
    nodeCount: 0,
    fieldCount: 0,
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
        "type",
        "role",
        "name",
        "aria-label",
        "aria-required",
        "aria-invalid",
        "placeholder",
        "value",
        "data-automation-id",
        "required",
        "checked",
        "selected",
      ]) {
        const val = el.getAttribute(attr);
        if (val) attrs[attr] = val.slice(0, 120);
      }
      if (el.hasAttribute("required")) attrs.required = "true";

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

    const collectText = (node: DomNode, out: string[] = [], budget = 3): string[] => {
      if (out.length >= budget) return out;
      if (node.text) out.push(node.text);
      for (const child of node.children) {
        if (out.length >= budget) break;
        if (child.tag === "input" || child.tag === "select" || child.tag === "textarea") continue;
        collectText(child, out, budget);
      }
      return out;
    };

    const nearestLabel = (node: DomNode, ancestors: DomNode[], opts?: { skipOptionLabel?: boolean }): string => {
      const aria = node.attrs?.["aria-label"];
      if (aria) return aria.slice(0, MAX_TEXT);
      const placeholder = node.attrs?.placeholder;
      const start = opts?.skipOptionLabel ? Math.max(0, ancestors.length - 1) : ancestors.length - 1;
      for (let i = start; i >= 0; i -= 1) {
        const parent = ancestors[i]!;
        if (opts?.skipOptionLabel && parent.tag === "label") continue;
        if (parent.tag === "label" && !opts?.skipOptionLabel) {
          const bits = collectText(parent).filter((t) => t !== placeholder);
          if (bits.length) return bits.join(" ").replace(/\s*✱\s*/g, "").trim().slice(0, MAX_TEXT);
        }
        // Question text often sits in a sibling above the control list (Lever cards, etc.).
        if (parent.tag === "li" || parent.tag === "fieldset" || parent.tag === "div") {
          for (const sib of parent.children) {
            if (sib === node) break;
            if (sib.tag === "input" || sib.tag === "select" || sib.tag === "textarea" || sib.tag === "ul") continue;
            if (sib.tag === "label" && opts?.skipOptionLabel) continue;
            const bits = collectText(sib);
            const joined = bits.join(" ").replace(/\s*✱\s*/g, "").trim();
            if (joined && !/^(yes|no)$/i.test(joined)) {
              return joined.slice(0, MAX_TEXT);
            }
          }
        }
      }
      if (placeholder) return placeholder.slice(0, MAX_TEXT);
      return (node.attrs?.name || node.id || node.tag).slice(0, MAX_TEXT);
    };

    const optionTexts = (node: DomNode): string[] => {
      const opts: string[] = [];
      const walk = (n: DomNode) => {
        if (opts.length >= MAX_OPTIONS) return;
        if (n.tag === "option" || (n.tag === "li" && n.attrs?.role === "option")) {
          const label = (n.text || n.attrs?.value || "").trim();
          if (label && !/^select/i.test(label)) opts.push(label.slice(0, 80));
          return;
        }
        // Radio/checkbox option often: label > input + span
        if (n.tag === "label") {
          const input = n.children.find((c) => c.tag === "input");
          const type = input?.attrs?.type;
          if (type === "radio" || type === "checkbox") {
            const value = input?.attrs?.value;
            const text = collectText(n).join(" ").trim() || value;
            if (text) opts.push(text.slice(0, 80));
            return;
          }
        }
        for (const child of n.children) walk(child);
      };
      walk(node);
      return opts;
    };

    const fields: ActionableField[] = [];
    const seenRadioNames = new Set<string>();

    const visit = (node: DomNode, ancestors: DomNode[]) => {
      if (fields.length >= MAX_FIELDS) return;

      if (node.tag === "input") {
        const type = (node.attrs?.type || "text").toLowerCase();
        if (type === "hidden" || type === "submit" || type === "button" || type === "image" || type === "reset") {
          return;
        }
        const name = node.attrs?.name;
        if (type === "radio") {
          const key = name || `radio-${node.nodeId}`;
          if (seenRadioNames.has(key)) return;
          seenRadioNames.add(key);
          // Options live on the shared parent group.
          let group: DomNode = node;
          for (let i = ancestors.length - 1; i >= 0; i -= 1) {
            const parent = ancestors[i]!;
            if (parent.tag === "ul" || parent.tag === "fieldset" || parent.tag === "li" || parent.tag === "div") {
              group = parent;
              // Prefer the li/fieldset that wraps the question + both options.
              if (parent.tag === "li" || parent.tag === "fieldset") break;
            }
          }
          // Walk up one more if current li only wraps a single option.
          const groupOpts = optionTexts(group);
          const parentOfGroup = ancestors[ancestors.indexOf(group) - 1];
          const opts = groupOpts.length >= 2
            ? groupOpts
            : parentOfGroup
              ? optionTexts(parentOfGroup)
              : groupOpts;
          fields.push({
            kind: "radio",
            label: nearestLabel(node, ancestors, { skipOptionLabel: true }),
            name,
            required: node.attrs?.required === "true" || node.attrs?.["aria-required"] === "true",
            options: opts.length ? opts.slice(0, MAX_OPTIONS) : undefined,
          });
          return;
        }
        if (type === "checkbox") {
          fields.push({
            kind: "checkbox",
            label: nearestLabel(node, ancestors, { skipOptionLabel: true }),
            name,
            required: node.attrs?.required === "true" || node.attrs?.["aria-required"] === "true",
          });
          return;
        }
        fields.push({
          kind: type,
          label: nearestLabel(node, ancestors),
          name,
          required: node.attrs?.required === "true" || node.attrs?.["aria-required"] === "true",
        });
        return;
      }

      if (node.tag === "textarea") {
        fields.push({
          kind: "textarea",
          label: nearestLabel(node, ancestors),
          name: node.attrs?.name,
          required: node.attrs?.required === "true" || node.attrs?.["aria-required"] === "true",
        });
        return;
      }

      if (node.tag === "select") {
        fields.push({
          kind: "select",
          label: nearestLabel(node, ancestors),
          name: node.attrs?.name,
          required: node.attrs?.required === "true" || node.attrs?.["aria-required"] === "true",
          options: optionTexts(node),
        });
        return;
      }

      if (node.attrs?.role === "combobox" || (node.tag === "div" && node.attrs?.role === "textbox")) {
        fields.push({
          kind: node.attrs?.role || "textbox",
          label: nearestLabel(node, ancestors),
          name: node.attrs?.name || node.attrs?.["data-automation-id"],
          required: node.attrs?.["aria-required"] === "true",
        });
      }

      const nextAncestors = [...ancestors, node];
      for (const child of node.children) visit(child, nextAncestors);
    };

    const tree = serializeDom();
    visit(tree, []);

    const lines = fields.map((field, index) => {
      const bits = [
        `${index + 1}.`,
        field.kind,
        `| ${field.label || "(unlabeled)"}`,
        field.name ? `| name=${field.name}` : "",
        field.required ? "| required" : "",
        field.options?.length ? `| options=${field.options.join(" / ")}` : "",
      ].filter(Boolean);
      return bits.join(" ");
    });

    const formTree = [
      `# Actionable fields — ${document.title || "Untitled"}`,
      `URL: ${location.href}`,
      `Fields: ${fields.length}`,
      "",
      ...lines,
      "",
    ].join("\n").slice(0, MAX_FORM_TREE_CHARS);

    return {
      url: location.href,
      title: document.title || "",
      formTree,
      nodeCount: oakIdCounter,
      fieldCount: fields.length,
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : "serialize failed");
  }
}
