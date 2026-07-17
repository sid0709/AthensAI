import { useMemo, type CSSProperties } from "react";

// Render inline Markdown `**bold**` spans as <strong>; everything else is plain
// text. The AI emits emphasis as **…** in the summary, skills, and bullets, so we
// convert it here — this drives both the on-screen preview and the exported PDF
// (the PDF is generated from this same rendered DOM).
export function renderRich(text: string): React.ReactNode {
  if (!text || !text.includes("**")) return text;
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, i) =>
    /^\*\*[^*]+?\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Markdown `**bold**` → HTML for a contentEditable element.
function mdToHtml(md: string): string {
  return escapeHtml(md).replace(/\*\*([^*]+?)\*\*/g, "<b>$1</b>");
}

// Walk edited contentEditable HTML back to `**bold**` markdown — handles <b>,
// <strong>, and the font-weight spans browsers insert via execCommand("bold").
function nodeToMd(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const inner = Array.from(el.childNodes).map(nodeToMd).join("");
  const bold = tag === "b" || tag === "strong" || /font-weight\s*:\s*(bold|[6-9]00)/i.test(el.getAttribute("style") || "");
  return bold && inner.trim() ? `**${inner}**` : inner;
}
function htmlToMd(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return Array.from(div.childNodes)
    .map(nodeToMd)
    .join("")
    .replace(/\*\*\*\*/g, "") // collapse empty bold runs
    .replace(/ /g, " ");
}

// An inline-editable rich text node. Cmd/Ctrl+B toggles bold on the selection;
// edits serialize back to `**markdown**` on blur.
export function EditableRich({
  value,
  onChange,
  as = "div",
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  as?: "div" | "p" | "span";
  style?: React.CSSProperties;
}) {
  const html = useMemo(() => mdToHtml(value), [value]);
  const props = {
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    style: { ...style, outline: "none", cursor: "text" } as React.CSSProperties,
    title: "Editable · ⌘/Ctrl+B to bold",
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        document.execCommand("bold");
      }
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      const next = htmlToMd(e.currentTarget.innerHTML);
      if (next !== value) onChange(next);
    },
    dangerouslySetInnerHTML: { __html: html },
  };
  if (as === "p") return <p {...props} />;
  if (as === "span") return <span {...props} />;
  return <div {...props} />;
}
