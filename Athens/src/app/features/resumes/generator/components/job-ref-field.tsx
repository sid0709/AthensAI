import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { TOKEN_RE } from "../constants/tokens";

function tokenAtCaret(value: string, caret: number, tokenValues: Record<string, string>): string | null {
  for (const m of value.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (caret >= start && caret <= end) {
      const name = m[0].slice(1, -1).toLowerCase();
      if (name in tokenValues) return m[0];
    }
  }
  return null;
}

export function JobRefField({
  value,
  onChange,
  tokenValues,
  rows = 5,
  className = "",
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  /** token name (without braces) → resolved value, used for hover previews + which tokens to chip. */
  tokenValues: Record<string, string>;
  rows?: number;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);

  const syncScroll = useCallback(() => {
    if (ovRef.current && taRef.current) ovRef.current.scrollTop = taRef.current.scrollTop;
  }, []);

  const syncCaret = useCallback(() => {
    const el = taRef.current;
    if (el) setCaret(el.selectionStart);
  }, []);

  useLayoutEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

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

  const activeToken = tokenAtCaret(value, caret, tokenValues);
  const activePreview = activeToken ? previewFor(activeToken) : "";

  return (
    <div>
      <div className={`athens-prompt-field ${className}`.trim()}>
        <div ref={ovRef} aria-hidden className="athens-prompt-field__overlay">
          {value.length === 0 && <span className="athens-prompt-field__placeholder">{placeholder}</span>}
          {pieces.map((p, i) => {
            const known = p.token && p.text.slice(1, -1).toLowerCase() in tokenValues;
            if (!known) return <span key={i}>{p.text}</span>;
            return (
              <span key={i} className="athens-prompt-field__token">
                {p.text}
              </span>
            );
          })}
          {"\n"}
        </div>
        <textarea
          ref={taRef}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          rows={rows}
          spellCheck={false}
          className="athens-prompt-field__input"
        />
      </div>
      {activeToken && activePreview ? (
        <p className="athens-prompt-field__hint">
          <strong>{activeToken}</strong>
          {"\n"}
          {activePreview}
        </p>
      ) : null}
    </div>
  );
}
