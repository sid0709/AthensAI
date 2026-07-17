import { useRef } from "react";
import { TOKEN_RE } from "../constants/tokens";

export function JobRefField({
  value,
  onChange,
  tokenValues,
  rows = 5,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  /** token name (without braces) → resolved value, used for hover previews + which tokens to chip. */
  tokenValues: Record<string, string>;
  rows?: number;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  // Identical box metrics on both layers so wrapping lines up exactly.
  const shared = "px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words font-sans";
  const syncScroll = () => {
    if (ovRef.current && taRef.current) ovRef.current.scrollTop = taRef.current.scrollTop;
  };

  // Split into plain runs and {token} chips, preserving order and exact text.
  const pieces: { text: string; token: boolean }[] = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) pieces.push({ text: value.slice(last, start), token: false });
    pieces.push({ text: m[0], token: true });
    last = start + m[0].length;
  }
  if (last < value.length) pieces.push({ text: value.slice(last), token: false });

  const previewFor = (raw: string): string => {
    const name = raw.slice(1, -1).toLowerCase();
    const v = tokenValues[name];
    if (v == null) return "";
    return v.trim() ? (v.length > 600 ? `${v.slice(0, 600)}…` : v) : `(${name} is empty in the profile)`;
  };

  return (
    <div className="relative rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 focus-within:border-neutral-900 dark:focus-within:border-white/30 overflow-hidden">
      <div
        ref={ovRef}
        aria-hidden
        // Same scrollbar gutter as the textarea so line wrapping (and therefore
        // the caret position) stays identical whether or not it overflows.
        style={{ scrollbarGutter: "stable" }}
        className={`absolute inset-0 overflow-y-auto overflow-x-hidden pointer-events-none text-neutral-800 dark:text-white/85 ${shared}`}
      >
        {value.length === 0 && <span className="text-neutral-400 dark:text-white/30">{placeholder}</span>}
        {pieces.map((p, i) => {
          // Only chip tokens we actually know how to resolve; leave unknown
          // {…} as plain text so we don't mislead.
          const known = p.token && p.text.slice(1, -1).toLowerCase() in tokenValues;
          if (!known) return <span key={i}>{p.text}</span>;
          return (
            <span
              key={i}
              className="group relative pointer-events-auto rounded-sm bg-sky-500/20 text-sky-600 dark:text-sky-300 cursor-help"
            >
              {p.text}
              <span className="invisible group-hover:visible absolute left-0 top-full mt-1 z-30 w-72 max-h-48 overflow-auto rounded-lg border border-neutral-200 dark:border-white/15 bg-white dark:bg-neutral-800 p-2 text-[11px] leading-snug text-neutral-600 dark:text-white/70 shadow-xl whitespace-pre-wrap normal-case">
                {previewFor(p.text)}
              </span>
            </span>
          );
        })}
        {/* trailing space so the last line's height matches the textarea */}
        {"\n"}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        rows={rows}
        spellCheck={false}
        style={{ scrollbarGutter: "stable" }}
        className={`relative block w-full bg-transparent text-transparent caret-neutral-900 dark:caret-white outline-none resize-y overflow-y-auto ${shared}`}
      />
    </div>
  );
}
