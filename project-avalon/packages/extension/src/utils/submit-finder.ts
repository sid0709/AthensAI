import { elementText, getAccessibleName, isEffectivelyVisible, visibleText } from './dom-analytics.js';

/**
 * Words that mark a control as the form's forward/submit action. Language-based
 * and portable — no vendor class names. "next"/"continue" are included so the
 * final step also works on multi-page applications.
 */
const SUBMIT_TEXT =
  /\b(submit|apply|send application|send|finish|complete|continue|next)\b/i;

/** Controls that look like the form's submit/apply/next action, never a destructive one. */
const NEGATIVE_TEXT = /\b(cancel|back|previous|save draft|delete|remove|close)\b/i;

function controlLabel(el: Element): string {
  return (
    elementText(el) ||
    visibleText(el) ||
    el.getAttribute('text')?.trim() ||
    (el as HTMLInputElement).value?.trim() ||
    getAccessibleName(el) ||
    ''
  ).trim();
}

function isExplicitSubmit(el: Element): boolean {
  if (el.getAttribute('type') === 'submit') return true;
  return el instanceof HTMLInputElement && el.type === 'submit';
}

/**
 * Find the most likely Submit/Apply/Next control on the page. Prefers an
 * explicit `type="submit"`, then a forward-action label; falls back to the last
 * such control in document order (the final action a user would click).
 */
export function findSubmitControl(root: ParentNode = document): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input[type="submit"], input[type="button"], [role="button"], a',
    ),
  ).filter((el) => isEffectivelyVisible(el));

  let explicit: HTMLElement | null = null;
  let labelled: HTMLElement | null = null;

  for (const el of candidates) {
    const label = controlLabel(el);
    if (label && NEGATIVE_TEXT.test(label)) continue;

    if (isExplicitSubmit(el)) {
      // Last explicit submit wins (final action on multi-section forms).
      explicit = el;
      continue;
    }
    if (label && SUBMIT_TEXT.test(label)) labelled = el;
  }

  return explicit ?? labelled;
}
