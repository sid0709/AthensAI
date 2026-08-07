declare module '@nextoffer/shared/skill-normalize' {
  export function toCanonical(skill: string): string;
  export function normalizeSkillSet(skills?: string[]): Set<string>;
  export function normalizeRaw(skill: string): string;
}
