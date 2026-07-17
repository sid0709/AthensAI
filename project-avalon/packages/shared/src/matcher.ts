import type { PropertyFilter, TargetSelector } from './types.js';

const REGEX_SPECIAL = /[.*+^${}()|[\]\\]/g;

/**
 * Convert Avalon pattern syntax to a RegExp.
 * `?` matches zero or more arbitrary characters; all other chars are literal.
 *
 * @example patternToRegex('?__index__').test('2X6x__index__') // true
 * @example patternToRegex('?_id_?').test('weioj_id_') // true
 */
export function patternToRegex(pattern: string, flags = 'i'): RegExp {
  let regexSource = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '?') {
      regexSource += '.*';
    } else {
      regexSource += char.replace(REGEX_SPECIAL, '\\$&');
    }
  }
  return new RegExp(`^${regexSource}$`, flags);
}

export function matchesPattern(value: string, pattern: string): boolean {
  return patternToRegex(pattern).test(value);
}

function readAttributeValue(element: Element, attribute: string): string {
  if (attribute === 'class') {
    return element.className;
  }
  if (attribute === 'text' || attribute === 'innerText') {
    return (element.textContent ?? '').trim();
  }
  if (attribute === 'tag') {
    return element.tagName.toLowerCase();
  }
  return element.getAttribute(attribute) ?? '';
}

export function elementMatchesProperties(
  element: Element,
  properties: PropertyFilter[],
): boolean {
  return properties.every(({ attribute, pattern }) =>
    matchesPattern(readAttributeValue(element, attribute), pattern),
  );
}

export function findElementsByTarget(
  root: ParentNode,
  target: TargetSelector,
): Element[] {
  const tag = target.tag.toLowerCase();
  const candidates = root.querySelectorAll(tag);
  return Array.from(candidates).filter((el) =>
    elementMatchesProperties(el, target.properties),
  );
}

export function findElementByTarget(
  root: ParentNode,
  target: TargetSelector,
): Element | null {
  const matches = findElementsByTarget(root, target);
  const index = target.index ?? 0;
  return matches[index] ?? null;
}
