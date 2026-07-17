import { toCanonical } from '@nextoffer/shared/skill-normalize';

export { toCanonical };

export function normalizeSkillKey(name) {
  return toCanonical(name);
}

export function normalizeSurfaceForm(name) {
  return String(name ?? '').trim();
}
