const STYLE_ID = 'avalon-highlight-styles';
const HIGHLIGHT_CLASS = 'avalon-highlight-target';

const HIGHLIGHT_CSS = `
@keyframes avalon-highlight-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 3px rgba(59, 130, 246, 0.95),
      0 0 18px 4px rgba(59, 130, 246, 0.45),
      inset 0 0 0 1px rgba(147, 197, 253, 0.35);
  }
  50% {
    box-shadow:
      0 0 0 3px rgba(96, 165, 250, 1),
      0 0 28px 8px rgba(59, 130, 246, 0.65),
      inset 0 0 0 1px rgba(191, 219, 254, 0.55);
  }
}

.${HIGHLIGHT_CLASS} {
  outline: 2px solid #60a5fa !important;
  outline-offset: 3px !important;
  border-radius: 6px;
  animation: avalon-highlight-pulse 1.4s ease-in-out infinite;
  position: relative;
  z-index: 2147483646;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;
  document.documentElement.appendChild(style);
}

export function highlightElement(element: Element, durationMs?: number) {
  ensureStyles();
  clearHighlights();

  const htmlElement = element as HTMLElement;
  htmlElement.classList.add(HIGHLIGHT_CLASS);
  htmlElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (durationMs && durationMs > 0) {
    window.setTimeout(() => {
      htmlElement.classList.remove(HIGHLIGHT_CLASS);
    }, durationMs);
  }

  return { highlighted: true, durationMs: durationMs ?? null };
}

export function clearHighlights() {
  for (const el of document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) {
    el.classList.remove(HIGHLIGHT_CLASS);
  }
}
